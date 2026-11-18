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

var _ customeraccess.OdinRepository = (*AccessRepository)(nil)

// candidateColumns y candidateFrom comparten la lectura de un turno candidato entre
// `lookup` y `challenge`: así lo que Odin ve y lo que se valida al pedir el código
// salen de la misma consulta.
const candidateSelect = `
	SELECT a.id, a.starts_at, a.service_name_snapshot, br.full_name,
	       bs.cancellation_deadline_minutes, bs.late_cancellation_client_allowed,
	       (SELECT count(*)
	          FROM appointment_history h
	         WHERE h.business_id = a.business_id
	           AND h.appointment_id = a.id
	           AND h.event_type = 'appointment_rescheduled'
	           AND h.actor_type = 'customer')
	  FROM appointment a
	  JOIN customer c   ON c.business_id = a.business_id AND c.id = a.customer_id
	  JOIN professional br    ON br.business_id = a.business_id AND br.id = a.professional_id
	  JOIN business bs ON bs.id = a.business_id
	 WHERE a.business_id = $1 AND c.phone = $2
	   AND a.status = 'confirmed' AND a.starts_at > $3`

func scanCandidates(ctx context.Context, q database.Queries, query string, args ...any) ([]customeraccess.AppointmentCandidate, error) {
	rows, err := q.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list candidates: %w", err)
	}
	defer rows.Close()
	var out []customeraccess.AppointmentCandidate
	for rows.Next() {
		var c customeraccess.AppointmentCandidate
		if err := rows.Scan(&c.ID, &c.StartsAt, &c.ServiceName, &c.BarberName,
			&c.DeadlineMinutes, &c.LateCancelAllowed, &c.CustomerReschedules); err != nil {
			return nil, fmt.Errorf("scan candidate: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate candidates: %w", err)
	}
	return out, nil
}

// LookupUpcoming lista los turnos futuros confirmados de un teléfono en la barbería,
// del más próximo al más lejano y con tope. Lista vacía, sin error, si no hay.
func (r *AccessRepository) LookupUpcoming(ctx context.Context, slug, phone string, now time.Time) (customeraccess.LookupOutcome, error) {
	shop, found, err := r.resolveShop(ctx, slug)
	if err != nil {
		return customeraccess.LookupOutcome{}, err
	}
	if !found {
		return customeraccess.LookupOutcome{}, nil
	}
	outcome := customeraccess.LookupOutcome{BarbershopFound: true}
	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		outcome.Candidates, err = scanCandidates(ctx, q,
			candidateSelect+` ORDER BY a.starts_at LIMIT $4`,
			string(shop), phone, now, customeraccess.MaxAccessAppointments)
		return err
	})
	if err != nil {
		return customeraccess.LookupOutcome{}, fmt.Errorf("customeraccess/postgres: lookup upcoming: %w", err)
	}
	return outcome, nil
}

// RequestRefChallenge registra el reto atado a un turno en una sola transacción:
//  1. serializa por contacto y por servicio, para que el límite no se supere con
//     solicitudes simultáneas;
//  2. comprueba que el turno es de ese teléfono, sigue confirmado y es elegible
//     para el propósito;
//  3. aplica el límite por contacto (compartido con la pantalla general) y el tope
//     por barbería del servicio;
//  4. deja inútiles los retos pendientes anteriores del contacto atados a turno y
//     inserta el nuevo.
//
// Una solicitud rechazada no inserta nada.
func (r *AccessRepository) RequestRefChallenge(ctx context.Context, req customeraccess.RefChallengeRequest) (customeraccess.RefChallengeOutcome, error) {
	shop, found, err := r.resolveShop(ctx, req.Slug)
	if err != nil {
		return customeraccess.RefChallengeOutcome{}, err
	}
	if !found {
		return customeraccess.RefChallengeOutcome{}, nil
	}

	outcome := customeraccess.RefChallengeOutcome{BarbershopFound: true}
	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		// Mismo orden que la pantalla general (contacto, luego «IP») para no cruzar bloqueos.
		for _, key := range []string{"customer-access:contact:" + req.ContactHash, "customer-access:ip:" + req.ServiceHash} {
			if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key); err != nil {
				return fmt.Errorf("advisory lock: %w", err)
			}
		}

		candidates, err := scanCandidates(ctx, q, candidateSelect+` AND a.id = $4`,
			string(shop), req.Contact.Value, req.Now, req.AppointmentID)
		if err != nil {
			return err
		}
		if len(candidates) != 1 || !req.Eligible(candidates[0]) {
			return nil
		}

		windowStart := req.Now.Add(-customeraccess.AccessRequestWindow)
		retryAfter, limited, err := recentRequestsExceeded(ctx, q, string(shop), "contact_hash", req.ContactHash, windowStart, req.Now, customeraccess.AccessRequestsPerContact)
		if err != nil {
			return err
		}
		serviceRetry, serviceLimited, err := recentRequestsExceeded(ctx, q, string(shop), "ip_hash", req.ServiceHash, windowStart, req.Now, customeraccess.ServiceRequestsPerBarbershop)
		if err != nil {
			return err
		}
		if limited || serviceLimited {
			outcome.RateLimited = true
			outcome.RetryAfter = max(retryAfter, serviceRetry)
			return nil
		}

		var customerID string
		if err := q.QueryRow(ctx,
			`SELECT customer_id FROM appointment WHERE business_id = $1 AND id = $2`,
			string(shop), req.AppointmentID).Scan(&customerID); err != nil {
			return fmt.Errorf("select customer: %w", err)
		}
		// Un solo reto pendiente por contacto atado a turno: el más reciente.
		if _, err := q.Exec(ctx,
			`UPDATE customer_access_challenge SET consumed_at = $3
			  WHERE business_id = $1 AND contact_hash = $2
			    AND appointment_id IS NOT NULL AND consumed_at IS NULL`,
			string(shop), req.ContactHash, req.Now); err != nil {
			return fmt.Errorf("retire previous ref challenges: %w", err)
		}
		if _, err := q.Exec(ctx,
			`INSERT INTO customer_access_challenge
			   (business_id, customer_id, channel, contact_hash, ip_hash, code_hash,
			    appointment_id, purpose, access_ref_hash, created_at, expires_at)
			 VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6, $7, $8, $9, $10)`,
			string(shop), customerID, req.ContactHash, req.ServiceHash, req.CodeHash,
			req.AppointmentID, req.Purpose, req.AccessRefHash, req.Now, req.ExpiresAt,
		); err != nil {
			return fmt.Errorf("insert ref challenge: %w", err)
		}
		outcome.Available = true
		return nil
	})
	if err != nil {
		return customeraccess.RefChallengeOutcome{}, fmt.Errorf("customeraccess/postgres: request ref challenge: %w", err)
	}
	return outcome, nil
}

// VerifyRef valida el código del reto identificado por su referencia y, si es
// válido, lo consume y emite UN acceso de vida corta a su turno, todo en la misma
// transacción. Un código incorrecto suma un intento y la transacción se confirma
// para que el intento quede contado.
func (r *AccessRepository) VerifyRef(
	ctx context.Context, req customeraccess.VerifyRefRequest, mint customeraccess.TokenMinter,
) (customeraccess.VerifyRefOutcome, error) {
	shop, found, err := r.resolveShop(ctx, req.Slug)
	if err != nil {
		return customeraccess.VerifyRefOutcome{}, err
	}
	if !found {
		return customeraccess.VerifyRefOutcome{}, nil
	}

	outcome := customeraccess.VerifyRefOutcome{BarbershopFound: true}
	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		var (
			id            string
			appointmentID string
			purpose       string
			contactHash   string
			storedHash    string
			attempts      int
			expiresAt     time.Time
			consumedAt    *time.Time
		)
		err := q.QueryRow(ctx,
			`SELECT id, appointment_id, purpose, contact_hash, code_hash, attempts, expires_at, consumed_at
			   FROM customer_access_challenge
			  WHERE business_id = $1 AND access_ref_hash = $2
			  FOR UPDATE`,
			string(shop), req.AccessRefHash,
		).Scan(&id, &appointmentID, &purpose, &contactHash, &storedHash, &attempts, &expiresAt, &consumedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("select ref challenge: %w", err)
		}
		if consumedAt != nil || !expiresAt.After(req.Now) || attempts >= req.MaxAttempts {
			return nil
		}

		if subtle.ConstantTimeCompare([]byte(storedHash), []byte(req.CodeHashFor(contactHash))) != 1 {
			if _, err := q.Exec(ctx,
				`UPDATE customer_access_challenge SET attempts = attempts + 1 WHERE business_id = $1 AND id = $2`,
				string(shop), id,
			); err != nil {
				return fmt.Errorf("count failed attempt: %w", err)
			}
			return nil
		}

		// El turno tiene que seguir confirmado y por venir: si se canceló o pasó entre
		// pedir y verificar el código, no hay nada a lo que dar acceso y no se gasta el
		// código (la transacción se revierte).
		var stillOpen bool
		if err := q.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM appointment
			                 WHERE business_id = $1 AND id = $2
			                   AND status = 'confirmed' AND starts_at > $3)`,
			string(shop), appointmentID, req.Now).Scan(&stillOpen); err != nil {
			return fmt.Errorf("check appointment: %w", err)
		}
		if !stillOpen {
			return errNothingToAccess
		}

		if _, err := q.Exec(ctx,
			`UPDATE customer_access_challenge SET consumed_at = $3 WHERE business_id = $1 AND id = $2`,
			string(shop), id, req.Now,
		); err != nil {
			return fmt.Errorf("consume ref challenge: %w", err)
		}
		plain, hash, err := mint()
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx,
			`INSERT INTO appointment_access_token (business_id, appointment_id, token_hash, issued_at, expires_at)
			 VALUES ($1, $2, $3, $4, $5)`,
			string(shop), appointmentID, hash, req.Now, req.Now.Add(req.TokenTTL),
		); err != nil {
			return fmt.Errorf("insert access token: %w", err)
		}
		outcome.Valid, outcome.AccessToken, outcome.Purpose = true, plain, purpose
		return nil
	})
	if errors.Is(err, errNothingToAccess) {
		return customeraccess.VerifyRefOutcome{BarbershopFound: true}, nil
	}
	if err != nil {
		return customeraccess.VerifyRefOutcome{}, fmt.Errorf("customeraccess/postgres: verify ref: %w", err)
	}
	return outcome, nil
}
