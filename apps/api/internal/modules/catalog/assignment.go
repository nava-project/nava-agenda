package catalog

import (
	"regexp"
	"time"
)

// professionalIDPattern es la misma forma canónica 8-4-4-4-12 que
// database.ValidBusinessID/staff.LooksLikeProfessionalID exigen (el núcleo no
// puede importar ninguno de esos dos paquetes: database.ValidBusinessID
// por CA-002-06, staff.LooksLikeProfessionalID porque catalog no importa el
// núcleo de staff, mismo criterio de "colaboración solo por puerto
// explícito" de HU-023). Duplicar esta única expresión regular es la misma
// duplicación pequeña y clara que domain.go ya documenta para
// serviceIDPattern frente a staff.professionalIDPattern.
var professionalIDPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

// LooksLikeProfessionalID informa si id tiene la forma de un UUID válido. Un
// identificador que no cumple esta forma no puede corresponder a ninguna
// fila real: se trata igual que "no existe" (mismo apperr.NotFound) en vez
// de dejar que la consulta a staff.ProfessionalPort o a PostgreSQL falle con un
// error de tipo.
func LooksLikeProfessionalID(id string) bool {
	return professionalIDPattern.MatchString(id)
}

// Assignment es la asociación PURA entre un profesional y un servicio de la
// mismo negocio (HU-023, CA-023-07): exactamente ProfessionalID, ServiceID y
// CreatedAt. Nunca nombre, duración, precio ni estado: esos campos siguen
// siendo responsabilidad exclusiva de staff.Professional y catalog.Service: un
// consumidor que necesite mostrarlos los obtiene de esas otras dos listas y
// cruza por identificador, nunca de este tipo.
type Assignment struct {
	ProfessionalID string
	ServiceID      string
	CreatedAt      time.Time
}

// AssignOutcome distingue, sin ambigüedad, qué pasó dentro de la
// transacción de Repository.Assign.
type AssignOutcome int

const (
	// AssignOutcomeCreated: la fila no existía y se insertó (CA-023-02).
	AssignOutcomeCreated AssignOutcome = iota
	// AssignOutcomeAlreadyExists: la fila ya existía (misma asignación
	// repetida); no se insertó una segunda (CA-023-02, semántica PUT
	// naturalmente repetible).
	AssignOutcomeAlreadyExists
	// AssignOutcomeServiceNotFound: serviceID no existe en este negocio
	// (CA-023-04). La existencia/pertenencia del profesional ya se verificó
	// ANTES de esta llamada mediante ProfessionalPort (AssignmentService.Assign);
	// esta variante solo cubre el servicio, propio de este módulo.
	AssignOutcomeServiceNotFound
)

// AssignResult es el desenlace completo de Repository.Assign.
type AssignResult struct {
	Outcome    AssignOutcome
	Assignment Assignment
}

// UnassignOutcome distingue, sin ambigüedad, qué pasó dentro de la
// transacción de Repository.Unassign.
type UnassignOutcome int

const (
	// UnassignOutcomeDeleted: la fila existía y se borró. Retirar la última
	// asignación de un servicio activo también es válido (DEC-114).
	UnassignOutcomeDeleted UnassignOutcome = iota
	// UnassignOutcomeNotFound: no existe tal asignación (profesional
	// inexistente/ajeno, servicio inexistente/ajeno, o la asociación
	// concreta nunca existió/ya se había retirado). Las tres causas
	// producen el mismo 404 uniforme (CA-023-04), sin distinguirse en el
	// resultado.
	UnassignOutcomeNotFound
)

// UnassignResult es el desenlace completo de Repository.Unassign.
type UnassignResult struct {
	Outcome UnassignOutcome
}

// AssignmentListResult es una página de asignaciones de un profesional, ya
// ordenada de forma estable (created_at, service_id). NextCursor es "" para
// la última página (CA-023-01).
type AssignmentListResult struct {
	Items      []Assignment
	NextCursor string
}
