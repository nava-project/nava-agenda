package catalog

import (
	"context"
	"fmt"

	"nava-agenda/internal/platform/apperr"
)

// AssignmentService implementa los tres casos de uso de HU-023: listar los
// servicios asignados a un profesional, asignar y desasignar. Vive en el
// paquete catalog porque catalog es el módulo dueño de la intención "qué
// servicios se prestan" (trabajo requerido §3.1); colabora con staff
// exclusivamente a través de ProfessionalPort, un puerto pequeño y explícito que
// cmd/api conecta con la implementación real (staff.NewProfessionalLookup),
// nunca importando el núcleo ni el repositorio de staff.
type AssignmentService struct {
	repo          AssignmentRepository
	professionals ProfessionalPort
}

// NewAssignmentService construye el servicio de casos de uso.
func NewAssignmentService(repo AssignmentRepository, professionals ProfessionalPort) *AssignmentService {
	return &AssignmentService{repo: repo, professionals: professionals}
}

// List lee una página de servicios asignados a professionalID dentro de
// businessID (CA-023-01). Un professionalID inexistente o de otro negocio
// produce apperr.NotFound (mismo criterio uniforme que staff.Service.Get),
// verificado mediante ProfessionalPort antes de tocar el repositorio de
// asignaciones.
func (s *AssignmentService) List(ctx context.Context, businessID, professionalID, cursorToken string, limit int) (AssignmentListResult, error) {
	if err := ctx.Err(); err != nil {
		return AssignmentListResult{}, apperr.Internal(fmt.Errorf("catalog: contexto cancelado antes de listar asignaciones: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return AssignmentListResult{}, errAssignmentProfessionalNotFound()
	}

	exists, err := s.professionals.Exists(ctx, businessID, professionalID)
	if err != nil {
		return AssignmentListResult{}, apperr.Internal(fmt.Errorf("catalog: verificar profesional para listar asignaciones: %w", err))
	}
	if !exists {
		return AssignmentListResult{}, errAssignmentProfessionalNotFound()
	}

	switch {
	case limit <= 0:
		limit = DefaultListLimit
	case limit < MinListLimit:
		limit = MinListLimit
	case limit > MaxListLimit:
		limit = MaxListLimit
	}

	var cursor *Cursor
	if cursorToken != "" {
		decoded, err := DecodeCursor(cursorToken)
		if err != nil {
			return AssignmentListResult{}, err
		}
		cursor = &decoded
	}

	result, err := s.repo.List(ctx, businessID, professionalID, cursor, limit)
	if err != nil {
		return AssignmentListResult{}, apperr.Internal(fmt.Errorf("catalog: listar asignaciones: %w", err))
	}
	return result, nil
}

// Assign crea la asociación entre professionalID y serviceID dentro de
// businessID (CA-023-02, CA-023-03): repetir exactamente la misma
// operación no crea una segunda fila (AssignOutcomeAlreadyExists). Un
// professionalID o serviceID inexistente o de otro negocio produce el mismo
// apperr.NotFound uniforme (CA-023-04): el primero se descubre mediante
// ProfessionalPort ANTES de tocar el repositorio (trabajo requerido §3.1); el
// segundo lo descubre Repository.Assign, dueño de la tabla `service`.
func (s *AssignmentService) Assign(ctx context.Context, businessID, professionalID, serviceID string) (AssignResult, error) {
	if err := ctx.Err(); err != nil {
		return AssignResult{}, apperr.Internal(fmt.Errorf("catalog: contexto cancelado antes de asignar servicio: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return AssignResult{}, errAssignmentProfessionalNotFound()
	}
	if !LooksLikeServiceID(serviceID) {
		return AssignResult{}, errServiceNotFound()
	}

	exists, err := s.professionals.Exists(ctx, businessID, professionalID)
	if err != nil {
		return AssignResult{}, apperr.Internal(fmt.Errorf("catalog: verificar profesional para asignar servicio: %w", err))
	}
	if !exists {
		return AssignResult{}, errAssignmentProfessionalNotFound()
	}

	result, err := s.repo.Assign(ctx, businessID, professionalID, serviceID)
	if err != nil {
		return AssignResult{}, apperr.Internal(fmt.Errorf("catalog: asignar servicio: %w", err))
	}
	if result.Outcome == AssignOutcomeServiceNotFound {
		return AssignResult{}, errServiceNotFound()
	}
	return result, nil
}

// IsAssigned informa si professionalID tiene asignado serviceID dentro de
// businessID (HU-061, DEC-072), sin verificar profesional ni servicio por
// separado: ManualBookingCatalog ya combina esto con CatalogService.Get
// para decidir found de forma uniforme.
func (s *AssignmentService) IsAssigned(ctx context.Context, businessID, professionalID, serviceID string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, apperr.Internal(fmt.Errorf("catalog: contexto cancelado antes de verificar asignación: %w", err))
	}
	exists, err := s.repo.Exists(ctx, businessID, professionalID, serviceID)
	if err != nil {
		return false, apperr.Internal(fmt.Errorf("catalog: verificar asignación: %w", err))
	}
	return exists, nil
}

// Unassign retira la asociación entre professionalID y serviceID dentro de
// businessID (CA-023-05). No existe tal asignación (profesional o servicio
// inexistente/ajeno, o la asociación concreta nunca existió) produce
// apperr.NotFound uniforme. Retirar a cualquier profesional es válido, también
// el último de un servicio activo (DEC-114, que sustituye a DEC-068): ese
// servicio deja de ofrecerse al público hasta que se asigne otro profesional.
func (s *AssignmentService) Unassign(ctx context.Context, businessID, professionalID, serviceID string) (UnassignResult, error) {
	if err := ctx.Err(); err != nil {
		return UnassignResult{}, apperr.Internal(fmt.Errorf("catalog: contexto cancelado antes de retirar servicio: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) || !LooksLikeServiceID(serviceID) {
		// Una forma inválida no puede corresponder a ninguna fila real: se
		// trata igual que "no existe esa asignación" (CA-023-04), sin
		// necesitar ProfessionalPort para este caso (a diferencia de List/Assign,
		// donde el profesional puede tener forma válida pero pertenecer a otra
		// negocio): Repository.Unassign ya distingue esa situación por la
		// ausencia de la fila de asociación.
		return UnassignResult{}, errAssignmentNotFound()
	}

	result, err := s.repo.Unassign(ctx, businessID, professionalID, serviceID)
	if err != nil {
		return UnassignResult{}, apperr.Internal(fmt.Errorf("catalog: retirar servicio: %w", err))
	}
	if result.Outcome == UnassignOutcomeNotFound {
		return UnassignResult{}, errAssignmentNotFound()
	}
	return result, nil
}
