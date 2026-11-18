package catalog

import (
	"context"

	"nava-agenda/internal/platform/apperr"
)

// ManualBookingCatalog adapta CatalogService y AssignmentService al puerto
// booking.ProfessionalServicePort (HU-061, DEC-072): catalog nunca importa
// booking, ni siquiera aquí; este adaptador satisface esa interfaz de
// forma puramente estructural (todos los tipos de la firma son
// universales), exactamente igual que staff.NewProfessionalLookup frente a
// catalog.ProfessionalPort. cmd/api (la raíz de composición) construye este
// valor y lo pasa donde booking.ProfessionalServicePort lo espera.
type ManualBookingCatalog struct {
	services    *CatalogService
	assignments *AssignmentService
}

// NewManualBookingCatalog construye el adaptador sobre los dos servicios de
// casos de uso ya existentes.
func NewManualBookingCatalog(services *CatalogService, assignments *AssignmentService) ManualBookingCatalog {
	return ManualBookingCatalog{services: services, assignments: assignments}
}

// ActiveAssignedService implementa el método que booking.ProfessionalServicePort
// exige: found=false cubre servicio inexistente, inactivo o no asignado a
// professionalID, sin distinguir la causa (RN-TEN-01, DEC-072). No verifica
// professionalID por separado: una asignación solo puede existir para un profesional
// real de este negocio (professional_service_business_id_professional_id_fk),
// así que "no asignado" ya cubre implícitamente "profesional inexistente".
func (a ManualBookingCatalog) ActiveAssignedService(ctx context.Context, businessID, professionalID, serviceID string) (
	name string, durationMinutes int, priceAmountCents int64, currency string, found bool, err error,
) {
	if !LooksLikeServiceID(serviceID) {
		return "", 0, 0, "", false, nil
	}

	assigned, err := a.assignments.IsAssigned(ctx, businessID, professionalID, serviceID)
	if err != nil {
		return "", 0, 0, "", false, err
	}
	if !assigned {
		return "", 0, 0, "", false, nil
	}

	service, err := a.services.Get(ctx, businessID, serviceID)
	if err != nil {
		if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindNotFound {
			return "", 0, 0, "", false, nil
		}
		return "", 0, 0, "", false, err
	}
	if !service.IsActive {
		return "", 0, 0, "", false, nil
	}

	return service.Name, service.DurationMinutes, service.PriceCents, service.Currency, true, nil
}
