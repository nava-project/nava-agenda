package staff

import (
	"context"

	"nava-agenda/internal/platform/idempotency"
)

// ListResult es una página de profesionales ya ordenada de forma estable
// (created_at, id). NextCursor es "" cuando esta página es la última
// (CA-021-02).
type ListResult struct {
	Items      []Professional
	NextCursor string
}

// CreateResult es el desenlace completo de un intento de alta idempotente
// (RN-IDE-01, DEC-043). Decision.Outcome decide qué hizo el llamador:
//   - OutcomeProceed: Professional y Response reflejan la fila recién creada.
//   - OutcomeReplay: Decision.Response ya trae la respuesta original;
//     Response se deja igual a esa misma copia por conveniencia del
//     llamador (evita que el handler tenga que mirar dos campos distintos
//     según el Outcome), Professional queda en su valor cero (no hubo INSERT).
//   - Cualquier otro Outcome: no se ejecutó ningún efecto; Decision.AsError()
//     ya traduce ese caso a apperr, Professional y Response quedan en su valor
//     cero.
type CreateResult struct {
	Decision     idempotency.Decision
	Professional Professional
	Response     idempotency.StoredResponse
}

// UpdateResult es el desenlace de un intento de actualización (nombre y
// descripción). Found en false
// cubre un profesional inexistente o de otro negocio (CA-021-05): el
// UPDATE ... RETURNING no encontró fila que actualizar, sin distinguir la
// causa.
type UpdateResult struct {
	Professional Professional
	Found        bool
}

// PhotoResult es el desenlace de subir la fotografía de un profesional. Found en
// false cubre un profesional inexistente o de otro negocio (CA-021-05), igual que
// RenameResult.
type PhotoResult struct {
	Professional Professional
	Found        bool
}

// Repository es el puerto de persistencia del módulo staff. El núcleo no
// importa internal/platform/database ni pgx (CA-002-06): postgres/ traduce
// entre este contrato y database.DB, exactamente igual que shops.Repository.
//
// Repository.Create es la única operación que además coordina
// internal/platform/idempotency: Begin, el INSERT y Complete DEBEN
// ejecutarse dentro de UNA sola transacción tenant-aware
// (nava-docs/agenda/apps/api/README.md, "Patrón obligatorio: idempotencia reutilizable"), así
// que esa orquestación vive en el adaptador postgres (que ya importa
// database.DB), no en Service.
type Repository interface {
	ListPage(ctx context.Context, businessID string, page, pageSize int) (PageResult, error)
	// List lee una página de profesionales de businessID, ordenada por
	// (created_at, id). cursor es nil para la primera página; limit ya
	// llegó clamped al rango [MinListLimit, MaxListLimit] por Service. Cada
	// consulta filtra explícitamente por businessID además de RLS.
	List(ctx context.Context, businessID string, cursor *Cursor, limit int) (ListResult, error)

	// Get lee un profesional por id dentro del tenant vigente. found=false
	// cubre tanto "no existe" como "es de otro negocio" (CA-021-05): la
	// consulta filtra por businessID además de RLS, sin distinguir la
	// causa en el resultado.
	Get(ctx context.Context, businessID, professionalID string) (professional Professional, found bool, err error)

	// Create ejecuta el protocolo completo de idempotencia (Begin, INSERT,
	// Complete) dentro de UNA sola InTenantTx. fullName y description (nil =
	// sin descripción) ya llegaron normalizados y validados por Service; key y fingerprint ya fueron
	// interpretados por la capa HTTP (httpserver.IdempotencyKeyFromRequest/
	// IdempotencyFingerprint) antes de llegar aquí.
	Create(
		ctx context.Context,
		businessID string,
		fullName string,
		description *string,
		key idempotency.Key,
		fingerprint idempotency.Fingerprint,
	) (CreateResult, error)

	// Update ejecuta `UPDATE ... RETURNING` dentro de una transacción
	// tenant-aware, filtrando por businessID además de RLS: nunca crea ni
	// duplica una fila (CA-021-04), y nunca modifica la de otro negocio
	// (CA-021-05). La descripción solo se escribe cuando description.Set es
	// true; si no, conserva el valor actual.
	Update(ctx context.Context, businessID, professionalID, fullName string, description DescriptionPatch) (UpdateResult, error)

	// PutPhoto crea o reemplaza la fotografía del profesional (DEC-104) y devuelve
	// al profesional ya con `PhotoUpdatedAt`. Reemplazar es idempotente por
	// naturaleza: nunca duplica la fila. photo ya llegó validada por
	// ValidatePhoto.
	PutPhoto(ctx context.Context, businessID, professionalID string, photo Photo) (PhotoResult, error)

	// GetPhoto lee la fotografía. found=false cubre tanto "el profesional no existe
	// o es de otro negocio" como "no tiene fotografía": para servir la imagen
	// ambos casos son el mismo 404 (CA-021-05).
	GetPhoto(ctx context.Context, businessID, professionalID string) (photo StoredPhoto, found bool, err error)

	// DeletePhoto borra la fotografía del profesional. found=false solo cuando el
	// profesional no existe o es de otro negocio; quitar una fotografía que no
	// existe es un éxito (idempotente).
	DeletePhoto(ctx context.Context, businessID, professionalID string) (found bool, err error)

	// GetLinked lee el profesional vinculado al usuario (DEC-100). found=false
	// cuando el usuario no tiene profesional.
	GetLinked(ctx context.Context, businessID, staffUserID string) (professional Professional, found bool, err error)

	// Link vincula al usuario con el profesional en UNA transacción: serializa las
	// operaciones del mismo usuario, libera su profesional anterior y toma el
	// nuevo solo si está libre o ya es suyo. Nunca pisa el vínculo de otro
	// usuario (Taken) ni cruza negocios (Found=false).
	Link(ctx context.Context, businessID, staffUserID, professionalID string) (LinkResult, error)

	// Unlink libera el profesional del usuario y devuelve su id ("" si no tenía).
	Unlink(ctx context.Context, businessID, staffUserID string) (releasedProfessionalID string, err error)
}

// PageResult es el modo numerado de la tabla (DEC-107); cursor conserva ListResult.
type PageResult struct {
	Items                             []Professional
	Page, PageSize, Total, TotalPages int
}
