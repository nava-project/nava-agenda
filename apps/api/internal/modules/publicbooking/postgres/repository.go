// Package postgres es el adaptador de persistencia de
// publicbooking.Repository sobre database.DB (CA-002-06: el núcleo de
// publicbooking no importa este paquete ni pgx; es este paquete el que
// importa publicbooking).
package postgres

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/platform/database"
)

// Repository implementa publicbooking.Repository sobre database.DB.
type Repository struct {
	db *database.DB
}

// New construye el repositorio.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

var _ publicbooking.Repository = (*Repository)(nil)
var _ publicbooking.AvailabilityRepository = (*Repository)(nil)
var _ publicbooking.CustomerRepository = (*Repository)(nil)

// ResolveBySlug implementa publicbooking.Repository.ResolveBySlug en dos
// pasos, exactamente el patrón ya establecido por
// authn_resolve_login_tenant/authn_resolve_session_tenant (HU-005,
// database.DB.ResolveTenant): primero resuelve slug a un identificador de
// negocio SIN contexto de tenant, mediante la función SECURITY DEFINER
// estrecha public_resolve_business_by_slug (que responde igual -NULL- a
// forma inválida, slug desconocido o negocio no publicable); si resuelve,
// abre una transacción tenant-aware normal (InTenantTx) sobre ESE
// identificador para leer los campos públicos mínimos ya protegidos por
// business_select_tenant_policy, sin necesitar ningún privilegio
// adicional sobre la tabla.
func (r *Repository) ResolveBySlug(ctx context.Context, slug string) (publicbooking.BusinessProfile, bool, error) {
	businessID, found, err := r.db.ResolveTenant(ctx,
		`SELECT public_resolve_business_by_slug($1)`,
		slug,
	)
	if err != nil {
		return publicbooking.BusinessProfile{}, false, fmt.Errorf("publicbooking/postgres: resolve tenant by slug: %w", err)
	}
	if !found {
		return publicbooking.BusinessProfile{}, false, nil
	}

	var (
		profile             publicbooking.BusinessProfile
		hasPhysicalLocation bool
		address             *string
		latitude, longitude *float64
	)
	profileFound := false
	err = r.db.InTenantTx(ctx, businessID, func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT name, timezone, contact_email, contact_phone,
			        business_term, business_term_gender,
			        professional_term, professional_term_plural, professional_term_gender,
			        has_physical_location, address, latitude, longitude, offers_home_service,
			        google_place_id, brand_accent, closed_on_holidays
			   FROM business
			  WHERE id = $1`,
			string(businessID),
		).Scan(
			&profile.Name, &profile.Timezone, &profile.ContactEmail, &profile.ContactPhone,
			&profile.Vocabulary.BusinessTerm, &profile.Vocabulary.BusinessTermGender,
			&profile.Vocabulary.ProfessionalTerm, &profile.Vocabulary.ProfessionalTermPlural,
			&profile.Vocabulary.ProfessionalTermGender,
			&hasPhysicalLocation, &address, &latitude, &longitude, &profile.OffersHomeService,
			&profile.GooglePlaceID, &profile.BrandAccent, &profile.ClosedOnHolidays,
		)
		switch {
		case err == nil:
			profileFound = true
			// El mapa solo se publica con el interruptor activo y coordenadas
			// reales (CA-102-02, CA-102-03); business_coordinates_ck garantiza
			// que latitud y longitud llegan juntas y con dirección.
			if hasPhysicalLocation && address != nil && latitude != nil && longitude != nil {
				profile.Location = &publicbooking.Location{Address: *address, Latitude: *latitude, Longitude: *longitude}
			}
		case errors.Is(err, pgx.ErrNoRows):
			// profileFound queda false: defensivo (la función SECURITY
			// DEFINER ya confirmó la fila en la misma sentencia SQL que
			// esta transacción re-lee; una desaparición entre ambas solo
			// podría venir de un borrado físico que este esquema no
			// permite para business).
		default:
			return fmt.Errorf("select public business profile: %w", err)
		}
		if !profileFound {
			return nil
		}
		hours, err := readOpeningHours(ctx, q, string(businessID))
		if err != nil {
			return err
		}
		profile.OpeningHours = hours
		return nil
	})
	if err != nil {
		return publicbooking.BusinessProfile{}, false, fmt.Errorf("publicbooking/postgres: read public profile: %w", err)
	}
	return profile, profileFound, nil
}

// ResolveBusinessID implementa publicbooking.AvailabilityRepository.
// ResolveBusinessID reutilizando el mismo primer paso de dos que
// ResolveBySlug (public_resolve_business_by_slug vía db.ResolveTenant),
// pero se detiene ahí: HU-094 necesita el identificador para orquestar
// schedule/shops/catalog, no un perfil público.
func (r *Repository) ResolveBusinessID(ctx context.Context, slug string) (string, bool, error) {
	businessID, found, err := r.db.ResolveTenant(ctx,
		`SELECT public_resolve_business_by_slug($1)`,
		slug,
	)
	if err != nil {
		return "", false, fmt.Errorf("publicbooking/postgres: resolve tenant by slug: %w", err)
	}
	if !found {
		return "", false, nil
	}
	return string(businessID), true, nil
}

// ListOccupiedIntervals implementa
// publicbooking.AvailabilityRepository.ListOccupiedIntervals: lee, dentro
// de una transacción tenant-aware normal (InTenantTx, RLS ya acota a
// businessID), los intervalos de las citas que ocupan agenda
// (`occupies_schedule`, estados-citas.md §11 -mismo criterio derivado que
// la restricción de exclusión `appointment_professional_interval_excl`, para que
// esta lectura nunca pueda divergir de ella) cuyo intervalo interseca
// [from, to). professionalID se filtra explícitamente además de RLS (mismo
// criterio que las demás consultas de este paquete).
func (r *Repository) ListOccupiedIntervals(ctx context.Context, businessID, professionalID string, from, to time.Time) ([]time.Time, []time.Time, error) {
	var starts, ends []time.Time
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx, `
			SELECT starts_at, ends_at
			  FROM appointment
			 WHERE business_id = $1
			   AND professional_id = $2
			   AND occupies_schedule
			   AND starts_at < $4
			   AND ends_at > $3
			 ORDER BY starts_at`,
			businessID, professionalID, from, to,
		)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var s, e time.Time
			if err := rows.Scan(&s, &e); err != nil {
				return err
			}
			starts = append(starts, s)
			ends = append(ends, e)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, nil, fmt.Errorf("publicbooking/postgres: listar ocupación de agenda: %w", err)
	}
	return starts, ends, nil
}

// centsFromNumeric convierte price_amount (pgtype.Numeric) a centavos
// exactos, sin pasar nunca por coma flotante. Duplica
// catalog/postgres.centsFromNumeric a propósito: el núcleo de publicbooking
// no importa catalog (CA-002-06, nava-docs/agenda/03-desarrollo/estandar-backend-go.md
// §5.23, mismo criterio ya aplicado por publicbooking.ServiceCursor frente
// a catalog.Cursor).
func centsFromNumeric(n pgtype.Numeric) (int64, error) {
	if !n.Valid || n.NaN || n.Int == nil {
		return 0, fmt.Errorf("publicbooking/postgres: price_amount nulo, NaN o sin valor")
	}
	exp := n.Exp + 2
	result := new(big.Int).Set(n.Int)
	switch {
	case exp == 0:
		// ya está en centavos.
	case exp > 0:
		scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(exp)), nil)
		result.Mul(result, scale)
	default:
		scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-exp)), nil)
		result.Quo(result, scale)
	}
	if !result.IsInt64() {
		return 0, fmt.Errorf("publicbooking/postgres: price_amount fuera de rango representable")
	}
	return result.Int64(), nil
}

// ListPublicServices implementa publicbooking.Repository.ListPublicServices
// con el mismo patrón de dos pasos que ResolveBySlug: resuelve slug SIN
// contexto de tenant mediante public_resolve_business_by_slug y, si
// resuelve, abre una transacción tenant-aware (InTenantTx) para leer la
// página de servicios activos con al menos una asignación vigente
// (HU-091, CA-091-01). El filtro EXISTS sobre professional_service ya queda
// acotado al mismo tenant por business_service_select_tenant_policy
// (RLS), pero se repite explícitamente por bs.business_id = s.business_id
// siguiendo el mismo criterio que catalog/postgres.Repository.List
// ("cada consulta filtra explícitamente por businessID además de RLS").
// Paginación "pedir uno de más" (mismo patrón que catalog.Repository.List).
func (r *Repository) ListPublicServices(ctx context.Context, slug string, cursor *publicbooking.ServiceCursor, limit int) (publicbooking.PublicServiceListResult, bool, error) {
	businessID, found, err := r.db.ResolveTenant(ctx,
		`SELECT public_resolve_business_by_slug($1)`,
		slug,
	)
	if err != nil {
		return publicbooking.PublicServiceListResult{}, false, fmt.Errorf("publicbooking/postgres: resolve tenant by slug: %w", err)
	}
	if !found {
		return publicbooking.PublicServiceListResult{}, false, nil
	}

	const baseQuery = `
		SELECT s.id, s.name, s.description, s.duration_minutes, s.price_amount, s.price_currency,
		       s.created_at
		  FROM service s
		 WHERE s.business_id = $1
		   AND s.is_active = true
		   AND EXISTS (
		       SELECT 1 FROM professional_service bs
		        WHERE bs.business_id = s.business_id AND bs.service_id = s.id
		   )`

	var result publicbooking.PublicServiceListResult
	err = r.db.InTenantTx(ctx, businessID, func(ctx context.Context, q database.Queries) error {
		var (
			rows pgx.Rows
			err  error
		)
		fetchLimit := limit + 1

		if cursor == nil {
			rows, err = q.Query(ctx,
				baseQuery+`
			 ORDER BY s.created_at, s.id
			 LIMIT $2`,
				string(businessID), fetchLimit,
			)
		} else {
			rows, err = q.Query(ctx,
				baseQuery+`
			   AND (s.created_at, s.id) > ($2, $3)
			 ORDER BY s.created_at, s.id
			 LIMIT $4`,
				string(businessID), cursor.CreatedAt, cursor.ID, fetchLimit,
			)
		}
		if err != nil {
			return fmt.Errorf("list public services: query: %w", err)
		}
		defer rows.Close()

		items := make([]publicbooking.PublicService, 0, fetchLimit)
		createdAts := make([]time.Time, 0, fetchLimit)
		for rows.Next() {
			var (
				svc          publicbooking.PublicService
				priceNumeric pgtype.Numeric
				createdAt    time.Time
			)
			if err := rows.Scan(&svc.ID, &svc.Name, &svc.Description, &svc.DurationMinutes, &priceNumeric, &svc.Currency, &createdAt); err != nil {
				return fmt.Errorf("list public services: scan: %w", err)
			}
			cents, err := centsFromNumeric(priceNumeric)
			if err != nil {
				return fmt.Errorf("list public services: %w", err)
			}
			svc.PriceCents = cents
			items = append(items, svc)
			createdAts = append(createdAts, createdAt)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("list public services: rows: %w", err)
		}

		hasMore := len(items) > limit
		if hasMore {
			items = items[:limit]
			createdAts = createdAts[:limit]
		}

		result.Items = items
		if hasMore {
			last := len(items) - 1
			result.NextCursor = publicbooking.EncodeServiceCursor(publicbooking.ServiceCursor{
				CreatedAt: createdAts[last],
				ID:        items[last].ID,
			})
		}
		return nil
	})
	if err != nil {
		return publicbooking.PublicServiceListResult{}, false, fmt.Errorf("publicbooking/postgres: read public services: %w", err)
	}
	return result, true, nil
}

// ListPublicProfessionals implementa publicbooking.Repository.ListPublicProfessionals
// con el mismo patrón de dos pasos que ListPublicServices: resuelve slug SIN
// contexto de tenant mediante public_resolve_business_by_slug y, si
// resuelve, abre una transacción tenant-aware (InTenantTx) para leer los
// profesionales con asignación vigente al servicio activo serviceID (HU-092,
// CA-092-02). serviceID sin forma de UUID se descarta ANTES de construir la
// consulta (evita un error de tipo de PostgreSQL sobre una columna `uuid`),
// pero SOLO después de resolver el negocio: found sigue reflejando
// exclusivamente si el negocio existe, nunca si serviceID es válido
// (CA-092-03: un serviceID inválido, ajeno, inexistente o de un servicio
// inactivo produce la MISMA lista vacía que uno sin profesionales asignados).
func (r *Repository) ListPublicProfessionals(ctx context.Context, slug string, serviceID string) (publicbooking.PublicProfessionalListResult, bool, error) {
	businessID, found, err := r.db.ResolveTenant(ctx,
		`SELECT public_resolve_business_by_slug($1)`,
		slug,
	)
	if err != nil {
		return publicbooking.PublicProfessionalListResult{}, false, fmt.Errorf("publicbooking/postgres: resolve tenant by slug: %w", err)
	}
	if !found {
		return publicbooking.PublicProfessionalListResult{}, false, nil
	}

	var result publicbooking.PublicProfessionalListResult
	if !publicbooking.LooksLikePublicServiceID(serviceID) {
		return result, true, nil
	}

	err = r.db.InTenantTx(ctx, businessID, func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx,
			`SELECT b.id, b.full_name, b.description, p.updated_at, rv.rating, rv.rating_count
			   FROM professional b
			   LEFT JOIN professional_photo p
			     ON p.business_id = b.business_id AND p.professional_id = b.id
			   LEFT JOIN LATERAL (
			     SELECT round(avg(r.rating)::numeric, 1)::float8 AS rating, count(*) AS rating_count
			       FROM professional_review r
			      WHERE r.business_id = b.business_id AND r.professional_id = b.id AND r.hidden_at IS NULL
			   ) rv ON true
			   JOIN professional_service bs
			     ON bs.business_id = b.business_id AND bs.professional_id = b.id
			   JOIN service s
			     ON s.business_id = bs.business_id AND s.id = bs.service_id
			  WHERE b.business_id = $1
			    AND bs.service_id = $2
			    AND s.is_active = true
			  ORDER BY bs.created_at, b.id`,
			string(businessID), serviceID,
		)
		if err != nil {
			return fmt.Errorf("list public professionals: query: %w", err)
		}
		defer rows.Close()

		items := make([]publicbooking.PublicProfessional, 0)
		for rows.Next() {
			var professional publicbooking.PublicProfessional
			if err := rows.Scan(&professional.ID, &professional.FullName, &professional.Description, &professional.PhotoUpdatedAt, &professional.Rating, &professional.RatingCount); err != nil {
				return fmt.Errorf("list public professionals: scan: %w", err)
			}
			items = append(items, professional)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("list public professionals: rows: %w", err)
		}

		result.Items = items
		return nil
	})
	if err != nil {
		return publicbooking.PublicProfessionalListResult{}, false, fmt.Errorf("publicbooking/postgres: read public professionals: %w", err)
	}
	return result, true, nil
}

// ListPublicProfessionalsWithServices implementa
// publicbooking.Repository.ListPublicProfessionalsWithServices (DEC-162) con el
// mismo patrón de dos pasos que ListPublicProfessionals: resuelve slug SIN
// contexto de tenant mediante public_resolve_business_by_slug y lee, en
// UNA sola consulta parametrizada dentro de una transacción tenant-aware, los
// profesionales con asignación vigente a servicios activos junto con sus ids. El
// único identificador de tenant es el que la función SECURITY DEFINER
// devolvió para el slug; nada del cliente llega a la consulta. Los JOIN y el
// WHERE repiten business_id además de RLS (mismo criterio que las demás
// consultas de este paquete). array_agg se emite como text[] para escanear
// a []string sin depender del códec de uuid[].
func (r *Repository) ListPublicProfessionalsWithServices(ctx context.Context, slug string) (publicbooking.PublicProfessionalServicesListResult, bool, error) {
	businessID, found, err := r.db.ResolveTenant(ctx,
		`SELECT public_resolve_business_by_slug($1)`,
		slug,
	)
	if err != nil {
		return publicbooking.PublicProfessionalServicesListResult{}, false, fmt.Errorf("publicbooking/postgres: resolve tenant by slug: %w", err)
	}
	if !found {
		return publicbooking.PublicProfessionalServicesListResult{}, false, nil
	}

	items := make([]publicbooking.PublicProfessionalServices, 0)
	err = r.db.InTenantTx(ctx, businessID, func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx,
			`SELECT b.id, b.full_name,
			        array_agg(s.id::text ORDER BY s.created_at, s.id) AS service_ids
			   FROM professional b
			   JOIN professional_service bs
			     ON bs.business_id = b.business_id AND bs.professional_id = b.id
			   JOIN service s
			     ON s.business_id = bs.business_id AND s.id = bs.service_id
			  WHERE b.business_id = $1
			    AND s.is_active = true
			  GROUP BY b.id, b.full_name, b.created_at
			  ORDER BY b.created_at, b.id`,
			string(businessID),
		)
		if err != nil {
			return fmt.Errorf("list public professionals with services: query: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var professional publicbooking.PublicProfessionalServices
			if err := rows.Scan(&professional.ID, &professional.FullName, &professional.ServiceIDs); err != nil {
				return fmt.Errorf("list public professionals with services: scan: %w", err)
			}
			items = append(items, professional)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("list public professionals with services: rows: %w", err)
		}
		return nil
	})
	if err != nil {
		return publicbooking.PublicProfessionalServicesListResult{}, false, fmt.Errorf("publicbooking/postgres: read public professionals with services: %w", err)
	}
	return publicbooking.PublicProfessionalServicesListResult{Items: items}, true, nil
}

// ListServiceProfessionalIDs implementa
// publicbooking.AvailabilityRepository.ListServiceProfessionalIDs (DEC-162): los
// profesionales con asignación a serviceID cuando el servicio está activo, dentro
// de businessID (ya resuelto por el llamador a partir del slug). RLS acota
// el tenant; business_id se repite explícitamente. Un serviceID ajeno,
// inexistente o inactivo no produce filas, nunca un error.
func (r *Repository) ListServiceProfessionalIDs(ctx context.Context, businessID, serviceID string) ([]string, error) {
	ids := make([]string, 0)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx,
			`SELECT bs.professional_id::text
			   FROM professional_service bs
			   JOIN service s
			     ON s.business_id = bs.business_id AND s.id = bs.service_id
			  WHERE bs.business_id = $1
			    AND bs.service_id = $2
			    AND s.is_active = true
			  ORDER BY bs.created_at, bs.professional_id`,
			businessID, serviceID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("publicbooking/postgres: listar profesionales del servicio: %w", err)
	}
	return ids, nil
}

// GetPublicProfessionalPhoto implementa publicbooking.Repository.GetPublicProfessionalPhoto
// (DEC-127) con el mismo patrón de dos pasos: resuelve el slug sin tenant y lee
// la imagen dentro de una transacción tenant-aware. El EXISTS limita la
// lectura a quien la reserva pública ya muestra (asignación vigente a un
// servicio activo): una fotografía de un profesional que no se ofrece no se
// publica por adivinar su identificador.
func (r *Repository) GetPublicProfessionalPhoto(ctx context.Context, slug string, professionalID string) (publicbooking.PublicProfessionalPhoto, bool, error) {
	businessID, found, err := r.db.ResolveTenant(ctx,
		`SELECT public_resolve_business_by_slug($1)`,
		slug,
	)
	if err != nil {
		return publicbooking.PublicProfessionalPhoto{}, false, fmt.Errorf("publicbooking/postgres: resolve tenant by slug: %w", err)
	}
	if !found {
		return publicbooking.PublicProfessionalPhoto{}, false, nil
	}

	var photo publicbooking.PublicProfessionalPhoto
	photoFound := false
	err = r.db.InTenantTx(ctx, businessID, func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT p.content_type, p.image, p.updated_at
			   FROM professional_photo p
			  WHERE p.business_id = $1
			    AND p.professional_id = $2
			    AND EXISTS (
			          SELECT 1
			            FROM professional_service bs
			            JOIN service s
			              ON s.business_id = bs.business_id AND s.id = bs.service_id
			           WHERE bs.business_id = p.business_id
			             AND bs.professional_id = p.professional_id
			             AND s.is_active = true)`,
			string(businessID), professionalID,
		).Scan(&photo.ContentType, &photo.Data, &photo.UpdatedAt)
		switch {
		case err == nil:
			photoFound = true
		case errors.Is(err, pgx.ErrNoRows):
			// photoFound queda false: sin fotografía, ajeno o no elegible.
		default:
			return fmt.Errorf("select public professional photo: %w", err)
		}
		return nil
	})
	if err != nil {
		return publicbooking.PublicProfessionalPhoto{}, false, fmt.Errorf("publicbooking/postgres: read public professional photo: %w", err)
	}
	return photo, photoFound, nil
}

// FindCustomerMatches implementa publicbooking.CustomerRepository.
// FindCustomerMatches (HU-096, DEC-085): dos lecturas independientes dentro
// de la misma transacción tenant-aware, una por phone y otra por email,
// ambas excluyendo un customer ya anonimizado (RN-DAT-03: una fila
// anonimizada perdió su identidad de contacto real, así que nunca puede ser
// la reconciliación correcta de un dato nuevo). businessID ya llegó
// resuelto por el llamador (mismo criterio que ListOccupiedIntervals): este
// puerto no resuelve slug.
func (r *Repository) FindCustomerMatches(ctx context.Context, businessID, phone, email string) (*string, *string, error) {
	var phoneMatchID, emailMatchID *string
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		// Variables separadas para cada lectura: tomar &phoneID/&emailID
		// evita que ambas coincidencias terminen apuntando a la misma
		// dirección de memoria si se reutilizara una sola variable.
		var phoneID string
		err := q.QueryRow(ctx,
			`SELECT id FROM customer
			  WHERE business_id = $1 AND anonymized_at IS NULL AND phone = $2
			  LIMIT 1`,
			businessID, phone,
		).Scan(&phoneID)
		switch {
		case err == nil:
			phoneMatchID = &phoneID
		case errors.Is(err, pgx.ErrNoRows):
			// sin coincidencia por teléfono.
		default:
			return fmt.Errorf("find customer match by phone: %w", err)
		}

		var emailID string
		err = q.QueryRow(ctx,
			`SELECT id FROM customer
			  WHERE business_id = $1 AND anonymized_at IS NULL AND email = $2
			  LIMIT 1`,
			businessID, email,
		).Scan(&emailID)
		switch {
		case err == nil:
			emailMatchID = &emailID
		case errors.Is(err, pgx.ErrNoRows):
			// sin coincidencia por correo.
		default:
			return fmt.Errorf("find customer match by email: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, nil, fmt.Errorf("publicbooking/postgres: buscar coincidencias de customer: %w", err)
	}
	return phoneMatchID, emailMatchID, nil
}

// readOpeningHours lee el horario del local (HU-107, DEC-182) en minutos
// desde medianoche; EXTRACT(EPOCH) de un `time` 24:00 da 86400, es decir 1440.
func readOpeningHours(ctx context.Context, q database.Queries, businessID string) ([]publicbooking.OpeningSegment, error) {
	rows, err := q.Query(ctx,
		`SELECT iso_weekday,
		        (EXTRACT(EPOCH FROM opens_time)  / 60)::int,
		        (EXTRACT(EPOCH FROM closes_time) / 60)::int
		   FROM business_opening_hour
		  WHERE business_id = $1
		  ORDER BY iso_weekday, opens_time`, businessID)
	if err != nil {
		return nil, fmt.Errorf("select opening hours: %w", err)
	}
	defer rows.Close()
	segments := []publicbooking.OpeningSegment{}
	for rows.Next() {
		var seg publicbooking.OpeningSegment
		if err := rows.Scan(&seg.Weekday, &seg.Opens, &seg.Closes); err != nil {
			return nil, fmt.Errorf("scan opening hour: %w", err)
		}
		segments = append(segments, seg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate opening hours: %w", err)
	}
	return segments, nil
}
