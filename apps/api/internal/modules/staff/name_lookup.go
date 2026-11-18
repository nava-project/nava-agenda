package staff

import (
	"context"

	"nava-agenda/internal/platform/apperr"
)

// ProfessionalNameLookup adapta *Service a un puerto mínimo y estable (booking.
// ProfessionalNamePort, HU-064) para que otro módulo resuelva el nombre visible de
// un profesional sin importar staff ni su repositorio: mismo criterio que
// ProfessionalLookup frente a catalog.ProfessionalPort. staff NUNCA importa booking: la
// composición ocurre en cmd/api.
type ProfessionalNameLookup struct {
	service *Service
}

// NewProfessionalNameLookup construye el adaptador sobre un *Service ya existente
// (el mismo que ProfessionalLookup y staff/httpapi reutilizan).
func NewProfessionalNameLookup(service *Service) ProfessionalNameLookup {
	return ProfessionalNameLookup{service: service}
}

// Name informa el nombre visible de un profesional por id, dentro de esa
// negocio. found es false tanto si el profesional no existe como si pertenece
// a otro negocio (RN-TEN-01), mismo criterio que ProfessionalLookup.Exists.
func (l ProfessionalNameLookup) Name(ctx context.Context, businessID, professionalID string) (string, bool, error) {
	professional, err := l.service.Get(ctx, businessID, professionalID)
	if err != nil {
		if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindNotFound {
			return "", false, nil
		}
		return "", false, err
	}
	return professional.FullName, true, nil
}
