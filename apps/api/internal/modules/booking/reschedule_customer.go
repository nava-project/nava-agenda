package booking

import (
	"context"
	"fmt"
	"strings"
	"time"

	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// CustomerRescheduleLimit es el máximo de reprogramaciones hechas por el
// propio cliente sobre un mismo turno (DEC-178, punto 3). Las del profesional no
// cuentan: él no necesita este freno porque decide sobre su propia agenda.
const CustomerRescheduleLimit = 2

// CustomerReschedulePolicy es el plazo con el que el cliente puede mover su
// turno (DEC-178, punto 2): el mismo `cancellation_deadline_minutes` de la
// cancelación (RN-CAN-01, DEC-083). Se lee dentro de la transacción, igual
// que CustomerCancellationPolicy.
type CustomerReschedulePolicy struct {
	DeadlineMinutes int
}

// Evaluate decide si el cliente puede reprogramar un turno que empieza en
// startsAt con el reloj del servidor en now. Hasta startsAt-DeadlineMinutes
// INCLUSIVE procede (mismo límite que la cancelación). No existe una
// reprogramación tardía: pasado el límite se rechaza aunque el negocio
// admita la cancelación tardía. Con DeadlineMinutes 0 (DEC-083 desactiva el
// «dentro de plazo») el cliente nunca puede reprogramar.
func (p CustomerReschedulePolicy) Evaluate(startsAt, now time.Time) error {
	if p.DeadlineMinutes <= 0 {
		return errRescheduleWindowClosed()
	}
	if now.After(startsAt.Add(-time.Duration(p.DeadlineMinutes) * time.Minute)) {
		return errRescheduleWindowClosed()
	}
	return nil
}

// EvaluateCustomerRescheduleCount rechaza una reprogramación más cuando el
// cliente ya hizo las que admite el turno (DEC-178, punto 3).
func EvaluateCustomerRescheduleCount(done int) error {
	if done >= CustomerRescheduleLimit {
		return errRescheduleLimitReached()
	}
	return nil
}

// CustomerRescheduleRemaining traduce las reprogramaciones ya hechas por el
// cliente a las que le quedan, nunca negativas.
func CustomerRescheduleRemaining(done int) int {
	if done >= CustomerRescheduleLimit {
		return 0
	}
	return CustomerRescheduleLimit - done
}

func errRescheduleWindowClosed() error {
	return apperr.RescheduleWindowClosed("el plazo para cambiar la hora por tu cuenta ya venció; contacta al negocio")
}

func errRescheduleLimitReached() error {
	return apperr.RescheduleLimitReached("ya cambiaste la hora de este turno las veces permitidas; contacta al negocio")
}

func errRescheduleSlotUnavailable() error {
	return apperr.ScheduleConflict("ese horario ya no está disponible; elige otro")
}

// RescheduleSlotsPort entrega los inicios que la reserva pública ofrecería
// para ese profesional y esa duración (HU-094), sin contar el propio turno
// [ownStartsAt, ownEndsAt) como ocupado (DEC-178, punto 4). Lo implementa
// publicbooking: booking nunca importa ese módulo (CA-002-06).
type RescheduleSlotsPort interface {
	OfferedRescheduleStarts(
		ctx context.Context,
		businessID, professionalID string,
		durationMinutes int,
		ownStartsAt, ownEndsAt time.Time,
	) ([]time.Time, error)
}

// CustomerRescheduleState es la lectura previa (sin bloqueo) del turno que el
// cliente quiere mover: lo justo para responder pronto con el rechazo correcto
// y para pedir las franjas. La verificación autoritativa se repite dentro de
// la transacción, con la fila bloqueada.
type CustomerRescheduleState struct {
	ProfessionalID      string
	DurationMinutes     int
	StartsAt            time.Time
	EndsAt              time.Time
	Status              Status
	DeadlineMinutes     int
	CustomerReschedules int
}

// RescheduleAppointmentByCustomerInput es la entrada validada que llega al
// repositorio. NewEndsAt sale de la duración del snapshot, nunca del cliente.
type RescheduleAppointmentByCustomerInput struct {
	AppointmentID        string
	NewStartsAt          time.Time
	NewEndsAt            time.Time
	ExpectedVersionToken string
	Now                  time.Time
}

// CustomerRescheduleRepository persiste la T2 del cliente (HU-104).
//
// RescheduleByCustomer usa una sola transacción tenant-aware con el protocolo
// de idempotencia (RN-IDE-01, DEC-043): Begin, bloquear la fila, verificar
// versión, estado, plazo y límite con la fila bloqueada, mover el intervalo
// (la exclusión de PostgreSQL decide los cruces), regenerar el recordatorio,
// publicar en Google y escribir el historial con actor `customer`, sin aviso
// al cliente (DEC-142). Un intervalo idéntico es un no-op exitoso.
type CustomerRescheduleRepository interface {
	CustomerRescheduleState(ctx context.Context, businessID, appointmentID string) (CustomerRescheduleState, bool, error)
	RescheduleByCustomer(
		ctx context.Context,
		businessID string,
		input RescheduleAppointmentByCustomerInput,
		key idempotency.Key,
		fingerprint idempotency.Fingerprint,
	) (RescheduleByCustomerResult, error)
}

// RescheduleByCustomerResult sigue el criterio de
// CancelAppointmentByCustomerResult: Decision distingue la aplicación de un
// Replay exacto o de un conflicto de idempotencia, y Response trae el cuerpo
// almacenado para reproducirlo.
type RescheduleByCustomerResult struct {
	Decision idempotency.Decision
	Response idempotency.StoredResponse
}

// RescheduleAppointmentByCustomerService implementa HU-104.
type RescheduleAppointmentByCustomerService struct {
	repo  CustomerRescheduleRepository
	slots RescheduleSlotsPort
	now   func() time.Time
}

// NewRescheduleAppointmentByCustomerService construye el caso de uso. now es
// el reloj del servidor; nil usa time.Now.
func NewRescheduleAppointmentByCustomerService(repo CustomerRescheduleRepository, slots RescheduleSlotsPort, now func() time.Time) *RescheduleAppointmentByCustomerService {
	if now == nil {
		now = time.Now
	}
	return &RescheduleAppointmentByCustomerService{repo: repo, slots: slots, now: now}
}

// ListRescheduleStarts devuelve los inicios a los que el cliente puede mover
// su turno. Un turno que no está `confirmed` no tiene franjas: no hay nada
// que mover.
func (s *RescheduleAppointmentByCustomerService) ListRescheduleStarts(ctx context.Context, businessID, appointmentID string) ([]time.Time, error) {
	state, err := s.readState(ctx, businessID, appointmentID)
	if err != nil {
		return nil, err
	}
	if state.Status != StatusConfirmed {
		return []time.Time{}, nil
	}
	return s.slots.OfferedRescheduleStarts(ctx, businessID, state.ProfessionalID, state.DurationMinutes, state.StartsAt, state.EndsAt)
}

// RescheduleAppointmentByCustomer valida la entrada y delega en el
// repositorio. businessID y appointmentID llegan resueltos desde el token
// por customeraccess; aquí nunca se aceptan del cliente. newStartsAtRaw es un
// instante RFC 3339 tal como lo ofreció ListRescheduleStarts.
//
// El orden de los rechazos previos (estado, plazo, límite y, al final, la
// franja) es el que la persona entiende: de nada sirve decirle que la hora
// está ocupada si ya no puede mover el turno.
func (s *RescheduleAppointmentByCustomerService) RescheduleAppointmentByCustomer(
	ctx context.Context,
	businessID, appointmentID, newStartsAtRaw, expectedVersionToken string,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (RescheduleByCustomerResult, error) {
	expectedVersionToken = strings.TrimSpace(expectedVersionToken)
	if expectedVersionToken == "" {
		return RescheduleByCustomerResult{}, errVersionTokenRequired()
	}
	newStartsAt, err := time.Parse(time.RFC3339, strings.TrimSpace(newStartsAtRaw))
	if err != nil {
		return RescheduleByCustomerResult{}, apperr.Validation("startsAt debe ser un instante RFC 3339")
	}

	state, err := s.readState(ctx, businessID, appointmentID)
	if err != nil {
		return RescheduleByCustomerResult{}, err
	}
	if state.Status != StatusConfirmed {
		return RescheduleByCustomerResult{}, errAppointmentNotConfirmed()
	}
	now := s.now()
	if err := (CustomerReschedulePolicy{DeadlineMinutes: state.DeadlineMinutes}).Evaluate(state.StartsAt, now); err != nil {
		return RescheduleByCustomerResult{}, err
	}
	if err := EvaluateCustomerRescheduleCount(state.CustomerReschedules); err != nil {
		return RescheduleByCustomerResult{}, err
	}

	offered, err := s.slots.OfferedRescheduleStarts(ctx, businessID, state.ProfessionalID, state.DurationMinutes, state.StartsAt, state.EndsAt)
	if err != nil {
		return RescheduleByCustomerResult{}, err
	}
	if !containsInstant(offered, newStartsAt) {
		return RescheduleByCustomerResult{}, errRescheduleSlotUnavailable()
	}

	return s.repo.RescheduleByCustomer(ctx, businessID, RescheduleAppointmentByCustomerInput{
		AppointmentID:        appointmentID,
		NewStartsAt:          newStartsAt,
		NewEndsAt:            newStartsAt.Add(time.Duration(state.DurationMinutes) * time.Minute),
		ExpectedVersionToken: expectedVersionToken,
		Now:                  now,
	}, key, fingerprint)
}

func (s *RescheduleAppointmentByCustomerService) readState(ctx context.Context, businessID, appointmentID string) (CustomerRescheduleState, error) {
	if err := ctx.Err(); err != nil {
		return CustomerRescheduleState{}, apperr.Internal(fmt.Errorf("booking: contexto cancelado antes de reprogramar: %w", err))
	}
	if !LooksLikeAppointmentID(appointmentID) {
		return CustomerRescheduleState{}, errAppointmentNotFound()
	}
	state, found, err := s.repo.CustomerRescheduleState(ctx, businessID, appointmentID)
	if err != nil {
		return CustomerRescheduleState{}, apperr.Internal(fmt.Errorf("booking: leer el turno antes de reprogramar: %w", err))
	}
	if !found {
		return CustomerRescheduleState{}, errAppointmentNotFound()
	}
	return state, nil
}

func containsInstant(list []time.Time, t time.Time) bool {
	for _, candidate := range list {
		if candidate.Equal(t) {
			return true
		}
	}
	return false
}
