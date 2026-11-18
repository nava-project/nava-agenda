package reviews

import "context"

// CreateOutcome distingue, solo hacia el servicio, lo que la base resolvió. El
// cliente nunca ve la diferencia entre NotAvailable y un token inválido más
// allá del código HTTP uniforme que fija el servicio (CA-100-01).
type CreateOutcome int

const (
	// Created: la reseña se guardó.
	Created CreateOutcome = iota
	// TokenNotFound: el hash no existe, venció o fue revocado.
	TokenNotFound
	// NotAvailable: el token es válido pero el turno no es calificable (no
	// completado, cancelado, o ya tiene reseña). La causa no se distingue.
	NotAvailable
)

// Repository es el puerto de persistencia de las reseñas.
type Repository interface {
	// CreateByTokenHash guarda la reseña del turno al que apunta el token, en una
	// sola sentencia que exige turno `completed` y ninguna reseña previa.
	CreateByTokenHash(ctx context.Context, tokenHash string, rating int, comment *string) (Review, CreateOutcome, error)
	// ListPublic devuelve el resumen y las reseñas visibles del profesional de la
	// negocio con ese slug. found=false cubre slug inválido o no publicable y
	// profesional inexistente o de otro negocio, sin distinguirlos.
	ListPublic(ctx context.Context, slug, professionalID string, limit int) (PublicList, bool, error)
	// ListForProfessional devuelve todas las reseñas del profesional del negocio de la
	// sesión (incluidas las ocultas). found=false si el profesional no existe ahí.
	ListForProfessional(ctx context.Context, businessID, professionalID string, limit int) (PanelList, bool, error)
	// SetHidden oculta (true) o vuelve a mostrar (false) una reseña del profesional.
	// Ocultar una ya oculta conserva su fecha original. found=false si la
	// reseña no existe para ese profesional en ese negocio.
	SetHidden(ctx context.Context, businessID, professionalID, reviewID string, hidden bool) (Review, bool, error)
}
