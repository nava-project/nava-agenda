package shops

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"system-barbershop/internal/platform/apperr"
)

// BarberBookingPolicy es la ventana de reserva pública propia de un barbero
// (DEC-169): anticipación mínima, ventana máxima y paso de rejilla. Que
// exista significa "configuración propia"; que no exista, que el barbero
// hereda la de la barbería (BookingPolicy). El plazo y la política de
// cancelación no forman parte: siguen siendo solo de la barbería.
type BarberBookingPolicy struct {
	BarberID          string
	MinAdvanceMinutes int
	MaxAdvanceDays    int
	SlotGridMinutes   int
	UpdatedAt         time.Time
}

// BarberBookingPolicyInput es la entrada cruda de PUT
// /private/settings/booking-policy/barbers/{barberId}, sin validar todavía.
type BarberBookingPolicyInput struct {
	MinAdvanceMinutes int
	MaxAdvanceDays    int
	SlotGridMinutes   int
}

// BarberBookingPolicyRepository es el puerto de persistencia de las
// configuraciones propias por barbero (DEC-169). Todas las operaciones
// corren en una transacción tenant-aware; RLS restringe las filas visibles
// a la barbería vigente.
type BarberBookingPolicyRepository interface {
	// List devuelve las configuraciones propias de la barbería, ordenadas por
	// barber_id. Un barbero ausente hereda.
	List(ctx context.Context, barbershopID string) ([]BarberBookingPolicy, error)

	// Get lee la configuración propia de barberID. found=false significa que
	// hereda (o que el barbero no es visible en el tenant: el llamador no
	// distingue, ambas cosas implican usar la de la barbería).
	Get(ctx context.Context, barbershopID, barberID string) (policy BarberBookingPolicy, found bool, err error)

	// Upsert crea o reemplaza la configuración propia de barberID con
	// valores YA validados. barberFound=false cuando el barbero no existe en
	// el tenant vigente (la FK compuesta lo rechaza): CERO escritura.
	Upsert(ctx context.Context, barbershopID, barberID string, input BarberBookingPolicyInput) (policy BarberBookingPolicy, barberFound bool, err error)

	// Delete borra la configuración propia de barberID (vuelve a heredar).
	// Idempotente: borrar una que no existe no es un error.
	Delete(ctx context.Context, barbershopID, barberID string) error
}

// barberIDShapePattern valida la forma canónica de un uuid antes de que el
// identificador llegue a PostgreSQL: una forma inválida es un 404 uniforme,
// nunca un error de tipo (mismo criterio que staff.LooksLikeBarberID, que
// shops no importa).
var barberIDShapePattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// BarberBookingPolicyService implementa DEC-169: leer, guardar y quitar la
// ventana propia de un barbero, y resolver la ventana EFECTIVA (propia o
// heredada) que usa la disponibilidad pública.
type BarberBookingPolicyService struct {
	repo   BarberBookingPolicyRepository
	shared *BookingPolicyService
}

// NewBarberBookingPolicyService construye el servicio sobre el repositorio
// propio y el servicio de la política de la barbería (de donde se hereda).
func NewBarberBookingPolicyService(repo BarberBookingPolicyRepository, shared *BookingPolicyService) *BarberBookingPolicyService {
	return &BarberBookingPolicyService{repo: repo, shared: shared}
}

// List devuelve las configuraciones propias de la barbería activa.
func (s *BarberBookingPolicyService) List(ctx context.Context, barbershopID string) ([]BarberBookingPolicy, error) {
	if err := ctx.Err(); err != nil {
		return nil, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de listar ventanas por barbero: %w", err))
	}
	policies, err := s.repo.List(ctx, barbershopID)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("shops: listar ventanas por barbero: %w", err))
	}
	return policies, nil
}

// Put valida input con los mismos rangos y la misma coherencia que la
// política de la barbería (DEC-083, DEC-133) y guarda la configuración
// propia de barberID. Reemplazo completo e idempotente, sin If-Match
// (DEC-169).
func (s *BarberBookingPolicyService) Put(ctx context.Context, barbershopID, barberID string, input BarberBookingPolicyInput) (BarberBookingPolicy, error) {
	if err := ctx.Err(); err != nil {
		return BarberBookingPolicy{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de guardar la ventana del barbero: %w", err))
	}
	if !barberIDShapePattern.MatchString(barberID) {
		return BarberBookingPolicy{}, errBarberForPolicyNotFound()
	}
	if err := validateBookingWindow(input.MinAdvanceMinutes, input.MaxAdvanceDays, input.SlotGridMinutes); err != nil {
		return BarberBookingPolicy{}, err
	}

	policy, barberFound, err := s.repo.Upsert(ctx, barbershopID, barberID, input)
	if err != nil {
		return BarberBookingPolicy{}, apperr.Internal(fmt.Errorf("shops: guardar ventana del barbero: %w", err))
	}
	if !barberFound {
		return BarberBookingPolicy{}, errBarberForPolicyNotFound()
	}
	return policy, nil
}

// Delete quita la configuración propia de barberID: vuelve a heredar.
// Idempotente; un identificador con forma inválida es un 404 uniforme.
func (s *BarberBookingPolicyService) Delete(ctx context.Context, barbershopID, barberID string) error {
	if err := ctx.Err(); err != nil {
		return apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de quitar la ventana del barbero: %w", err))
	}
	if !barberIDShapePattern.MatchString(barberID) {
		return errBarberForPolicyNotFound()
	}
	if err := s.repo.Delete(ctx, barbershopID, barberID); err != nil {
		return apperr.Internal(fmt.Errorf("shops: quitar ventana del barbero: %w", err))
	}
	return nil
}

// Effective resuelve la ventana que rige la reserva pública con barberID:
// la propia si existe; si no, la de la barbería (DEC-169).
func (s *BarberBookingPolicyService) Effective(ctx context.Context, barbershopID, barberID string) (
	minAdvanceMinutes, maxAdvanceDays, slotGridMinutes int, err error,
) {
	if barberIDShapePattern.MatchString(barberID) {
		own, found, err := s.repo.Get(ctx, barbershopID, barberID)
		if err != nil {
			return 0, 0, 0, apperr.Internal(fmt.Errorf("shops: leer ventana del barbero: %w", err))
		}
		if found {
			return own.MinAdvanceMinutes, own.MaxAdvanceDays, own.SlotGridMinutes, nil
		}
	}
	shared, err := s.shared.Get(ctx, barbershopID)
	if err != nil {
		return 0, 0, 0, err
	}
	return shared.MinAdvanceMinutes, shared.MaxAdvanceDays, shared.SlotGridMinutes, nil
}

// validateBookingWindow aplica los rangos de DEC-083/DEC-133 y la coherencia
// anticipación < ventana a los tres valores de una ventana de reserva, en un
// orden fijo; el primer error es el que se devuelve. La comparten la política
// de la barbería y la de cada barbero, para que nunca diverjan.
func validateBookingWindow(minAdvanceMinutes, maxAdvanceDays, slotGridMinutes int) error {
	switch {
	case minAdvanceMinutes < MinAdvanceMinutesFloor || minAdvanceMinutes > MinAdvanceMinutesCeil:
		return errBookingPolicyFieldOutOfRange("minAdvanceMinutes")
	case maxAdvanceDays < MaxAdvanceDaysFloor || maxAdvanceDays > MaxAdvanceDaysCeil:
		return errBookingPolicyFieldOutOfRange("maxAdvanceDays")
	case slotGridMinutes < SlotGridMinutesFloor || slotGridMinutes > SlotGridMinutesCeil:
		return errBookingPolicyFieldOutOfRange("slotGridMinutes")
	}
	// Mismo criterio que barbershop_min_advance_vs_window_ck: la anticipación
	// mínima no puede alcanzar ni superar toda la ventana, o ninguna franja
	// quedaría reservable.
	if minAdvanceMinutes >= maxAdvanceDays*1440 {
		return errBookingPolicyAdvanceExceedsWindow()
	}
	return nil
}
