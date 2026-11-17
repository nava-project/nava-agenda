package booking

import (
	"context"
	"time"

	"system-barbershop/internal/platform/idempotency"
)

// CustomerAppointmentCancellerAdapter satisface, de forma puramente
// estructural, customeraccess.AppointmentCanceller (HU-099): traduce los tipos
// universales de ese puerto hacia CancelAppointmentByCustomerRequest. Mismo
// criterio que PublicAppointmentAdapter: customeraccess nunca importa booking
// (CA-002-06); el adaptador vive aquí porque booking sí puede conocer los tipos
// universales que el puerto expone.
type CustomerAppointmentCancellerAdapter struct {
	service *CancelAppointmentByCustomerService
}

// NewCustomerAppointmentCancellerAdapter construye el adaptador.
func NewCustomerAppointmentCancellerAdapter(service *CancelAppointmentByCustomerService) CustomerAppointmentCancellerAdapter {
	return CustomerAppointmentCancellerAdapter{service: service}
}

// CancelAppointment implementa customeraccess.AppointmentCanceller.
func (a CustomerAppointmentCancellerAdapter) CancelAppointment(
	ctx context.Context,
	barbershopID, appointmentID, expectedVersionToken, reason string,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (idempotency.Decision, idempotency.StoredResponse, error) {
	result, err := a.service.CancelAppointmentByCustomer(ctx, barbershopID, CancelAppointmentByCustomerRequest{
		AppointmentID:        appointmentID,
		ExpectedVersionToken: expectedVersionToken,
		Reason:               reason,
	}, key, fingerprint)
	if err != nil {
		return idempotency.Decision{}, idempotency.StoredResponse{}, err
	}
	return result.Decision, result.Response, nil
}

// CustomerAppointmentReschedulerAdapter satisface
// customeraccess.AppointmentRescheduler (HU-104) con el caso de uso de booking,
// sin que customeraccess importe booking (mismo criterio que la cancelación).
type CustomerAppointmentReschedulerAdapter struct {
	service *RescheduleAppointmentByCustomerService
}

// NewCustomerAppointmentReschedulerAdapter construye el adaptador.
func NewCustomerAppointmentReschedulerAdapter(service *RescheduleAppointmentByCustomerService) CustomerAppointmentReschedulerAdapter {
	return CustomerAppointmentReschedulerAdapter{service: service}
}

// ListRescheduleStarts implementa customeraccess.AppointmentRescheduler.
func (a CustomerAppointmentReschedulerAdapter) ListRescheduleStarts(ctx context.Context, barbershopID, appointmentID string) ([]time.Time, error) {
	return a.service.ListRescheduleStarts(ctx, barbershopID, appointmentID)
}

// RescheduleAppointment implementa customeraccess.AppointmentRescheduler.
func (a CustomerAppointmentReschedulerAdapter) RescheduleAppointment(
	ctx context.Context,
	barbershopID, appointmentID, startsAt, expectedVersionToken string,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (idempotency.Decision, idempotency.StoredResponse, error) {
	result, err := a.service.RescheduleAppointmentByCustomer(ctx, barbershopID, appointmentID, startsAt, expectedVersionToken, key, fingerprint)
	if err != nil {
		return idempotency.Decision{}, idempotency.StoredResponse{}, err
	}
	return result.Decision, result.Response, nil
}
