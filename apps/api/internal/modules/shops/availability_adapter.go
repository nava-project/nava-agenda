package shops

import "context"

// AvailabilityBookingPolicy adapta la política de reserva al puerto que
// publicbooking.BookingPolicyPort declara para HU-094: mismo criterio
// estructural que TimezoneLookup frente a booking.TimezonePort -shops
// nunca importa publicbooking, y la firma usa solo tipos universales.
type AvailabilityBookingPolicy struct {
	service *BarberBookingPolicyService
}

// NewAvailabilityBookingPolicy construye el adaptador sobre el servicio de
// ventanas por barbero (DEC-169), que a su vez hereda de la política de la
// barbería (HU-093).
func NewAvailabilityBookingPolicy(service *BarberBookingPolicyService) AvailabilityBookingPolicy {
	return AvailabilityBookingPolicy{service: service}
}

// BookingPolicy implementa el método que publicbooking.BookingPolicyPort
// exige: la ventana EFECTIVA de barberID (propia o heredada, DEC-169)
// aplanada a los tres enteros que HU-094 necesita (RN-DIS-04, RN-DIS-06).
// El plazo y la política de cancelación no participan en la disponibilidad.
func (a AvailabilityBookingPolicy) BookingPolicy(ctx context.Context, barbershopID, barberID string) (
	minAdvanceMinutes, maxAdvanceDays, slotGridMinutes int, err error,
) {
	return a.service.Effective(ctx, barbershopID, barberID)
}
