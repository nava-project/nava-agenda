// Package access decide qué puede hacer la sesión según los roles de su usuario
// (DEC-173, amplía DEC-134). Hoy solo restringe al empleado: quien tiene el rol
// `empleado` y ningún rol de mayor prioridad (`empresa`, `independiente`) solo
// puede tocar lo de su propio profesional (el vinculado a su usuario,
// professional.staff_user_id) y no la configuración del negocio. Cualquier otra
// combinación de roles, también ninguna, conserva el acceso completo de siempre.
package access

import "context"

// Roles de staff_user_role (DEC-134). Este paquete no importa shops: repite
// solo los valores que necesita.
const (
	roleBusiness    = "empresa"
	roleEmployee    = "empleado"
	roleIndependent = "independiente"
)

// Scope es lo que la sesión puede alcanzar. El valor cero es «sin
// restricciones», para que una ruta que no lo consulte nunca quede más abierta
// ni más cerrada que antes.
type Scope struct {
	// Restricted es true para el empleado (DEC-173).
	Restricted bool
	// ProfessionalID es el profesional vinculado al usuario; vacío si no tiene vínculo.
	// Solo tiene sentido con Restricted.
	ProfessionalID string
}

// IsRestricted aplica la prioridad de DEC-134 (empresa > independiente >
// empleado): solo el empleado «puro» queda restringido.
func IsRestricted(roles []string) bool {
	employee := false
	for _, role := range roles {
		switch role {
		case roleBusiness, roleIndependent:
			return false
		case roleEmployee:
			employee = true
		}
	}
	return employee
}

// Owns indica si la sesión puede tocar lo del profesional professionalID.
func (s Scope) Owns(professionalID string) bool {
	if !s.Restricted {
		return true
	}
	return s.ProfessionalID != "" && s.ProfessionalID == professionalID
}

type scopeKey struct{}

// ContextWithScope guarda el alcance resuelto por el middleware de acceso.
func ContextWithScope(ctx context.Context, scope Scope) context.Context {
	return context.WithValue(ctx, scopeKey{}, scope)
}

// ScopeFromContext devuelve el alcance de la sesión. Sin middleware (rutas
// públicas o pruebas de handler) devuelve el valor cero: sin restricciones.
func ScopeFromContext(ctx context.Context) Scope {
	scope, _ := ctx.Value(scopeKey{}).(Scope)
	return scope
}
