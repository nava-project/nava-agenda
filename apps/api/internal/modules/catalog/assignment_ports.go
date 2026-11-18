package catalog

import "context"

// ProfessionalPort es el puerto pequeño y explícito que AssignmentService
// consulta para verificar que un profesional pertenece al negocio vigente,
// sin que el núcleo de catalog importe el núcleo ni el repositorio de staff
// (HU-023, trabajo requerido §3.1: "La existencia/pertenencia de un
// profesional se consulta mediante un puerto explícito ..., no mediante
// acoplamiento del núcleo a su repositorio"). cmd/api (la raíz de
// composición) conecta este puerto con la implementación real
// (staff.NewProfessionalLookup(staffService)); catalog nunca importa el paquete
// staff, ni siquiera para este propósito: el adaptador satisface esta
// interfaz de forma puramente estructural.
type ProfessionalPort interface {
	// Exists informa si existe un profesional con ese id en ese negocio.
	// found=false cubre tanto "no existe" como "es de otro negocio"
	// (mismo criterio uniforme que el resto del backend, RN-TEN-01).
	Exists(ctx context.Context, businessID, professionalID string) (bool, error)
}

// AssignmentRepository es el puerto de persistencia de las asignaciones
// profesional-servicio. El núcleo no importa internal/platform/database ni pgx
// (CA-002-06): postgres/ traduce entre este contrato y database.DB, mismo
// patrón que Repository (ports.go).
type AssignmentRepository interface {
	// List lee una página de asignaciones de professionalID dentro de
	// businessID, ordenada por (created_at, service_id). cursor es nil
	// para la primera página; limit ya llegó clamped al rango
	// [MinListLimit, MaxListLimit] por AssignmentService. No valida que
	// professionalID exista: eso ya lo hizo AssignmentService mediante ProfessionalPort
	// antes de llamar aquí.
	List(ctx context.Context, businessID, professionalID string, cursor *Cursor, limit int) (AssignmentListResult, error)

	// Assign ejecuta, dentro de UNA sola InTenantTx: verificar que
	// serviceID exista en businessID (AssignOutcomeServiceNotFound si
	// no), e INSERT ... ON CONFLICT DO NOTHING (AssignOutcomeCreated u
	// AssignOutcomeAlreadyExists). professionalID ya se verificó existente
	// mediante ProfessionalPort antes de esta llamada; la FK compuesta de
	// professional_service es además defensa en profundidad (CA-023-04) por si
	// esa verificación previa quedara desincronizada.
	Assign(ctx context.Context, businessID, professionalID, serviceID string) (AssignResult, error)

	// Exists informa si professionalID tiene asignado serviceID dentro de
	// businessID (HU-061, DEC-072): una consulta de existencia simple
	// sobre `professional_service`, sin paginar ni cargar la fila completa.
	Exists(ctx context.Context, businessID, professionalID, serviceID string) (bool, error)

	// Unassign borra la asociación dentro del tenant (UnassignOutcomeDeleted)
	// o informa que no existía (UnassignOutcomeNotFound). No exige conservar
	// otra asignación: DEC-114 sustituye a DEC-068.
	Unassign(ctx context.Context, businessID, professionalID, serviceID string) (UnassignResult, error)
}
