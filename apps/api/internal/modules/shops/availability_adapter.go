package shops

import "context"

// AvailabilityBookingPolicy adapta la política de reserva al puerto que
// publicbooking.BookingPolicyPort declara para HU-094: mismo criterio
// estructural que TimezoneLookup frente a booking.TimezonePort -shops
// nunca importa publicbooking, y la firma usa solo tipos universales.
type AvailabilityBookingPolicy struct {
	service *ProfessionalBookingPolicyService
}

// NewAvailabilityBookingPolicy construye el adaptador sobre el servicio de
// ventanas por profesional (DEC-169), que a su vez hereda de la política de la
// negocio (HU-093).
func NewAvailabilityBookingPolicy(service *ProfessionalBookingPolicyService) AvailabilityBookingPolicy {
	return AvailabilityBookingPolicy{service: service}
}

// BookingPolicy implementa el método que publicbooking.BookingPolicyPort
// exige: la ventana EFECTIVA de professionalID (propia o heredada, DEC-169)
// aplanada a los tres enteros que HU-094 necesita (RN-DIS-04, RN-DIS-06).
// El plazo y la política de cancelación no participan en la disponibilidad.
func (a AvailabilityBookingPolicy) BookingPolicy(ctx context.Context, businessID, professionalID string) (
	minAdvanceMinutes, maxAdvanceDays, slotGridMinutes int, err error,
) {
	return a.service.Effective(ctx, businessID, professionalID)
}
