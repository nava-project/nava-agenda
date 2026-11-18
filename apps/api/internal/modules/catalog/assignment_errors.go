package catalog

import "nava-agenda/internal/platform/apperr"

// errAssignmentProfessionalNotFound cubre tanto un profesional inexistente como uno de
// otro negocio (CA-023-04, RN-TEN-01): el mismo Kind para ambos casos es lo
// que impide que la capa HTTP los distinga, igual que el resto del backend
// (mismo criterio que errServiceNotFound en errors.go).
func errAssignmentProfessionalNotFound() error {
	return apperr.NotFound("no existe un profesional con ese identificador")
}

// errAssignmentNotFound cubre servicio inexistente/ajeno, profesional
// inexistente/ajeno (cuando la desasignación lo descubre por ausencia de
// fila, no por ProfessionalPort) y la asociación concreta inexistente: las tres
// causas producen el mismo 404 uniforme (CA-023-04).
func errAssignmentNotFound() error {
	return apperr.NotFound("no existe esa asignación de servicio para ese profesional")
}
