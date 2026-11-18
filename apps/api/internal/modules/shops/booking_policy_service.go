package shops

import (
	"context"
	"fmt"

	"nava-agenda/internal/platform/apperr"
)

// BookingPolicyService implementa el caso de uso de HU-093: leer y
// actualizar la configuración pública de reserva y cancelación de la
// negocio activo. Vive en el paquete shops porque shops es el módulo
// dueño de la configuración del negocio (HU-020); no comparte Service
// (HU-020) para no acoplar la precondición de versión de HU-093 a un
// endpoint que nunca la tuvo.
type BookingPolicyService struct {
	repo BookingPolicyRepository
}

// NewBookingPolicyService construye el servicio.
func NewBookingPolicyService(repo BookingPolicyRepository) *BookingPolicyService {
	return &BookingPolicyService{repo: repo}
}

// Get lee la política de reserva del negocio businessID. businessID
// llega siempre de un auth.Principal ya autenticado (CA-093-03); este
// método no acepta ni valida ningún identificador que el cliente pueda
// controlar.
func (s *BookingPolicyService) Get(ctx context.Context, businessID string) (BookingPolicy, error) {
	if err := ctx.Err(); err != nil {
		return BookingPolicy{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de leer la política de reserva: %w", err))
	}

	policy, found, err := s.repo.Get(ctx, businessID)
	if err != nil {
		return BookingPolicy{}, apperr.Internal(fmt.Errorf("shops: leer política de reserva: %w", err))
	}
	if !found {
		return BookingPolicy{}, apperr.NotFound("negocio no encontrado")
	}
	return policy, nil
}

// BookingPolicyInput es la entrada cruda del caso de uso de actualización,
// tal como llega del handler HTTP: sin validar todavía.
// ExpectedVersionToken llega de la cabecera If-Match (CA-093-02).
type BookingPolicyInput struct {
	MinAdvanceMinutes              int
	MaxAdvanceDays                 int
	SlotGridMinutes                int
	CancellationDeadlineMinutes    int
	LateCancellationClientAllowed  bool
	LateCancellationReasonRequired bool
	ExpectedVersionToken           string
}

// Update valida input contra los rangos de DEC-083 y las combinaciones
// coherentes exigidas por CA-093-02 y, si pasa todas las comprobaciones,
// delega en el repositorio la comparación de versión y la escritura
// atómica de contrato cerrado (PUT: los seis campos siempre presentes,
// nunca una actualización parcial). Los campos se evalúan en un orden
// fijo; el primer error encontrado es el que se devuelve, sin ejecutar
// ninguna escritura (mismo criterio que shops.Service.Update).
func (s *BookingPolicyService) Update(ctx context.Context, businessID string, input BookingPolicyInput) (BookingPolicy, error) {
	if err := ctx.Err(); err != nil {
		return BookingPolicy{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de actualizar la política de reserva: %w", err))
	}

	if input.ExpectedVersionToken == "" {
		return BookingPolicy{}, errBookingPolicyVersionTokenRequired()
	}

	// Mismo orden de evaluación que antes de DEC-169: rangos de la ventana,
	// rango del plazo, coherencia de cancelación y, al final, anticipación
	// frente a la ventana. La parte de la ventana la comparte con la
	// política de cada profesional (validateBookingWindow).
	windowErr := validateBookingWindow(input.MinAdvanceMinutes, input.MaxAdvanceDays, input.SlotGridMinutes)
	if windowErr != nil && !isAdvanceExceedsWindow(input) {
		return BookingPolicy{}, windowErr
	}
	if input.CancellationDeadlineMinutes < CancellationDeadlineMinutesFloor || input.CancellationDeadlineMinutes > CancellationDeadlineMinutesCeil {
		return BookingPolicy{}, errBookingPolicyFieldOutOfRange("cancellationDeadlineMinutes")
	}

	// CA-093-02: combinación incoherente (exigir motivo para una
	// cancelación tardía que el cliente ni siquiera puede hacer).
	if input.LateCancellationReasonRequired && !input.LateCancellationClientAllowed {
		return BookingPolicy{}, errBookingPolicyIncoherentCancellationPolicy()
	}
	if windowErr != nil {
		return BookingPolicy{}, windowErr
	}

	result, err := s.repo.Update(ctx, businessID, BookingPolicyUpdateInput{
		MinAdvanceMinutes:              input.MinAdvanceMinutes,
		MaxAdvanceDays:                 input.MaxAdvanceDays,
		SlotGridMinutes:                input.SlotGridMinutes,
		CancellationDeadlineMinutes:    input.CancellationDeadlineMinutes,
		LateCancellationClientAllowed:  input.LateCancellationClientAllowed,
		LateCancellationReasonRequired: input.LateCancellationReasonRequired,
		ExpectedVersionToken:           input.ExpectedVersionToken,
	})
	if err != nil {
		return BookingPolicy{}, apperr.Internal(fmt.Errorf("shops: actualizar política de reserva: %w", err))
	}
	switch result.Outcome {
	case BookingPolicyUpdateOutcomeVersionConflict:
		return BookingPolicy{}, errBookingPolicyVersionConflict()
	case BookingPolicyUpdateOutcomeNotFound:
		return BookingPolicy{}, apperr.NotFound("negocio no encontrado")
	}
	return result.Policy, nil
}

// isAdvanceExceedsWindow indica si la única falla de la ventana de input es
// la coherencia anticipación < ventana (con los tres valores en rango): esa
// comprobación se evalúa después de las de cancelación, como antes de
// DEC-169.
func isAdvanceExceedsWindow(input BookingPolicyInput) bool {
	inRange := input.MinAdvanceMinutes >= MinAdvanceMinutesFloor && input.MinAdvanceMinutes <= MinAdvanceMinutesCeil &&
		input.MaxAdvanceDays >= MaxAdvanceDaysFloor && input.MaxAdvanceDays <= MaxAdvanceDaysCeil &&
		input.SlotGridMinutes >= SlotGridMinutesFloor && input.SlotGridMinutes <= SlotGridMinutesCeil
	return inRange && input.MinAdvanceMinutes >= input.MaxAdvanceDays*1440
}
