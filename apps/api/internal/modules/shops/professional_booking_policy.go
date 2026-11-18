package shops

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"nava-agenda/internal/platform/apperr"
)

// ProfessionalBookingPolicy es la ventana de reserva pública propia de un profesional
// (DEC-169): anticipación mínima, ventana máxima y paso de rejilla. Que
// exista significa "configuración propia"; que no exista, que el profesional
// hereda la del negocio (BookingPolicy). El plazo y la política de
// cancelación no forman parte: siguen siendo solo del negocio.
type ProfessionalBookingPolicy struct {
	ProfessionalID    string
	MinAdvanceMinutes int
	MaxAdvanceDays    int
	SlotGridMinutes   int
	UpdatedAt         time.Time
}

// ProfessionalBookingPolicyInput es la entrada cruda de PUT
// /private/settings/booking-policy/professionals/{professionalId}, sin validar todavía.
type ProfessionalBookingPolicyInput struct {
	MinAdvanceMinutes int
	MaxAdvanceDays    int
	SlotGridMinutes   int
}

// ProfessionalBookingPolicyRepository es el puerto de persistencia de las
// configuraciones propias por profesional (DEC-169). Todas las operaciones
// corren en una transacción tenant-aware; RLS restringe las filas visibles
// al negocio vigente.
type ProfessionalBookingPolicyRepository interface {
	// List devuelve las configuraciones propias del negocio, ordenadas por
	// professional_id. Un profesional ausente hereda.
	List(ctx context.Context, businessID string) ([]ProfessionalBookingPolicy, error)

	// Get lee la configuración propia de professionalID. found=false significa que
	// hereda (o que el profesional no es visible en el tenant: el llamador no
	// distingue, ambas cosas implican usar la del negocio).
	Get(ctx context.Context, businessID, professionalID string) (policy ProfessionalBookingPolicy, found bool, err error)

	// Upsert crea o reemplaza la configuración propia de professionalID con
	// valores YA validados. professionalFound=false cuando el profesional no existe en
	// el tenant vigente (la FK compuesta lo rechaza): CERO escritura.
	Upsert(ctx context.Context, businessID, professionalID string, input ProfessionalBookingPolicyInput) (policy ProfessionalBookingPolicy, professionalFound bool, err error)

	// Delete borra la configuración propia de professionalID (vuelve a heredar).
	// Idempotente: borrar una que no existe no es un error.
	Delete(ctx context.Context, businessID, professionalID string) error
}

// professionalIDShapePattern valida la forma canónica de un uuid antes de que el
// identificador llegue a PostgreSQL: una forma inválida es un 404 uniforme,
// nunca un error de tipo (mismo criterio que staff.LooksLikeProfessionalID, que
// shops no importa).
var professionalIDShapePattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ProfessionalBookingPolicyService implementa DEC-169: leer, guardar y quitar la
// ventana propia de un profesional, y resolver la ventana EFECTIVA (propia o
// heredada) que usa la disponibilidad pública.
type ProfessionalBookingPolicyService struct {
	repo   ProfessionalBookingPolicyRepository
	shared *BookingPolicyService
}

// NewProfessionalBookingPolicyService construye el servicio sobre el repositorio
// propio y el servicio de la política del negocio (de donde se hereda).
func NewProfessionalBookingPolicyService(repo ProfessionalBookingPolicyRepository, shared *BookingPolicyService) *ProfessionalBookingPolicyService {
	return &ProfessionalBookingPolicyService{repo: repo, shared: shared}
}

// List devuelve las configuraciones propias del negocio activo.
func (s *ProfessionalBookingPolicyService) List(ctx context.Context, businessID string) ([]ProfessionalBookingPolicy, error) {
	if err := ctx.Err(); err != nil {
		return nil, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de listar ventanas por profesional: %w", err))
	}
	policies, err := s.repo.List(ctx, businessID)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("shops: listar ventanas por profesional: %w", err))
	}
	return policies, nil
}

// Put valida input con los mismos rangos y la misma coherencia que la
// política del negocio (DEC-083, DEC-133) y guarda la configuración
// propia de professionalID. Reemplazo completo e idempotente, sin If-Match
// (DEC-169).
func (s *ProfessionalBookingPolicyService) Put(ctx context.Context, businessID, professionalID string, input ProfessionalBookingPolicyInput) (ProfessionalBookingPolicy, error) {
	if err := ctx.Err(); err != nil {
		return ProfessionalBookingPolicy{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de guardar la ventana del profesional: %w", err))
	}
	if !professionalIDShapePattern.MatchString(professionalID) {
		return ProfessionalBookingPolicy{}, errProfessionalForPolicyNotFound()
	}
	if err := validateBookingWindow(input.MinAdvanceMinutes, input.MaxAdvanceDays, input.SlotGridMinutes); err != nil {
		return ProfessionalBookingPolicy{}, err
	}

	policy, professionalFound, err := s.repo.Upsert(ctx, businessID, professionalID, input)
	if err != nil {
		return ProfessionalBookingPolicy{}, apperr.Internal(fmt.Errorf("shops: guardar ventana del profesional: %w", err))
	}
	if !professionalFound {
		return ProfessionalBookingPolicy{}, errProfessionalForPolicyNotFound()
	}
	return policy, nil
}

// Delete quita la configuración propia de professionalID: vuelve a heredar.
// Idempotente; un identificador con forma inválida es un 404 uniforme.
func (s *ProfessionalBookingPolicyService) Delete(ctx context.Context, businessID, professionalID string) error {
	if err := ctx.Err(); err != nil {
		return apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de quitar la ventana del profesional: %w", err))
	}
	if !professionalIDShapePattern.MatchString(professionalID) {
		return errProfessionalForPolicyNotFound()
	}
	if err := s.repo.Delete(ctx, businessID, professionalID); err != nil {
		return apperr.Internal(fmt.Errorf("shops: quitar ventana del profesional: %w", err))
	}
	return nil
}

// Effective resuelve la ventana que rige la reserva pública con professionalID:
// la propia si existe; si no, la del negocio (DEC-169).
func (s *ProfessionalBookingPolicyService) Effective(ctx context.Context, businessID, professionalID string) (
	minAdvanceMinutes, maxAdvanceDays, slotGridMinutes int, err error,
) {
	if professionalIDShapePattern.MatchString(professionalID) {
		own, found, err := s.repo.Get(ctx, businessID, professionalID)
		if err != nil {
			return 0, 0, 0, apperr.Internal(fmt.Errorf("shops: leer ventana del profesional: %w", err))
		}
		if found {
			return own.MinAdvanceMinutes, own.MaxAdvanceDays, own.SlotGridMinutes, nil
		}
	}
	shared, err := s.shared.Get(ctx, businessID)
	if err != nil {
		return 0, 0, 0, err
	}
	return shared.MinAdvanceMinutes, shared.MaxAdvanceDays, shared.SlotGridMinutes, nil
}

// validateBookingWindow aplica los rangos de DEC-083/DEC-133 y la coherencia
// anticipación < ventana a los tres valores de una ventana de reserva, en un
// orden fijo; el primer error es el que se devuelve. La comparten la política
// del negocio y la de cada profesional, para que nunca diverjan.
func validateBookingWindow(minAdvanceMinutes, maxAdvanceDays, slotGridMinutes int) error {
	switch {
	case minAdvanceMinutes < MinAdvanceMinutesFloor || minAdvanceMinutes > MinAdvanceMinutesCeil:
		return errBookingPolicyFieldOutOfRange("minAdvanceMinutes")
	case maxAdvanceDays < MaxAdvanceDaysFloor || maxAdvanceDays > MaxAdvanceDaysCeil:
		return errBookingPolicyFieldOutOfRange("maxAdvanceDays")
	case slotGridMinutes < SlotGridMinutesFloor || slotGridMinutes > SlotGridMinutesCeil:
		return errBookingPolicyFieldOutOfRange("slotGridMinutes")
	}
	// Mismo criterio que business_min_advance_vs_window_ck: la anticipación
	// mínima no puede alcanzar ni superar toda la ventana, o ninguna franja
	// quedaría reservable.
	if minAdvanceMinutes >= maxAdvanceDays*1440 {
		return errBookingPolicyAdvanceExceedsWindow()
	}
	return nil
}
