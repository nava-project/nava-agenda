package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"system-barbershop/internal/modules/customeraccess"
	"system-barbershop/internal/platform/apperr"
	"system-barbershop/internal/platform/clientip"
	"system-barbershop/internal/platform/httpserver"
)

// slugParam es el parámetro de ruta {slug} de /public/barbershops/{slug}/...
const slugParam = "slug"

// AccessChallengeRequest es el cuerpo de POST .../customer-access/challenge.
type AccessChallengeRequest struct {
	Contact string `json:"contact"`
}

// AccessChallengeResponse es la respuesta 202, idéntica exista o no el contacto
// (CA-105-01).
type AccessChallengeResponse struct {
	ExpiresInSeconds   int `json:"expiresInSeconds"`
	ResendAfterSeconds int `json:"resendAfterSeconds"`
}

// AccessVerifyRequest es el cuerpo de POST .../customer-access/verify.
type AccessVerifyRequest struct {
	Contact string `json:"contact"`
	Code    string `json:"code"`
}

// AccessAppointmentResponse es un turno al que la verificación dio acceso.
type AccessAppointmentResponse struct {
	AccessToken string    `json:"accessToken"`
	StartsAt    time.Time `json:"startsAt"`
	ServiceName string    `json:"serviceName"`
	BarberName  string    `json:"barberName"`
}

// AccessVerifyResponse es la respuesta 200 de una verificación válida.
type AccessVerifyResponse struct {
	Timezone     string                      `json:"timezone"`
	Appointments []AccessAppointmentResponse `json:"appointments"`
}

// decodeAccessBody decodifica un cuerpo JSON estricto: sin campos desconocidos y
// sin datos tras el objeto. El mensaje no repite lo que la persona escribió.
func decodeAccessBody(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return err
		}
		return apperr.Invalid("el cuerpo debe ser un objeto JSON válido")
	}
	if dec.More() {
		return apperr.Invalid("el cuerpo debe ser un único objeto JSON")
	}
	return nil
}

// RequestAccessCodeHandler expone POST /public/barbershops/{slug}/customer-access/challenge
// (HU-105, CA-105-01): pide un código de un solo uso. Responde siempre 202 con el
// mismo cuerpo, exista o no el contacto; el único rechazo que depende del uso es
// 429 con Retry-After.
type RequestAccessCodeHandler struct {
	service        *customeraccess.AccessService
	trustedProxies clientip.TrustedProxies
}

// NewRequestAccessCodeHandler construye el handler de solicitud de código.
func NewRequestAccessCodeHandler(service *customeraccess.AccessService, trusted clientip.TrustedProxies) *RequestAccessCodeHandler {
	return &RequestAccessCodeHandler{service: service, trustedProxies: trusted}
}

// ServeHTTP implementa http.Handler.
func (h *RequestAccessCodeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) {
		if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindRateLimited && appErr.RetryAfterSeconds > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(appErr.RetryAfterSeconds))
		}
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
	}

	var req AccessChallengeRequest
	if err := decodeAccessBody(r, &req); err != nil {
		fail(err)
		return
	}
	rawIP, err := clientip.Resolve(r, h.trustedProxies)
	if err != nil {
		fail(apperr.Internal(err))
		return
	}

	accepted, err := h.service.RequestCode(r.Context(), httpserver.URLParam(r, slugParam), req.Contact, rawIP)
	if err != nil {
		fail(err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(AccessChallengeResponse{
		ExpiresInSeconds:   accepted.ExpiresInSeconds,
		ResendAfterSeconds: accepted.ResendAfterSeconds,
	})
}

// VerifyAccessCodeHandler expone POST /public/barbershops/{slug}/customer-access/verify
// (HU-105, CA-105-02): canjea el código por un acceso de 60 minutos a cada turno
// futuro confirmado. Un código incorrecto, vencido o agotado da el mismo 401.
type VerifyAccessCodeHandler struct {
	service *customeraccess.AccessService
}

// NewVerifyAccessCodeHandler construye el handler de verificación.
func NewVerifyAccessCodeHandler(service *customeraccess.AccessService) *VerifyAccessCodeHandler {
	return &VerifyAccessCodeHandler{service: service}
}

// ServeHTTP implementa http.Handler. La respuesta lleva credenciales en claro:
// no-store evita que un caché la retenga.
func (h *VerifyAccessCodeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
	}

	var req AccessVerifyRequest
	if err := decodeAccessBody(r, &req); err != nil {
		fail(err)
		return
	}
	verified, err := h.service.VerifyCode(r.Context(), httpserver.URLParam(r, slugParam), req.Contact, req.Code)
	if err != nil {
		fail(err)
		return
	}
	out := AccessVerifyResponse{Timezone: verified.Timezone, Appointments: make([]AccessAppointmentResponse, 0, len(verified.Appointments))}
	for _, a := range verified.Appointments {
		out.Appointments = append(out.Appointments, AccessAppointmentResponse{
			AccessToken: a.AccessToken, StartsAt: a.StartsAt, ServiceName: a.ServiceName, BarberName: a.BarberName,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(out)
}
