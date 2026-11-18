package staff

import (
	"context"
	"fmt"

	"nava-agenda/internal/platform/apperr"
)

// LinkResult es el desenlace de declarar «este profesional soy yo» (DEC-100).
//   - Found false: el profesional no existe o es de otro negocio (CA-021-05).
//   - Taken true: el profesional ya está vinculado a OTRO usuario; no se cambió nada.
//   - ReleasedProfessionalID: profesional que el usuario tenía antes y que esta
//     operación liberó (vacío si no tenía vínculo o era el mismo profesional).
type LinkResult struct {
	Professional           Professional
	Found                  bool
	Taken                  bool
	ReleasedProfessionalID string
}

// LinkObserver es el puerto de aviso de «vínculo cambiado o quitado»: otros
// módulos (la integración con Google Calendar, DEC-099) lo implementan para
// reaccionar cuando un profesional deja de pertenecer a un usuario, y lo
// registran en la raíz de composición (cmd/api); staff nunca los importa.
//
// Se invoca DESPUÉS de confirmar la transacción y sin garantía de entrega: el
// vínculo ya cambió aunque el observador falle, así que un consumidor que
// necesite consistencia estricta debe además reconciliar al leer.
type LinkObserver interface {
	ProfessionalLinkReleased(ctx context.Context, businessID, professionalID string)
}

// ObserveLinkReleased registra un observador del aviso de vínculo liberado.
// Se llama durante la composición, antes de atender solicitudes.
func (s *Service) ObserveLinkReleased(observer LinkObserver) {
	s.observers = append(s.observers, observer)
}

func (s *Service) notifyReleased(ctx context.Context, businessID, professionalID string) {
	if professionalID == "" {
		return
	}
	for _, observer := range s.observers {
		observer.ProfessionalLinkReleased(ctx, businessID, professionalID)
	}
}

// errNoLinkedProfessional es el 404 de «no tienes un profesional vinculado»: el vínculo
// es opcional (DEC-100), no un fallo.
func errNoLinkedProfessional() error {
	return apperr.NotFound("el usuario no tiene un profesional vinculado")
}

// errProfessionalTaken es el 409 de «ese profesional ya es de otro usuario». No revela
// quién es: el mensaje es el mismo sea cual sea el otro usuario.
func errProfessionalTaken() error {
	return apperr.Conflict("ese profesional ya está vinculado a otro usuario")
}

// LinkedProfessional devuelve el profesional del usuario autenticado. staffUserID llega
// siempre de un auth.Principal ya autenticado: nunca de la solicitud (DEC-100).
func (s *Service) LinkedProfessional(ctx context.Context, businessID, staffUserID string) (Professional, error) {
	if err := ctx.Err(); err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de leer el profesional propio: %w", err))
	}
	professional, found, err := s.repo.GetLinked(ctx, businessID, staffUserID)
	if err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: leer profesional propio: %w", err))
	}
	if !found {
		return Professional{}, errNoLinkedProfessional()
	}
	return professional, nil
}

// LinkMyProfessional vincula al usuario autenticado con professionalID, liberando el
// profesional que tuviera antes. Es idempotente: repetir la misma selección deja
// el mismo estado. Un profesional ya vinculado a otro usuario responde conflicto
// y conserva el vínculo anterior del solicitante.
func (s *Service) LinkMyProfessional(ctx context.Context, businessID, staffUserID, professionalID string) (Professional, error) {
	if err := ctx.Err(); err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de vincular el profesional propio: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return Professional{}, errProfessionalNotFound()
	}

	result, err := s.repo.Link(ctx, businessID, staffUserID, professionalID)
	if err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: vincular profesional propio: %w", err))
	}
	if !result.Found {
		return Professional{}, errProfessionalNotFound()
	}
	if result.Taken {
		return Professional{}, errProfessionalTaken()
	}
	s.notifyReleased(ctx, businessID, result.ReleasedProfessionalID)
	return result.Professional, nil
}

// UnlinkMyProfessional quita el vínculo del usuario autenticado. Sin vínculo es un
// éxito: la operación es idempotente. No borra ni desactiva al profesional.
func (s *Service) UnlinkMyProfessional(ctx context.Context, businessID, staffUserID string) error {
	if err := ctx.Err(); err != nil {
		return apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de quitar el vínculo: %w", err))
	}
	released, err := s.repo.Unlink(ctx, businessID, staffUserID)
	if err != nil {
		return apperr.Internal(fmt.Errorf("staff: quitar vínculo del profesional propio: %w", err))
	}
	s.notifyReleased(ctx, businessID, released)
	return nil
}

// UserProfessionalLookup adapta *Service a un puerto mínimo que otro módulo puede
// consumir para resolver «el profesional del usuario autenticado» sin importar el
// núcleo de staff (mismo patrón que ProfessionalLookup).
type UserProfessionalLookup struct {
	service *Service
}

// NewUserProfessionalLookup construye el adaptador sobre el *Service compartido.
func NewUserProfessionalLookup(service *Service) UserProfessionalLookup {
	return UserProfessionalLookup{service: service}
}

// ProfessionalIDOfUser devuelve el id del profesional vinculado a staffUserID. found es
// false si el usuario no tiene profesional (no es un error: el vínculo es opcional).
func (l UserProfessionalLookup) ProfessionalIDOfUser(ctx context.Context, businessID, staffUserID string) (professionalID string, found bool, err error) {
	professional, err := l.service.LinkedProfessional(ctx, businessID, staffUserID)
	if err != nil {
		if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindNotFound {
			return "", false, nil
		}
		return "", false, err
	}
	return professional.ID, true, nil
}
