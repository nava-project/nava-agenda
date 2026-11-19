// Package postgres es el adaptador de persistencia de staff.Repository
// sobre database.DB (CA-002-06: el núcleo de staff no importa este paquete
// ni pgx; es este paquete el que importa staff), mismo patrón que
// shops/postgres.
package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/idempotency"
)

// createProfessionalOperation identifica, dentro de un negocio, la operación
// de idempotencia del alta de profesionales (RN-IDE-01): una clave ya usada
// para OTRA operación (por ejemplo una futura "crear cita") nunca se
// confunde con esta.
const createProfessionalOperation idempotency.Operation = "create_professional"

// createProfessionalIdempotencyTTL es la vigencia de una reclamación de
// idempotencia sobre el alta de un profesional antes de tratarse como si nunca
// hubiera existido (CA-004-05). 24 horas cubre con margen cualquier
// reintento de red razonable sin dejar el mecanismo vigente indefinidamente.
const createProfessionalIdempotencyTTL = 24 * time.Hour

// Repository implementa staff.Repository sobre database.DB.
type Repository struct {
	db    *database.DB
	coord idempotency.Coordinator
}

// New construye el repositorio con el coordinador de idempotencia real
// (SQLCoordinator). El parámetro coord existe para pruebas: internal/
// platform/idempotency ya prueba SQLCoordinator de forma exhaustiva contra
// PostgreSQL real, así que este paquete no necesita repetir esas pruebas,
// pero sí necesita poder construir el repositorio con el mismo adaptador
// que producción usa.
func New(db *database.DB, coord idempotency.Coordinator) *Repository {
	return &Repository{db: db, coord: coord}
}

var _ staff.Repository = (*Repository)(nil)

// professionalResponseWire es la forma JSON EXACTA que también usa
// httpapi.ProfessionalResponse (mismos nombres de campo, mismo orden, mismos
// tipos): la respuesta que Complete persiste para una repetición exacta
// (CA-004-01) debe ser BYTE A BYTE idéntica a la que el handler ya
// construyó para la primera ejecución, y ambas deben tener EXACTAMENTE la
// misma forma que un GET/PATCH de este mismo profesional. Si cambia
// httpapi.ProfessionalResponse, este struct debe cambiar igual en el mismo
// commit (ver TestCreate_StoredResponseBody_MatchesHTTPAPIWireShape en
// repository_test.go).
type professionalResponseWire struct {
	ID             string     `json:"id"`
	FullName       string     `json:"fullName"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	PhotoUpdatedAt *time.Time `json:"photoUpdatedAt"`
	Description    *string    `json:"description"`
	Rating         *float64   `json:"rating"`
	RatingCount    int        `json:"ratingCount"`
}

func marshalProfessionalResponse(b staff.Professional) ([]byte, error) {
	return json.Marshal(professionalResponseWire{
		ID:             b.ID,
		FullName:       b.FullName,
		CreatedAt:      b.CreatedAt,
		UpdatedAt:      b.UpdatedAt,
		PhotoUpdatedAt: b.PhotoUpdatedAt,
		Description:    b.Description,
		Rating:         b.Rating,
		RatingCount:    b.RatingCount,
	})
}

// professionalColumns/professionalPhotoJoin componen la lectura de un profesional con la
// versión de su fotografía (DEC-104). LEFT JOIN a professional_photo por la PK
// compuesta (business_id, professional_id): nunca lee los bytes de `image`, solo
// `updated_at`, así que el listado del equipo no arrastra imágenes.
// scanProfessional enumera los destinos de professionalColumns en el mismo orden: un solo
// lugar que cambia cuando la lectura de un profesional gana una columna.
func scanProfessional(b *staff.Professional) []any {
	return []any{&b.ID, &b.FullName, &b.CreatedAt, &b.UpdatedAt, &b.PhotoUpdatedAt, &b.Description, &b.Rating, &b.RatingCount}
}

const (
	professionalColumns = `b.id, b.full_name, b.created_at, b.updated_at, p.updated_at, b.description,
	                 rv.rating, rv.rating_count`
	// professionalPhotoJoin trae también el resumen de reseñas (DEC-128 §5): promedio de
	// 1 decimal y total sobre las no ocultas, calculados en la consulta, sin
	// columna derivada. Sin reseñas visibles el promedio es NULL y el total 0.
	professionalPhotoJoin = `LEFT JOIN professional_photo p
	                     ON p.business_id = b.business_id AND p.professional_id = b.id
	                   LEFT JOIN LATERAL (
	                     SELECT round(avg(r.rating)::numeric, 1)::float8 AS rating, count(*) AS rating_count
	                       FROM professional_review r
	                      WHERE r.business_id = b.business_id AND r.professional_id = b.id AND r.hidden_at IS NULL
	                   ) rv ON true`
)

// List implementa staff.Repository.List: orden estable (created_at, id)
// dentro del tenant vigente, cursor opaco decodificado por el núcleo
// (staff.Cursor), paginación "pedir uno de más" para saber si hay página
// siguiente sin una segunda consulta COUNT.
func (r *Repository) List(ctx context.Context, businessID string, cursor *staff.Cursor, limit int) (staff.ListResult, error) {
	var result staff.ListResult

	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		var (
			rows pgx.Rows
			err  error
		)
		// fetchLimit pide una fila de más: si vuelve, hay página siguiente.
		fetchLimit := limit + 1

		if cursor == nil {
			rows, err = q.Query(ctx,
				`SELECT `+professionalColumns+`
				   FROM professional b `+professionalPhotoJoin+`
				  WHERE b.business_id = $1
				  ORDER BY b.created_at, b.id
				  LIMIT $2`,
				businessID, fetchLimit,
			)
		} else {
			rows, err = q.Query(ctx,
				`SELECT `+professionalColumns+`
				   FROM professional b `+professionalPhotoJoin+`
				  WHERE b.business_id = $1
				    AND (b.created_at, b.id) > ($2, $3)
				  ORDER BY b.created_at, b.id
				  LIMIT $4`,
				businessID, cursor.CreatedAt, cursor.ID, fetchLimit,
			)
		}
		if err != nil {
			return fmt.Errorf("list professionals: query: %w", err)
		}
		defer rows.Close()

		items := make([]staff.Professional, 0, fetchLimit)
		for rows.Next() {
			var b staff.Professional
			if err := rows.Scan(scanProfessional(&b)...); err != nil {
				return fmt.Errorf("list professionals: scan: %w", err)
			}
			items = append(items, b)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("list professionals: rows: %w", err)
		}

		hasMore := len(items) > limit
		if hasMore {
			items = items[:limit]
		}

		result.Items = items
		if hasMore {
			last := items[len(items)-1]
			result.NextCursor = staff.EncodeCursor(staff.Cursor{CreatedAt: last.CreatedAt, ID: last.ID})
		}
		return nil
	})
	if err != nil {
		return staff.ListResult{}, fmt.Errorf("staff/postgres: list professionals: %w", err)
	}
	return result, nil
}

// Get implementa staff.Repository.Get. RLS (professional_select_tenant_policy) ya
// restringe la fila visible a business_id = current_setting(...); el
// filtro explícito WHERE business_id = $2 es defensa en profundidad,
// mismo patrón que shops/postgres.Repository.Get.
func (r *Repository) Get(ctx context.Context, businessID, professionalID string) (staff.Professional, bool, error) {
	var b staff.Professional
	found := false

	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := selectProfessional(ctx, q, businessID, professionalID).
			Scan(scanProfessional(&b)...)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// found queda false: cubre tanto "no existe" como "es de otro
			// negocio" (CA-021-05), sin distinguir la causa.
		default:
			return fmt.Errorf("select professional: %w", err)
		}
		return nil
	})
	if err != nil {
		return staff.Professional{}, false, fmt.Errorf("staff/postgres: get professional: %w", err)
	}
	if !found {
		return staff.Professional{}, false, nil
	}
	return b, true, nil
}

// Create implementa staff.Repository.Create: Begin, INSERT y Complete
// ocurren dentro de la MISMA InTenantTx (nava-docs/agenda/apps/api/README.md, "Patrón
// obligatorio: idempotencia reutilizable"). Si Begin no devuelve
// OutcomeProceed, el callback no ejecuta ningún efecto y la transacción
// igual hace COMMIT (Begin ya dejó su propio registro, cuando aplica); si
// el efecto o Complete fallan, InTenantTx hace ROLLBACK de TODA la
// transacción, incluido el INSERT que Begin reclamó, dejando la clave libre
// para un reintento legítimo (CA-004-06).
func (r *Repository) Create(
	ctx context.Context,
	businessID string,
	fullName string,
	description *string,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (staff.CreateResult, error) {
	var result staff.CreateResult

	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		decision, err := r.coord.Begin(ctx, q, database.BusinessID(businessID), key, createProfessionalOperation, fingerprint, createProfessionalIdempotencyTTL)
		if err != nil {
			return fmt.Errorf("idempotency begin: %w", err)
		}
		result.Decision = decision

		if decision.Outcome != idempotency.OutcomeProceed {
			if decision.Outcome == idempotency.OutcomeReplay {
				result.Response = decision.Response
			}
			return nil
		}

		var b staff.Professional
		if err := q.QueryRow(ctx,
			`INSERT INTO professional (business_id, full_name, description)
			      VALUES ($1, $2, $3)
			   RETURNING id, full_name, created_at, updated_at, description`,
			businessID, fullName, description,
		).Scan(&b.ID, &b.FullName, &b.CreatedAt, &b.UpdatedAt, &b.Description); err != nil {
			return fmt.Errorf("insert professional: %w", err)
		}

		body, err := marshalProfessionalResponse(b)
		if err != nil {
			return fmt.Errorf("marshal created professional: %w", err)
		}
		stored := idempotency.StoredResponse{
			Status:      201,
			ContentType: "application/json",
			Body:        string(body),
		}

		ok, err := r.coord.Complete(ctx, q, database.BusinessID(businessID), key, stored)
		if err != nil {
			return fmt.Errorf("idempotency complete: %w", err)
		}
		if !ok {
			// No debería ocurrir: Begin reclamó la clave en esta misma
			// transacción hace un instante; ver el comentario de
			// Coordinator.Complete para el único caso legítimo (otra
			// llamada ya la completó), que no puede pasar dentro de una
			// única transacción secuencial como esta.
			return fmt.Errorf("idempotency complete: la reclamación ya no estaba in_progress")
		}

		result.Professional = b
		result.Response = stored
		return nil
	})
	if err != nil {
		return staff.CreateResult{}, fmt.Errorf("staff/postgres: create professional: %w", err)
	}
	return result, nil
}

// Update implementa staff.Repository.Update: UPDATE ... RETURNING dentro de
// una única sentencia, filtrando por id Y business_id (defensa en
// profundidad sobre professional_update_tenant_policy). Nunca crea ni duplica una
// fila (CA-021-04); cero filas afectadas cubre tanto "no existe" como "es
// de otro negocio" (CA-021-05). La descripción se escribe solo cuando el
// cambio la trae ($4 en true); si no, `CASE` conserva la actual.
func (r *Repository) Update(ctx context.Context, businessID, professionalID, fullName string, description staff.DescriptionPatch) (staff.UpdateResult, error) {
	var result staff.UpdateResult

	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		var b staff.Professional
		err := q.QueryRow(ctx,
			`WITH updated AS (
			    UPDATE professional
			       SET full_name = $3,
			           description = CASE WHEN $4 THEN $5 ELSE description END
			     WHERE id = $1 AND business_id = $2
			 RETURNING id, business_id, full_name, created_at, updated_at, description
			 )
			 SELECT `+professionalColumns+`
			   FROM updated b `+professionalPhotoJoin,
			professionalID, businessID, fullName, description.Set, description.Value,
		).Scan(scanProfessional(&b)...)
		switch {
		case err == nil:
			result.Found = true
			result.Professional = b
		case errors.Is(err, pgx.ErrNoRows):
			// result.Found queda false: defensivo, ver UpdateResult.Found.
		default:
			return fmt.Errorf("update professional: %w", err)
		}
		return nil
	})
	if err != nil {
		return staff.UpdateResult{}, fmt.Errorf("staff/postgres: update professional: %w", err)
	}
	return result, nil
}

// selectProfessional lee un profesional con la versión de su fotografía dentro de la
// transacción del llamador. Filtra por id Y business_id (defensa en
// profundidad sobre professional_select_tenant_policy).
func selectProfessional(ctx context.Context, q database.Queries, businessID, professionalID string) pgx.Row {
	return q.QueryRow(ctx,
		`SELECT `+professionalColumns+`
		   FROM professional b `+professionalPhotoJoin+`
		  WHERE b.id = $1 AND b.business_id = $2`,
		professionalID, businessID,
	)
}

// PutPhoto implementa staff.Repository.PutPhoto: upsert de la fila de
// professional_photo SOLO si el profesional existe en el tenant vigente (el INSERT ...
// SELECT no produce fila para uno inexistente o de otro negocio, CA-021-05) y
// lectura del profesional ya con la nueva versión, todo en la misma transacción.
// ON CONFLICT reemplaza la imagen sin duplicar la fila; el trigger
// professional_photo_set_updated_at renueva updated_at, que es la versión pública.
func (r *Repository) PutPhoto(ctx context.Context, businessID, professionalID string, photo staff.Photo) (staff.PhotoResult, error) {
	var result staff.PhotoResult

	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		tag, err := q.Exec(ctx,
			`INSERT INTO professional_photo (business_id, professional_id, content_type, image)
			 SELECT b.business_id, b.id, $3, $4
			   FROM professional b
			  WHERE b.id = $1 AND b.business_id = $2
			 ON CONFLICT (business_id, professional_id)
			 DO UPDATE SET content_type = EXCLUDED.content_type, image = EXCLUDED.image`,
			professionalID, businessID, photo.ContentType, photo.Data,
		)
		if err != nil {
			return fmt.Errorf("upsert professional photo: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil // result.Found queda false: profesional inexistente o de otro negocio.
		}

		var b staff.Professional
		if err := selectProfessional(ctx, q, businessID, professionalID).
			Scan(scanProfessional(&b)...); err != nil {
			return fmt.Errorf("select professional after photo upsert: %w", err)
		}
		result.Found = true
		result.Professional = b
		return nil
	})
	if err != nil {
		return staff.PhotoResult{}, fmt.Errorf("staff/postgres: put professional photo: %w", err)
	}
	return result, nil
}

// GetPhoto implementa staff.Repository.GetPhoto.
func (r *Repository) GetPhoto(ctx context.Context, businessID, professionalID string) (staff.StoredPhoto, bool, error) {
	var photo staff.StoredPhoto
	found := false

	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT content_type, image, updated_at
			   FROM professional_photo
			  WHERE business_id = $1 AND professional_id = $2`,
			businessID, professionalID,
		).Scan(&photo.ContentType, &photo.Data, &photo.UpdatedAt)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// found queda false: sin fotografía o profesional de otro negocio.
		default:
			return fmt.Errorf("select professional photo: %w", err)
		}
		return nil
	})
	if err != nil {
		return staff.StoredPhoto{}, false, fmt.Errorf("staff/postgres: get professional photo: %w", err)
	}
	if !found {
		return staff.StoredPhoto{}, false, nil
	}
	return photo, true, nil
}

// DeletePhoto implementa staff.Repository.DeletePhoto. Primero comprueba que
// el profesional exista en el tenant: así "sin fotografía" (éxito idempotente) y
// "profesional inexistente" (404) se distinguen sin depender de cuántas filas
// borró el DELETE.
func (r *Repository) DeletePhoto(ctx context.Context, businessID, professionalID string) (bool, error) {
	found := false

	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		var exists bool
		if err := q.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM professional WHERE id = $1 AND business_id = $2)`,
			professionalID, businessID,
		).Scan(&exists); err != nil {
			return fmt.Errorf("check professional exists: %w", err)
		}
		if !exists {
			return nil
		}
		found = true

		if _, err := q.Exec(ctx,
			`DELETE FROM professional_photo WHERE business_id = $1 AND professional_id = $2`,
			businessID, professionalID,
		); err != nil {
			return fmt.Errorf("delete professional photo: %w", err)
		}
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("staff/postgres: delete professional photo: %w", err)
	}
	return found, nil
}

// ListPage obtiene total, límite y filas en un mismo snapshot, incluso para un
// tenant vacío. El total nunca cuenta otros negocios (DEC-107, RN-TEN-01).
func (r *Repository) ListPage(ctx context.Context, shop string, page, size int) (staff.PageResult, error) {
	result := staff.PageResult{Items: []staff.Professional{}, PageSize: size}
	err := r.db.InTenantTx(ctx, database.BusinessID(shop), func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx, `WITH counted AS (
   SELECT count(*) AS total FROM professional WHERE business_id = $1
  ), bounds AS (
   SELECT total, GREATEST(1, (total + $2 - 1) / $2) AS pages FROM counted
  ), selected AS (
   SELECT b.id, b.full_name, b.created_at, b.updated_at, p.updated_at AS photo_updated_at, b.description,
          rv.rating AS rating, rv.rating_count AS rating_count FROM professional b `+professionalPhotoJoin+`
   WHERE b.business_id = $1 ORDER BY b.created_at, b.id
   LIMIT $2 OFFSET (SELECT (LEAST($3, pages) - 1) * $2 FROM bounds)
  )
  SELECT total, pages, LEAST($3, pages), s.id, s.full_name,
         s.created_at, s.updated_at, s.photo_updated_at, s.description, s.rating, s.rating_count
  FROM bounds LEFT JOIN selected s ON true`, shop, size, page)
		if err != nil {
			return fmt.Errorf("list professional page: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id, name *string
			var created, updated, photo *time.Time
			var description *string
			var rating *float64
			var ratingCount *int
			if err := rows.Scan(&result.Total, &result.TotalPages, &result.Page, &id, &name, &created, &updated, &photo, &description, &rating, &ratingCount); err != nil {
				return err
			}
			if id != nil {
				result.Items = append(result.Items, staff.Professional{ID: *id, FullName: *name, CreatedAt: *created, UpdatedAt: *updated, PhotoUpdatedAt: photo, Description: description, Rating: rating, RatingCount: *ratingCount})
			}
		}
		return rows.Err()
	})
	return result, err
}

// GetLinked implementa staff.Repository.GetLinked.
func (r *Repository) GetLinked(ctx context.Context, businessID, staffUserID string) (staff.Professional, bool, error) {
	var b staff.Professional
	found := false
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT `+professionalColumns+`
			   FROM professional b `+professionalPhotoJoin+`
			  WHERE b.business_id = $1 AND b.staff_user_id = $2`,
			businessID, staffUserID,
		).Scan(scanProfessional(&b)...)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// found queda false: el usuario no tiene profesional.
		default:
			return fmt.Errorf("select linked professional: %w", err)
		}
		return nil
	})
	if err != nil {
		return staff.Professional{}, false, fmt.Errorf("staff/postgres: get linked professional: %w", err)
	}
	return b, found, nil
}

// Link implementa staff.Repository.Link. El bloqueo consultivo por usuario
// serializa dos solicitudes simultáneas del MISMO usuario (así la unicidad
// parcial nunca llega a violarse por una carrera). Entre usuarios distintos
// decide el UPDATE condicional `staff_user_id IS NULL`: es atómico, así que de
// dos usuarios que piden el mismo profesional libre solo uno lo obtiene.
func (r *Repository) Link(ctx context.Context, businessID, staffUserID, professionalID string) (staff.LinkResult, error) {
	var result staff.LinkResult
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		if _, err := q.Exec(ctx,
			`SELECT pg_advisory_xact_lock(hashtextextended('professional_link:' || $1::text, 0))`,
			staffUserID,
		); err != nil {
			return fmt.Errorf("lock link: %w", err)
		}

		var currentOwner *string
		err := q.QueryRow(ctx,
			`SELECT staff_user_id::text FROM professional WHERE id = $1 AND business_id = $2`,
			professionalID, businessID,
		).Scan(&currentOwner)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // Found queda false: inexistente o de otro negocio.
		}
		if err != nil {
			return fmt.Errorf("select professional owner: %w", err)
		}
		result.Found = true

		switch {
		case currentOwner != nil && *currentOwner == staffUserID:
			// Ya es suyo: idempotente, nada que cambiar ni liberar.
		case currentOwner != nil:
			result.Taken = true
			return nil
		default:
			var released *string
			err := q.QueryRow(ctx,
				`UPDATE professional SET staff_user_id = NULL
				  WHERE business_id = $1 AND staff_user_id = $2
				  RETURNING id::text`,
				businessID, staffUserID,
			).Scan(&released)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("release previous professional: %w", err)
			}
			if released != nil {
				result.ReleasedProfessionalID = *released
			}

			tag, err := q.Exec(ctx,
				`UPDATE professional SET staff_user_id = $3
				  WHERE id = $1 AND business_id = $2 AND staff_user_id IS NULL`,
				professionalID, businessID, staffUserID,
			)
			if err != nil {
				return fmt.Errorf("take professional: %w", err)
			}
			if tag.RowsAffected() == 0 {
				// Otro usuario lo tomó entre la lectura y el UPDATE: se deshace
				// la liberación para conservar el vínculo anterior del solicitante.
				result.Taken = true
				result.ReleasedProfessionalID = ""
				return errLinkTaken
			}
		}

		return selectProfessional(ctx, q, businessID, professionalID).
			Scan(scanProfessional(&result.Professional)...)
	})
	if errors.Is(err, errLinkTaken) {
		return staff.LinkResult{Found: true, Taken: true}, nil
	}
	if err != nil {
		return staff.LinkResult{}, fmt.Errorf("staff/postgres: link professional: %w", err)
	}
	return result, nil
}

// errLinkTaken aborta (y por tanto revierte) la transacción de Link cuando
// otro usuario ganó la carrera por el profesional.
var errLinkTaken = errors.New("staff/postgres: profesional tomado por otro usuario")

// Unlink implementa staff.Repository.Unlink.
func (r *Repository) Unlink(ctx context.Context, businessID, staffUserID string) (string, error) {
	released := ""
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		var id *string
		err := q.QueryRow(ctx,
			`UPDATE professional SET staff_user_id = NULL
			  WHERE business_id = $1 AND staff_user_id = $2
			  RETURNING id::text`,
			businessID, staffUserID,
		).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("unlink professional: %w", err)
		}
		if id != nil {
			released = *id
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("staff/postgres: unlink professional: %w", err)
	}
	return released, nil
}
