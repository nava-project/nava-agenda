package staff

import (
	"context"

	"nava-agenda/internal/platform/apperr"
)

// ProfessionalLookup adapta *Service a un puerto mínimo y estable que otro módulo
// (catalog, HU-023) puede consumir sin importar el núcleo ni el repositorio
// de staff: solo esta única operación, expresamente pensada para
// consultarse desde fuera (trabajo requerido §3.1, "una operación pública
// estable de staff"). staff NUNCA importa catalog: la composición ocurre en
// cmd/api, la raíz de composición, que construye un ProfessionalLookup y lo pasa
// donde el otro módulo declare su propio puerto (catalog.ProfessionalPort); Go
// resuelve esa relación de forma puramente estructural, sin que ningún
// paquete de módulo importe al otro.
type ProfessionalLookup struct {
	service *Service
}

// NewProfessionalLookup construye el adaptador sobre un *Service ya existente
// (el mismo que staff/httpapi usa para sus propios handlers, cmd/api lo
// construye una sola vez).
func NewProfessionalLookup(service *Service) ProfessionalLookup {
	return ProfessionalLookup{service: service}
}

// Exists informa si existe un profesional con ese id en ese negocio. found es
// false tanto si el profesional no existe como si pertenece a otro negocio
// (RN-TEN-01): Service.Get ya unifica ambos casos en el mismo
// apperr.KindNotFound, que aquí simplemente se traduce a false en vez de
// propagarse como error, porque "no existe para este propósito" no es un
// fallo de la operación que llama a este puerto.
func (l ProfessionalLookup) Exists(ctx context.Context, businessID, professionalID string) (bool, error) {
	_, err := l.service.Get(ctx, businessID, professionalID)
	if err != nil {
		if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindNotFound {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
