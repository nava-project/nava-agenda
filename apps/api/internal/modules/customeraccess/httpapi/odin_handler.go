package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"nava-agenda/internal/modules/customeraccess"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
)

// OdinLookupRequest es el cuerpo de POST .../customer-appointments/lookup.
type OdinLookupRequest struct {
	Phone string `json:"phone"`
}

// OdinAppointmentResponse es un turno tal como se le muestra a Odin: sin
// identificadores internos, nombre ni contacto del cliente.
type OdinAppointmentResponse struct {
	AppointmentRef   string    `json:"appointmentRef"`
	StartsAt         time.Time `json:"startsAt"`
	ServiceName      string    `json:"serviceName"`
	ProfessionalName string    `json:"professionalName"`
	// LegacyBarberName repite ProfessionalName con el nombre de campo anterior a DEC-183
	// (#661). Se retira cuando Odin confirme que lee professionalName.
	LegacyBarberName string `json:"barberName"`
	CanCancel        bool   `json:"canCancel"`
	CanReschedule    bool   `json:"canReschedule"`
}

// OdinLookupResponse es la respuesta 200 de `lookup`.
type OdinLookupResponse struct {
	Appointments []OdinAppointmentResponse `json:"appointments"`
}

// OdinChallengeRequest es el cuerpo de POST .../customer-access/challenge de Odin.
// Purpose es opcional: sin él, el enlace abre el paso 03 con las dos acciones
// (`manage`, DEC-181).
type OdinChallengeRequest struct {
	Phone          string `json:"phone"`
	AppointmentRef string `json:"appointmentRef"`
	Purpose        string `json:"purpose,omitempty"`
}

// OdinChallengeResponse es la respuesta 201: la referencia del enlace, su vigencia,
// el propósito con que quedó y, si el despliegue conoce su web pública, el enlace
// completo para pegarlo en el chat.
type OdinChallengeResponse struct {
	AccessRef string    `json:"accessRef"`
	AccessURL string    `json:"accessUrl,omitempty"`
	Purpose   string    `json:"purpose"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// VerifyRefRequest es el cuerpo de POST .../customer-access/verify-ref.
type VerifyRefRequest struct {
	AccessRef string `json:"accessRef"`
	Code      string `json:"code"`
}

// VerifyRefResponse es la respuesta 200: el acceso al turno y para qué se pidió.
type VerifyRefResponse struct {
	AccessToken string `json:"accessToken"`
	Purpose     string `json:"purpose"`
}

// RequireServiceToken protege el grupo de integraciones de Odin (HU-106, CA-106-01)
// con un secreto compartido en `Authorization: Bearer`. Compara en tiempo constante
// (sobre el SHA-256 de ambos, para que ni el largo se filtre) y responde siempre el
// mismo 401, falte la cabecera o sea otra. Con un secreto vacío rechaza todo: el
// arranque ni siquiera monta el grupo en ese caso.
func RequireServiceToken(secret string) func(http.Handler) http.Handler {
	want := sha256.Sum256([]byte(secret))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			scheme, credential, ok := strings.Cut(r.Header.Get("Authorization"), " ")
			got := sha256.Sum256([]byte(strings.TrimSpace(credential)))
			valid := ok && strings.EqualFold(scheme, "Bearer") && secret != "" &&
				subtle.ConstantTimeCompare(got[:], want[:]) == 1
			if !valid {
				w.Header().Set("WWW-Authenticate", "Bearer")
				httpserver.WriteProblem(w, httpserver.Translate(
					apperr.Unauthorized("credencial de servicio inválida"),
					httpserver.RequestIDFromContext(r.Context())))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// OdinLookupHandler expone POST /integrations/odin/businesses/{slug}/customer-appointments/lookup
// (HU-106, CA-106-02).
type OdinLookupHandler struct{ service *customeraccess.RefService }

// NewOdinLookupHandler construye el handler de búsqueda.
func NewOdinLookupHandler(service *customeraccess.RefService) *OdinLookupHandler {
	return &OdinLookupHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *OdinLookupHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) { httpserver.WriteProblem(w, httpserver.Translate(err, requestID)) }

	var req OdinLookupRequest
	if err := decodeAccessBody(r, &req); err != nil {
		fail(err)
		return
	}
	appointments, err := h.service.Lookup(r.Context(), httpserver.URLParam(r, slugParam), req.Phone)
	if err != nil {
		fail(err)
		return
	}
	out := OdinLookupResponse{Appointments: make([]OdinAppointmentResponse, 0, len(appointments))}
	for _, a := range appointments {
		out.Appointments = append(out.Appointments, OdinAppointmentResponse{
			AppointmentRef: a.Ref, StartsAt: a.StartsAt, ServiceName: a.ServiceName, ProfessionalName: a.ProfessionalName,
			LegacyBarberName: a.ProfessionalName,
			CanCancel:        a.CanCancel, CanReschedule: a.CanReschedule,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(out)
}

// OdinChallengeHandler expone POST /integrations/odin/businesses/{slug}/customer-access/challenge
// (HU-106, CA-106-03 y CA-106-04).
type OdinChallengeHandler struct {
	service *customeraccess.RefService
	webBase string
}

// NewOdinChallengeHandler construye el handler de solicitud de código. webBase es
// el origen de la web pública (APP_PUBLIC_WEB_BASE_URL); vacío, la respuesta no
// lleva `accessUrl` y Odin arma el enlace con `accessRef`.
func NewOdinChallengeHandler(service *customeraccess.RefService, webBase string) *OdinChallengeHandler {
	return &OdinChallengeHandler{service: service, webBase: strings.TrimRight(webBase, "/")}
}

// accessURL arma el enlace que el cliente abre: directo en el código, sin pedir el
// contacto. Solo lleva el slug y la referencia opaca, nunca datos personales.
func (h *OdinChallengeHandler) accessURL(slug, accessRef string) string {
	if h.webBase == "" {
		return ""
	}
	return h.webBase + "/reservar/" + url.PathEscape(slug) + "/mi-turno/" + url.PathEscape(accessRef)
}

// ServeHTTP implementa http.Handler.
func (h *OdinChallengeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) {
		if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindRateLimited && appErr.RetryAfterSeconds > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(appErr.RetryAfterSeconds))
		}
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
	}

	var req OdinChallengeRequest
	if err := decodeAccessBody(r, &req); err != nil {
		fail(err)
		return
	}
	slug := httpserver.URLParam(r, slugParam)
	accepted, err := h.service.RequestCode(r.Context(), slug, req.Phone, req.AppointmentRef, req.Purpose)
	if err != nil {
		fail(err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(OdinChallengeResponse{
		AccessRef: accepted.AccessRef, AccessURL: h.accessURL(slug, accepted.AccessRef),
		Purpose: accepted.Purpose, ExpiresAt: accepted.ExpiresAt,
	})
}

// VerifyRefHandler expone POST /public/businesses/{slug}/customer-access/verify-ref
// (HU-106, CA-106-05): canjea el código de una referencia por un acceso de 60
// minutos a su turno. Un código incorrecto, vencido o agotado da el mismo 401.
type VerifyRefHandler struct{ service *customeraccess.RefService }

// NewVerifyRefHandler construye el handler de verificación por referencia.
func NewVerifyRefHandler(service *customeraccess.RefService) *VerifyRefHandler {
	return &VerifyRefHandler{service: service}
}

// ServeHTTP implementa http.Handler. La respuesta lleva una credencial en claro:
// no-store evita que un caché la retenga.
func (h *VerifyRefHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) { httpserver.WriteProblem(w, httpserver.Translate(err, requestID)) }

	var req VerifyRefRequest
	if err := decodeAccessBody(r, &req); err != nil {
		fail(err)
		return
	}
	verified, err := h.service.VerifyRef(r.Context(), httpserver.URLParam(r, slugParam), req.AccessRef, req.Code)
	if err != nil {
		fail(err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(VerifyRefResponse{AccessToken: verified.AccessToken, Purpose: verified.Purpose})
}
