package postgres

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"system-barbershop/internal/modules/customeraccess"
	"system-barbershop/internal/platform/database"
)

// AccessRepository implementa customeraccess.AccessRepository (HU-105, DEC-178)
// sobre database.DB. Resuelve el slug con la misma función SECURITY DEFINER
// estrecha que la reserva pública (public_resolve_barbershop_by_slug) y trabaja
// después en una transacción de esa barbería, bajo RLS.
type AccessRepository struct {
	db *database.DB
}

// NewAccessRepository construye el repositorio.
func NewAccessRepository(db *database.DB) *AccessRepository {
	return &AccessRepository{db: db}
}

var _ customeraccess.AccessRepository = (*AccessRepository)(nil)

func (r *AccessRepository) resolveShop(ctx context.Context, slug string) (database.BarbershopID, bool, error) {
	shop, found, err := r.db.ResolveTenant(ctx, `SELECT public_resolve_barbershop_by_slug($1)`, slug)
	if err != nil {
		return "", false, fmt.Errorf("customeraccess/postgres: resolve tenant by slug: %w", err)
	}
	return shop, found, nil
}

// RequestChallenge registra la solicitud en una sola transacción:
//  1. serializa por contacto y por IP (el límite no se supera con solicitudes
//     simultáneas);
//  2. cuenta las solicitudes recientes del contacto y de la IP, con o sin cliente
//     detrás, para que el 429 no delate qué contactos existen;
//  3. busca al cliente con un turno futuro confirmado;
//  4. inserta la fila: con código si hay cliente, señuelo si no.
//
// Una solicitud rechazada por el límite no inserta nada.
func (r *AccessRepository) RequestChallenge(ctx context.Context, req customeraccess.ChallengeRequest) (customeraccess.ChallengeOutcome, error) {
	shop, found, err := r.resolveShop(ctx, req.Slug)
	if err != nil {
		return customeraccess.ChallengeOutcome{}, err
	}
	if !found {
		return customeraccess.ChallengeOutcome{}, nil
	}

	outcome := customeraccess.ChallengeOutcome{BarbershopFound: true}
	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		// Siempre en el mismo orden (contacto, luego IP) para no cruzar bloqueos.
		for _, key := range []string{"customer-access:contact:" + req.ContactHash, "customer-access:ip:" + req.IPHash} {
			if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key); err != nil {
				return fmt.Errorf("advisory lock: %w", err)
			}
		}

		windowStart := req.Now.Add(-customeraccess.AccessRequestWindow)
		retryAfter, limited, err := recentRequestsExceeded(ctx, q, string(shop), "contact_hash", req.ContactHash, windowStart, req.Now, customeraccess.AccessRequestsPerContact)
		if err != nil {
			return err
		}
		ipRetry, ipLimited, err := recentRequestsExceeded(ctx, q, string(shop), "ip_hash", req.IPHash, windowStart, req.Now, customeraccess.AccessRequestsPerIP)
		if err != nil {
			return err
		}
		if limited || ipLimited {
			outcome.RateLimited = true
			outcome.RetryAfter = max(retryAfter, ipRetry)
			return nil
		}

		customerID, err := findCustomerWithUpcomingAppointment(ctx, q, string(shop), req.Contact, req.Now)
		if err != nil {
			return err
		}
		outcome.Matched = customerID != nil

		var codeHash *string
		if customerID != nil {
			codeHash = &req.CodeHash
		}
		_, err = q.Exec(ctx,
			`INSERT INTO customer_access_challenge
			   (barbershop_id, customer_id, channel, contact_hash, ip_hash, code_hash, created_at, expires_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			string(shop), customerID, string(req.Contact.Channel), req.ContactHash, req.IPHash, codeHash, req.Now, req.ExpiresAt,
		)
		if err != nil {
			return fmt.Errorf("insert challenge: %w", err)
		}
		return nil
	})
	if err != nil {
		return customeraccess.ChallengeOutcome{}, fmt.Errorf("customeraccess/postgres: request challenge: %w", err)
	}
	return outcome, nil
}

// recentRequestsExceeded cuenta las solicitudes de la columna (contacto o IP) desde
// windowStart. Con limit alcanzado devuelve cuánto falta para que la más antigua
// salga de la ventana. column es una de dos constantes del paquete, nunca un valor
// que venga del llamador externo.
func recentRequestsExceeded(
	ctx context.Context, q database.Queries, shop, column, value string,
	windowStart, now time.Time, limit int,
) (retryAfter time.Duration, exceeded bool, err error) {
	var query string
	switch column {
	case "contact_hash":
		query = `SELECT count(*), min(created_at) FROM customer_access_challenge
		          WHERE barbershop_id = $1 AND contact_hash = $2 AND created_at > $3`
	case "ip_hash":
		query = `SELECT count(*), min(created_at) FROM customer_access_challenge
		          WHERE barbershop_id = $1 AND ip_hash = $2 AND created_at > $3`
	default:
		return 0, false, fmt.Errorf("columna de límite desconocida %q", column)
	}
	var (
		count  int
		oldest *time.Time
	)
	if err := q.QueryRow(ctx, query, shop, value, windowStart).Scan(&count, &oldest); err != nil {
		return 0, false, fmt.Errorf("count recent requests: %w", err)
	}
	if count < limit || oldest == nil {
		return 0, false, nil
	}
	return oldest.Add(customeraccess.AccessRequestWindow).Sub(now), true, nil
}

// findCustomerWithUpcomingAppointment busca al cliente de la barbería con ese
// contacto que tenga algún turno futuro confirmado. nil, sin error, si no hay.
func findCustomerWithUpcomingAppointment(ctx context.Context, q database.Queries, shop string, contact customeraccess.Contact, now time.Time) (*string, error) {
	var query string
	switch contact.Channel {
	case customeraccess.ChannelEmail:
		query = `SELECT c.id FROM customer c
		          WHERE c.barbershop_id = $1 AND c.email = $2
		            AND EXISTS (SELECT 1 FROM appointment a
		                         WHERE a.barbershop_id = c.barbershop_id AND a.customer_id = c.id
		                           AND a.status = 'confirmed' AND a.starts_at > $3)`
	case customeraccess.ChannelWhatsApp:
		query = `SELECT c.id FROM customer c
		          WHERE c.barbershop_id = $1 AND c.phone = $2
		            AND EXISTS (SELECT 1 FROM appointment a
		                         WHERE a.barbershop_id = c.barbershop_id AND a.customer_id = c.id
		                           AND a.status = 'confirmed' AND a.starts_at > $3)`
	default:
		return nil, fmt.Errorf("canal desconocido %q", contact.Channel)
	}
	var id string
	err := q.QueryRow(ctx, query, shop, contact.Value, now).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, fmt.Errorf("find customer: %w", err)
	}
	return &id, nil
}

// VerifyChallenge valida el código contra el último reto con código del contacto
// y, si es válido, lo consume y emite un acceso de vida corta por cada turno
// futuro confirmado, todo en la misma transacción. Un código incorrecto suma un
// intento y la transacción se confirma (no se revierte) para que el intento
// quede contado.
//
// Solo el ÚLTIMO reto con código puede verificarse: pedir otro código deja inútil
// el anterior, y consumir uno no resucita uno más viejo.
func (r *AccessRepository) VerifyChallenge(
	ctx context.Context, req customeraccess.VerifyRequest, mint customeraccess.TokenMinter,
) (customeraccess.VerifyOutcome, error) {
	shop, found, err := r.resolveShop(ctx, req.Slug)
	if err != nil {
		return customeraccess.VerifyOutcome{}, err
	}
	if !found {
		return customeraccess.VerifyOutcome{}, nil
	}

	outcome := customeraccess.VerifyOutcome{BarbershopFound: true}
	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		var (
			id         string
			customerID string
			storedHash string
			attempts   int
			expiresAt  time.Time
			consumedAt *time.Time
		)
		err := q.QueryRow(ctx,
			`SELECT id, customer_id, code_hash, attempts, expires_at, consumed_at
			   FROM customer_access_challenge
			  WHERE barbershop_id = $1 AND contact_hash = $2 AND code_hash IS NOT NULL
			  ORDER BY created_at DESC
			  LIMIT 1
			  FOR UPDATE`,
			string(shop), req.ContactHash,
		).Scan(&id, &customerID, &storedHash, &attempts, &expiresAt, &consumedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("select challenge: %w", err)
		}
		if consumedAt != nil || !expiresAt.After(req.Now) || attempts >= req.MaxAttempts {
			return nil
		}

		if subtle.ConstantTimeCompare([]byte(storedHash), []byte(req.CodeHash)) != 1 {
			if _, err := q.Exec(ctx,
				`UPDATE customer_access_challenge SET attempts = attempts + 1 WHERE barbershop_id = $1 AND id = $2`,
				string(shop), id,
			); err != nil {
				return fmt.Errorf("count failed attempt: %w", err)
			}
			return nil
		}

		if _, err := q.Exec(ctx,
			`UPDATE customer_access_challenge SET consumed_at = $3 WHERE barbershop_id = $1 AND id = $2`,
			string(shop), id, req.Now,
		); err != nil {
			return fmt.Errorf("consume challenge: %w", err)
		}
		if err := q.QueryRow(ctx, `SELECT timezone FROM barbershop WHERE id = $1`, string(shop)).Scan(&outcome.Timezone); err != nil {
			return fmt.Errorf("select timezone: %w", err)
		}

		appointments, err := upcomingConfirmedAppointments(ctx, q, string(shop), customerID, req.Now)
		if err != nil {
			return err
		}
		for _, appt := range appointments {
			plain, hash, err := mint()
			if err != nil {
				return err
			}
			if _, err := q.Exec(ctx,
				`INSERT INTO appointment_access_token (barbershop_id, appointment_id, token_hash, issued_at, expires_at)
				 VALUES ($1, $2, $3, $4, $5)`,
				string(shop), appt.id, hash, req.Now, req.Now.Add(req.TokenTTL),
			); err != nil {
				return fmt.Errorf("insert access token: %w", err)
			}
			outcome.Appointments = append(outcome.Appointments, customeraccess.AccessAppointment{
				AccessToken: plain, StartsAt: appt.startsAt, ServiceName: appt.serviceName, BarberName: appt.barberName,
			})
		}
		// Un cliente cuyos turnos se cancelaron entre pedir y verificar el código no
		// tiene nada a lo que entrar: se responde como un código inválido y se
		// revierte el consumo para no gastarle el código sin darle nada.
		if len(outcome.Appointments) == 0 {
			return errNothingToAccess
		}
		outcome.Valid = true
		return nil
	})
	if errors.Is(err, errNothingToAccess) {
		return customeraccess.VerifyOutcome{BarbershopFound: true}, nil
	}
	if err != nil {
		return customeraccess.VerifyOutcome{}, fmt.Errorf("customeraccess/postgres: verify challenge: %w", err)
	}
	return outcome, nil
}

// errNothingToAccess aborta la transacción de una verificación sin turnos.
var errNothingToAccess = errors.New("customeraccess/postgres: sin turnos a los que dar acceso")

type upcomingAppointment struct {
	id          string
	startsAt    time.Time
	serviceName string
	barberName  string
}

// upcomingConfirmedAppointments lista los turnos futuros confirmados del cliente,
// del más próximo al más lejano y con tope.
func upcomingConfirmedAppointments(ctx context.Context, q database.Queries, shop, customerID string, now time.Time) ([]upcomingAppointment, error) {
	rows, err := q.Query(ctx,
		`SELECT a.id, a.starts_at, a.service_name_snapshot, br.full_name
		   FROM appointment a
		   JOIN barber br ON br.barbershop_id = a.barbershop_id AND br.id = a.barber_id
		  WHERE a.barbershop_id = $1 AND a.customer_id = $2
		    AND a.status = 'confirmed' AND a.starts_at > $3
		  ORDER BY a.starts_at
		  LIMIT $4`,
		shop, customerID, now, customeraccess.MaxAccessAppointments,
	)
	if err != nil {
		return nil, fmt.Errorf("list upcoming appointments: %w", err)
	}
	defer rows.Close()
	var out []upcomingAppointment
	for rows.Next() {
		var a upcomingAppointment
		if err := rows.Scan(&a.id, &a.startsAt, &a.serviceName, &a.barberName); err != nil {
			return nil, fmt.Errorf("scan upcoming appointment: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate upcoming appointments: %w", err)
	}
	return out, nil
}
