// Package httpapi aplica la tabla de permisos de DEC-173 a las rutas privadas.
package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"nava-agenda/internal/modules/access"
	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
)

const forbiddenMessage = "Tu cuenta de empleado solo puede cambiar lo de tu propio perfil de profesional."

var uuidShape = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Middleware resuelve el alcance de la sesión y aplica la regla de la ruta.
// Se monta en el subrouter privado justo después de SessionMiddleware.
type Middleware struct {
	service *access.Service
	policy  *access.Policy
	prefix  string
}

// NewMiddleware construye el middleware. prefix es el prefijo del subrouter
// privado ("/api/v1/private"), que la tabla omite.
func NewMiddleware(service *access.Service, policy *access.Policy, prefix string) *Middleware {
	return &Middleware{service: service, policy: policy, prefix: prefix}
}

// Enforce es el middleware.
func (m *Middleware) Enforce(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := httpserver.RequestIDFromContext(r.Context())
		principal, ok := auth.PrincipalFromContext(r.Context())
		if !ok {
			httpserver.WriteProblem(w, httpserver.Translate(
				apperr.Internal(errors.New("access: falta el principal de sesión en el contexto")), requestID))
			return
		}
		scope, err := m.service.ScopeOf(r.Context(), principal.BusinessID, principal.StaffUserID)
		if err != nil {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		r = r.WithContext(access.ContextWithScope(r.Context(), scope))
		if !scope.Restricted {
			next.ServeHTTP(w, r)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, m.prefix)
		rule, params, found := m.policy.Match(r.Method, path)
		if !found {
			// Ruta inexistente: el router responde su 404 uniforme. Una ruta
			// registrada sin clasificar no llega aquí: la prueba de inventario
			// lo impide.
			next.ServeHTTP(w, r)
			return
		}

		switch rule {
		case access.Open, access.Filtered:
			next.ServeHTTP(w, r)
		case access.DenyRestricted:
			forbid(w, requestID)
		case access.OwnProfessional:
			if !scope.Owns(params["professionalId"]) {
				forbid(w, requestID)
				return
			}
			next.ServeHTTP(w, r)
		case access.OwnProfessionalInBody:
			professionalID, body, err := peekProfessionalID(r)
			if err != nil {
				httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
				return
			}
			r.Body = body
			// Un cuerpo ilegible o sin professionalId lo rechaza el propio handler
			// con su 400/422; aquí solo se niega un profesional ajeno.
			if professionalID != "" && !scope.Owns(professionalID) {
				forbid(w, requestID)
				return
			}
			next.ServeHTTP(w, r)
		case access.OwnAppointment:
			id := params["appointmentId"]
			if !uuidShape.MatchString(id) {
				next.ServeHTTP(w, r) // el handler responde su 404 uniforme
				return
			}
			professionalID, exists, err := m.service.AppointmentProfessional(r.Context(), principal.BusinessID, id)
			if err != nil {
				httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
				return
			}
			if exists && !scope.Owns(professionalID) {
				// Igual que un turno inexistente: no revela que exista ni de quién es.
				httpserver.WriteProblem(w, httpserver.Translate(apperr.NotFound("recurso no encontrado"), requestID))
				return
			}
			next.ServeHTTP(w, r)
		default:
			forbid(w, requestID)
		}
	})
}

func forbid(w http.ResponseWriter, requestID string) {
	httpserver.WriteProblem(w, httpserver.Translate(apperr.Forbidden(forbiddenMessage), requestID))
}

// peekProfessionalID lee el cuerpo (ya acotado por BodyLimit), extrae professionalId si lo
// hay y devuelve un cuerpo nuevo con los mismos bytes para el handler.
func peekProfessionalID(r *http.Request) (string, io.ReadCloser, error) {
	raw, err := io.ReadAll(r.Body)
	_ = r.Body.Close()
	if err != nil {
		return "", nil, err // MaxBytesError → 400 payload-too-large en Translate
	}
	var probe struct {
		ProfessionalID string `json:"professionalId"`
	}
	_ = json.Unmarshal(raw, &probe)
	return probe.ProfessionalID, io.NopCloser(bytes.NewReader(raw)), nil
}
