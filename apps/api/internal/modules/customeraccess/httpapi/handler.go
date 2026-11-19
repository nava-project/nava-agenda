// Package httpapi es el adaptador HTTP del módulo customeraccess: decodifica,
// invoca customeraccess.Service y traduce el resultado a HTTP
// (nava-docs/agenda/03-desarrollo/estandar-backend-go.md §4). No importa Chi: la
// composición de rutas es responsabilidad exclusiva de cmd/api sobre el
// router de audiencia customer que internal/platform/httpserver ya
// construye.
package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"nava-agenda/internal/modules/customeraccess"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
	"nava-agenda/internal/platform/idempotency"
)

// ifMatchHeader lleva el versionToken que el cliente leyó (HU-099).
const ifMatchHeader = "If-Match"

// tokenParam es el nombre del parámetro de ruta que cmd/api.buildRouter
// registra para /customer/appointments/{token} (HU-098).
const tokenParam = "token"

// GetAppointmentHandler expone GET /customer/appointments/{token}
// (CA-098-01 a CA-098-05): lectura mínima del turno del cliente autenticada
// únicamente por la credencial del enlace, sin sesión.
type GetAppointmentHandler struct {
	service *customeraccess.Service
}

// NewGetAppointmentHandler construye el handler de lectura del cliente.
func NewGetAppointmentHandler(service *customeraccess.Service) *GetAppointmentHandler {
	return &GetAppointmentHandler{service: service}
}

// ServeHTTP implementa http.Handler. Deliberadamente NO lee ningún
// principal de sesión: el único dato de entrada es el token de la ruta, y
// el servicio lo hashea y resuelve el tenant por sí mismo antes de leer
// nada (mismo criterio que publicbooking.ResolveBusinessHandler frente a
// slug). Cache-Control: no-store evita que un caché compartido o del
// navegador retenga el turno de otra persona que use el mismo equipo
// (RN-DAT-02, "políticas de caché" del alcance de HU-098); el resto de
// cabeceras de seguridad ya las fija httpserver.SecurityHeaders para toda
// respuesta, incluida Referrer-Policy: no-referrer.
func (h *GetAppointmentHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	token := httpserver.URLParam(r, tokenParam)
	view, err := h.service.GetAppointmentByToken(r.Context(), token)
	if err != nil {
		w.Header().Set("Cache-Control", "no-store")
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newCustomerAppointmentResponse(view))
}

func newCustomerAppointmentResponse(v customeraccess.AppointmentView) CustomerAppointmentResponse {
	var review *CustomerReviewResponse
	if v.Review != nil {
		review = &CustomerReviewResponse{Rating: v.Review.Rating, Comment: v.Review.Comment, CreatedAt: v.Review.CreatedAt}
	}
	return CustomerAppointmentResponse{
		CanReview:                      v.CanReview,
		Review:                         review,
		RescheduleRemaining:            v.RescheduleRemaining,
		BusinessName:                   v.BusinessName,
		Timezone:                       v.Timezone,
		AttendeeName:                   v.AttendeeName,
		ServiceName:                    v.ServiceName,
		DurationMinutes:                v.DurationMinutes,
		ProfessionalName:               v.ProfessionalName,
		StartsAt:                       v.StartsAt,
		EndsAt:                         v.EndsAt,
		Status:                         v.Status,
		VersionToken:                   v.VersionToken,
		BusinessContactEmail:           v.BusinessContactEmail,
		BusinessContactPhone:           v.BusinessContactPhone,
		CancellationDeadlineMinutes:    v.CancellationDeadlineMinutes,
		LateCancellationClientAllowed:  v.LateCancellationClientAllowed,
		LateCancellationReasonRequired: v.LateCancellationReasonRequired,
		Vocabulary: PublicVocabularyResponse{
			BusinessTerm:           v.Vocabulary.BusinessTerm,
			BusinessTermGender:     v.Vocabulary.BusinessTermGender,
			ProfessionalTerm:       v.Vocabulary.ProfessionalTerm,
			ProfessionalTermPlural: v.Vocabulary.ProfessionalTermPlural,
			ProfessionalTermGender: v.Vocabulary.ProfessionalTermGender,
		},
	}
}

// CancelAppointmentHandler expone POST /customer/appointments/{token}/cancel
// (HU-099, T5): el cliente cancela su turno con la credencial del enlace, sin
// sesión, protegido por Idempotency-Key (RN-IDE-01, DEC-043) y por la
// precondición de versión If-Match. Reloj, política, estado y actor los decide
// el servidor; el cuerpo solo puede traer `reason`.
type CancelAppointmentHandler struct {
	service *customeraccess.Service
}

// NewCancelAppointmentHandler construye el handler de cancelación.
func NewCancelAppointmentHandler(service *customeraccess.Service) *CancelAppointmentHandler {
	return &CancelAppointmentHandler{service: service}
}

// ServeHTTP implementa http.Handler. Valida cabeceras y cuerpo ANTES de tocar
// la base (ninguna revela nada sobre el token) y nunca registra el token.
func (h *CancelAppointmentHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
	}

	key, err := httpserver.IdempotencyKeyFromRequest(r)
	if err != nil {
		fail(err)
		return
	}
	versionToken := r.Header.Get(ifMatchHeader)
	if versionToken == "" {
		fail(apperr.Invalid("falta la cabecera If-Match con el token de versión del turno"))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			fail(err)
			return
		}
		fail(apperr.Invalid("cuerpo de la solicitud ilegible"))
		return
	}
	reason := ""
	if len(bytes.TrimSpace(body)) > 0 {
		var req CancelAppointmentRequest
		dec := json.NewDecoder(bytes.NewReader(body))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || dec.More() {
			fail(apperr.Invalid("el cuerpo debe ser un objeto JSON válido con, a lo sumo, el campo reason"))
			return
		}
		if req.Reason != nil {
			reason = *req.Reason
		}
	}

	decision, stored, err := h.service.CancelAppointment(
		r.Context(), httpserver.URLParam(r, tokenParam), versionToken, reason,
		key, httpserver.IdempotencyFingerprint(r, body),
	)
	if err != nil {
		fail(err)
		return
	}
	switch decision.Outcome {
	case idempotency.OutcomeProceed, idempotency.OutcomeReplay:
		httpserver.WriteStoredResponse(w, stored)
	default:
		fail(decision.AsError())
	}
}

// ListRescheduleSlotsHandler expone GET /customer/appointments/{token}/reschedule-slots
// (HU-104, CA-104-02): las franjas a las que el cliente puede mover su turno,
// autenticado solo por la credencial del enlace.
type ListRescheduleSlotsHandler struct {
	service *customeraccess.Service
}

// NewListRescheduleSlotsHandler construye el handler de franjas.
func NewListRescheduleSlotsHandler(service *customeraccess.Service) *ListRescheduleSlotsHandler {
	return &ListRescheduleSlotsHandler{service: service}
}

// ServeHTTP implementa http.Handler. no-store por la misma razón que la
// lectura del turno: es información de una persona.
func (h *ListRescheduleSlotsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")

	slots, err := h.service.ListRescheduleSlots(r.Context(), httpserver.URLParam(r, tokenParam))
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	starts := make([]time.Time, 0, len(slots.Starts))
	for _, start := range slots.Starts {
		starts = append(starts, start.UTC())
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(RescheduleSlotsResponse{Timezone: slots.Timezone, Starts: starts})
}

// RescheduleAppointmentHandler expone POST /customer/appointments/{token}/reschedule
// (HU-104, DEC-178): el cliente mueve su turno con la credencial del enlace,
// protegido por Idempotency-Key (RN-IDE-01, DEC-043) y por If-Match. El cuerpo
// solo puede traer `startsAt`; plazo, límite, franja y actor los decide el
// servidor.
type RescheduleAppointmentHandler struct {
	service *customeraccess.Service
}

// NewRescheduleAppointmentHandler construye el handler de reprogramación.
func NewRescheduleAppointmentHandler(service *customeraccess.Service) *RescheduleAppointmentHandler {
	return &RescheduleAppointmentHandler{service: service}
}

// ServeHTTP implementa http.Handler. Valida cabeceras y cuerpo antes de tocar
// la base y nunca registra el token.
func (h *RescheduleAppointmentHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
	}

	key, err := httpserver.IdempotencyKeyFromRequest(r)
	if err != nil {
		fail(err)
		return
	}
	versionToken := r.Header.Get(ifMatchHeader)
	if versionToken == "" {
		fail(apperr.Invalid("falta la cabecera If-Match con el token de versión del turno"))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			fail(err)
			return
		}
		fail(apperr.Invalid("cuerpo de la solicitud ilegible"))
		return
	}
	var req RescheduleAppointmentRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || dec.More() || req.StartsAt == nil {
		fail(apperr.Invalid("el cuerpo debe ser un objeto JSON con el campo startsAt"))
		return
	}

	decision, stored, err := h.service.RescheduleAppointment(
		r.Context(), httpserver.URLParam(r, tokenParam), *req.StartsAt, versionToken,
		key, httpserver.IdempotencyFingerprint(r, body),
	)
	if err != nil {
		fail(err)
		return
	}
	switch decision.Outcome {
	case idempotency.OutcomeProceed, idempotency.OutcomeReplay:
		httpserver.WriteStoredResponse(w, stored)
	default:
		fail(decision.AsError())
	}
}
