// Package httpapi es el adaptador HTTP del módulo publicbooking: decodifica,
// invoca publicbooking.Service y traduce el resultado a HTTP
// (docs/03-desarrollo/estandar-backend-go.md §4). No importa Chi: la
// composición de rutas es responsabilidad exclusiva de cmd/api sobre el
// router público que internal/platform/httpserver ya construye.
package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
	"nava-agenda/internal/platform/idempotency"
)

// slugParam es el nombre del parámetro de ruta que cmd/api.buildRouter
// registra para /public/businesses/{slug} (HU-090).
const slugParam = "slug"

// serviceIDParam es el nombre del parámetro de ruta que cmd/api.buildRouter
// registra para /public/businesses/{slug}/services/{serviceId}/professionals
// (HU-092).
const serviceIDParam = "serviceId"

// professionalIDParam es el nombre del parámetro de ruta que cmd/api.buildRouter
// registra para
// /public/businesses/{slug}/services/{serviceId}/professionals/{professionalId}/availability
// (HU-094).
const professionalIDParam = "professionalId"

// ResolveBusinessHandler expone GET /public/businesses/{slug}
// (CA-090-01 a CA-090-04): resolución pública sin sesión, sin que el
// cliente pueda fijar businessId.
type ResolveBusinessHandler struct {
	service *publicbooking.Service
}

// NewResolveBusinessHandler construye el handler de resolución pública.
func NewResolveBusinessHandler(service *publicbooking.Service) *ResolveBusinessHandler {
	return &ResolveBusinessHandler{service: service}
}

// ServeHTTP implementa http.Handler. Deliberadamente NO lee ningún
// principal de sesión (CA-090-03): el único dato de entrada es el slug de
// la ruta, y el servicio resuelve el tenant por sí mismo antes de leer
// nada.
func (h *ResolveBusinessHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	slug := httpserver.URLParam(r, slugParam)
	profile, err := h.service.ResolveBusiness(r.Context(), slug)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newPublicBusinessProfileResponse(profile))
}

func newPublicBusinessProfileResponse(p publicbooking.BusinessProfile) PublicBusinessProfileResponse {
	var location *PublicLocationResponse
	if p.Location != nil {
		location = &PublicLocationResponse{
			Address: p.Location.Address, Latitude: p.Location.Latitude, Longitude: p.Location.Longitude,
		}
	}
	openingHours := make([]PublicOpeningSegmentResponse, 0, len(p.OpeningHours))
	for _, seg := range p.OpeningHours {
		openingHours = append(openingHours, PublicOpeningSegmentResponse{
			DayOfWeek: weekdayName(seg.Weekday), Opens: clockText(seg.Opens), Closes: clockText(seg.Closes),
		})
	}
	var today *PublicOpeningTodayResponse
	if p.Today != nil {
		hours := make([]PublicOpeningIntervalResponse, 0, len(p.Today.Hours))
		for _, seg := range p.Today.Hours {
			hours = append(hours, PublicOpeningIntervalResponse{Opens: clockText(seg.Opens), Closes: clockText(seg.Closes)})
		}
		today = &PublicOpeningTodayResponse{
			Date:      p.Today.Date.Format(time.DateOnly),
			DayOfWeek: weekdayName(p.Today.Weekday),
			Holiday:   p.Today.Holiday,
			Hours:     hours,
		}
	}
	return PublicBusinessProfileResponse{
		OpeningHours:      openingHours,
		ClosedOnHolidays:  p.ClosedOnHolidays,
		Today:             today,
		Location:          location,
		OffersHomeService: p.OffersHomeService,
		BrandAccent:       p.BrandAccent,
		Name:              p.Name,
		Timezone:          p.Timezone,
		ContactEmail:      p.ContactEmail,
		ContactPhone:      p.ContactPhone,
		Vocabulary: PublicVocabularyResponse{
			BusinessTerm:           p.Vocabulary.BusinessTerm,
			BusinessTermGender:     p.Vocabulary.BusinessTermGender,
			ProfessionalTerm:       p.Vocabulary.ProfessionalTerm,
			ProfessionalTermPlural: p.Vocabulary.ProfessionalTermPlural,
			ProfessionalTermGender: p.Vocabulary.ProfessionalTermGender,
		},
	}
}

// ListPublicServicesHandler expone GET /public/businesses/{slug}/services
// (HU-091, CA-091-01 a CA-091-03): catálogo público de servicios activos y
// asignados del negocio resuelto por slug, sin sesión.
type ListPublicServicesHandler struct {
	service *publicbooking.Service
}

// NewListPublicServicesHandler construye el handler del catálogo público.
func NewListPublicServicesHandler(service *publicbooking.Service) *ListPublicServicesHandler {
	return &ListPublicServicesHandler{service: service}
}

// ServeHTTP implementa http.Handler. Igual que ResolveBusinessHandler, no
// lee ningún principal de sesión: slug (de la ruta) y cursor/limit (de la
// query) son toda la entrada.
func (h *ListPublicServicesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	slug := httpserver.URLParam(r, slugParam)
	query := r.URL.Query()
	cursor := query.Get("cursor")

	limit := 0
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			httpserver.WriteProblem(w, httpserver.Translate(
				apperr.Invalid("el parámetro limit debe ser un entero positivo"), requestID))
			return
		}
		limit = parsed
	}

	result, err := h.service.ListPublicServices(r.Context(), slug, cursor, limit)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newPublicServiceListResponse(result))
}

func newPublicServiceResponse(s publicbooking.PublicService) PublicServiceResponse {
	return PublicServiceResponse{
		ID:              s.ID,
		Name:            s.Name,
		Description:     s.Description,
		DurationMinutes: s.DurationMinutes,
		Price:           publicbooking.FormatServicePriceCOP(s.PriceCents),
		Currency:        s.Currency,
	}
}

func newPublicServiceListResponse(result publicbooking.PublicServiceListResult) PublicServiceListResponse {
	items := make([]PublicServiceResponse, 0, len(result.Items))
	for _, svc := range result.Items {
		items = append(items, newPublicServiceResponse(svc))
	}
	var nextCursor *string
	if result.NextCursor != "" {
		nextCursor = &result.NextCursor
	}
	return PublicServiceListResponse{Items: items, NextCursor: nextCursor}
}

// ListPublicProfessionalsHandler expone
// GET /public/businesses/{slug}/services/{serviceId}/professionals (HU-092,
// CA-092-01 a CA-092-03): profesionales con asignación vigente al servicio activo
// resuelto, sin sesión.
type ListPublicProfessionalsHandler struct {
	service *publicbooking.Service
}

// NewListPublicProfessionalsHandler construye el handler de selección pública de
// profesional.
func NewListPublicProfessionalsHandler(service *publicbooking.Service) *ListPublicProfessionalsHandler {
	return &ListPublicProfessionalsHandler{service: service}
}

// ServeHTTP implementa http.Handler. Igual que los otros handlers públicos,
// no lee ningún principal de sesión: slug y serviceId (ambos de la ruta) son
// toda la entrada.
func (h *ListPublicProfessionalsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	slug := httpserver.URLParam(r, slugParam)
	serviceID := httpserver.URLParam(r, serviceIDParam)

	result, err := h.service.ListPublicProfessionals(r.Context(), slug, serviceID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newPublicProfessionalListResponse(result))
}

func newPublicProfessionalResponse(b publicbooking.PublicProfessional) PublicProfessionalResponse {
	return PublicProfessionalResponse{
		ID:             b.ID,
		FullName:       b.FullName,
		Description:    b.Description,
		PhotoUpdatedAt: b.PhotoUpdatedAt,
		Rating:         b.Rating,
		RatingCount:    b.RatingCount,
	}
}

func newPublicProfessionalListResponse(result publicbooking.PublicProfessionalListResult) PublicProfessionalListResponse {
	items := make([]PublicProfessionalResponse, 0, len(result.Items))
	for _, professional := range result.Items {
		items = append(items, newPublicProfessionalResponse(professional))
	}
	return PublicProfessionalListResponse{Items: items}
}

// ListPublicProfessionalsWithServicesHandler expone
// GET /public/businesses/{slug}/professionals (DEC-162): todos los profesionales con al
// menos una asignación vigente a un servicio activo, cada uno con los ids de
// esos servicios, sin sesión. Existe para que un cliente de solo lectura no
// tenga que llamar GET .../services/{serviceId}/professionals una vez por servicio.
type ListPublicProfessionalsWithServicesHandler struct {
	service *publicbooking.Service
}

// NewListPublicProfessionalsWithServicesHandler construye el handler del agregado
// profesionales-servicios.
func NewListPublicProfessionalsWithServicesHandler(service *publicbooking.Service) *ListPublicProfessionalsWithServicesHandler {
	return &ListPublicProfessionalsWithServicesHandler{service: service}
}

// ServeHTTP implementa http.Handler. Como los demás handlers públicos no lee
// ningún principal de sesión: el slug de la ruta es toda la entrada.
func (h *ListPublicProfessionalsWithServicesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	result, err := h.service.ListPublicProfessionalsWithServices(r.Context(), httpserver.URLParam(r, slugParam))
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newPublicProfessionalServicesListResponse(result))
}

func newPublicProfessionalServicesListResponse(result publicbooking.PublicProfessionalServicesListResult) PublicProfessionalServicesListResponse {
	items := make([]PublicProfessionalServicesResponse, 0, len(result.Items))
	for _, professional := range result.Items {
		// Copia defensiva y nunca null: serviceIds siempre es un arreglo.
		serviceIDs := make([]string, 0, len(professional.ServiceIDs))
		serviceIDs = append(serviceIDs, professional.ServiceIDs...)
		items = append(items, PublicProfessionalServicesResponse{
			ID: professional.ID, FullName: professional.FullName, ServiceIDs: serviceIDs,
		})
	}
	return PublicProfessionalServicesListResponse{Items: items}
}

// GetPublicProfessionalPhotoHandler expone
// GET /public/businesses/{slug}/professionals/{professionalId}/photo (DEC-127): los bytes
// de la fotografía de un profesional visible en la reserva pública, sin sesión.
type GetPublicProfessionalPhotoHandler struct {
	service *publicbooking.Service
}

// NewGetPublicProfessionalPhotoHandler construye el handler de la fotografía pública.
func NewGetPublicProfessionalPhotoHandler(service *publicbooking.Service) *GetPublicProfessionalPhotoHandler {
	return &GetPublicProfessionalPhotoHandler{service: service}
}

// ServeHTTP implementa http.Handler. Sirve la imagen con validador ETag; el
// cliente versiona la URL con `photoUpdatedAt`, así que una fotografía nueva
// nunca se sirve desde una caché vieja.
func (h *GetPublicProfessionalPhotoHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	photo, err := h.service.PublicProfessionalPhoto(r.Context(),
		httpserver.URLParam(r, slugParam), httpserver.URLParam(r, professionalIDParam))
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	etag := `"` + strconv.FormatInt(photo.UpdatedAt.UnixMicro(), 10) + `"`
	header := w.Header()
	header.Set("ETag", etag)
	// private: es el retrato de una persona; solo el navegador del visitante
	// lo conserva, nunca un intermediario compartido.
	header.Set("Cache-Control", "private, max-age=3600")

	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	header.Set("Content-Type", photo.ContentType)
	header.Set("Content-Length", strconv.Itoa(len(photo.Data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(photo.Data)
}

// ListPublicAvailabilityHandler expone
// GET /public/businesses/{slug}/services/{serviceId}/professionals/{professionalId}/availability
// (HU-094, CA-094-01 a CA-094-06): inicios públicos válidos del servicio
// activo con el profesional elegido, sin sesión.
type ListPublicAvailabilityHandler struct {
	service *publicbooking.AvailabilityService
}

// NewListPublicAvailabilityHandler construye el handler de disponibilidad
// pública.
func NewListPublicAvailabilityHandler(service *publicbooking.AvailabilityService) *ListPublicAvailabilityHandler {
	return &ListPublicAvailabilityHandler{service: service}
}

// ServeHTTP implementa http.Handler. Igual que los otros handlers públicos,
// no lee ningún principal de sesión: slug, serviceId y professionalId (los tres
// de la ruta) son toda la entrada.
func (h *ListPublicAvailabilityHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	slug := httpserver.URLParam(r, slugParam)
	serviceID := httpserver.URLParam(r, serviceIDParam)
	professionalID := httpserver.URLParam(r, professionalIDParam)

	result, err := h.service.ListPublicAvailability(r.Context(), slug, serviceID, professionalID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newAvailabilityResponse(result))
}

func newAvailabilityResponse(result publicbooking.AvailabilityResult) AvailabilityResponse {
	slots := make([]AvailabilitySlotResponse, 0, len(result.Slots))
	for _, slot := range result.Slots {
		slots = append(slots, AvailabilitySlotResponse{StartsAt: slot.StartsAt})
	}
	return AvailabilityResponse{
		Slots:           slots,
		DurationMinutes: result.DurationMinutes,
		Timezone:        result.Timezone,
		SlotGridMinutes: result.SlotGridMinutes,
	}
}

// ListPublicServiceAvailabilityHandler expone
// GET /public/businesses/{slug}/services/{serviceId}/availability (DEC-162):
// los inicios públicos válidos del servicio para todos sus profesionales
// elegibles en una sola respuesta, sin sesión. Existe para que un cliente de
// solo lectura no tenga que llamar la disponibilidad una vez por profesional.
type ListPublicServiceAvailabilityHandler struct {
	service *publicbooking.AvailabilityService
}

// NewListPublicServiceAvailabilityHandler construye el handler del agregado
// de disponibilidad por servicio.
func NewListPublicServiceAvailabilityHandler(service *publicbooking.AvailabilityService) *ListPublicServiceAvailabilityHandler {
	return &ListPublicServiceAvailabilityHandler{service: service}
}

// ServeHTTP implementa http.Handler. Como los demás handlers públicos no lee
// ningún principal de sesión: slug y serviceId (de la ruta) son toda la
// entrada.
func (h *ListPublicServiceAvailabilityHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	result, err := h.service.ListPublicServiceAvailability(r.Context(),
		httpserver.URLParam(r, slugParam), httpserver.URLParam(r, serviceIDParam))
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newServiceAvailabilityResponse(result))
}

func newServiceAvailabilityResponse(result publicbooking.ServiceAvailabilityResult) ServiceAvailabilityResponse {
	slots := make([]ProfessionalAvailabilitySlotResponse, 0, len(result.Slots))
	for _, slot := range result.Slots {
		slots = append(slots, ProfessionalAvailabilitySlotResponse{
			ProfessionalID: slot.ProfessionalID, StartsAt: slot.StartsAt,
		})
	}
	return ServiceAvailabilityResponse{
		Slots:           slots,
		DurationMinutes: result.DurationMinutes,
		Timezone:        result.Timezone,
		SlotGridMinutes: result.SlotGridMinutes,
	}
}

// writeUnknownFieldOrInvalidJSONProblem cubre un cuerpo JSON malformado o
// con un campo desconocido, mismo criterio de rechazo estricto que
// bookinghttpapi.writeUnknownFieldOrInvalidJSONProblem (duplicado a
// propósito: publicbooking/httpapi no importa booking/httpapi, CA-002-06).
func writeUnknownFieldOrInvalidJSONProblem(w http.ResponseWriter, requestID string) {
	httpserver.WriteProblem(w, httpserver.Translate(
		apperr.Invalid("cuerpo JSON inválido o con un campo desconocido"), requestID))
}

// ConfirmPublicAppointmentHandler expone POST /public/businesses/{slug}/
// services/{serviceId}/professionals/{professionalId}/appointments (HU-097, T1
// pública), protegido por el protocolo de idempotencia reutilizable de
// HU-004 (RN-IDE-01, DEC-043). Igual que los otros handlers públicos, no
// lee ningún principal de sesión: slug/serviceId/professionalId (de la ruta) y el
// cuerpo son toda la entrada.
type ConfirmPublicAppointmentHandler struct {
	service *publicbooking.ConfirmationService
	logger  *slog.Logger
}

// NewConfirmPublicAppointmentHandler construye el handler de confirmación
// pública. logger registra únicamente un fallo de entrega del correo de
// confirmación, sin destinatario, código ni enlace (RN-DAT-02, DEC-091),
// mismo criterio que auth/httpapi.RecoveryRequestHandler.
func NewConfirmPublicAppointmentHandler(service *publicbooking.ConfirmationService, logger *slog.Logger) *ConfirmPublicAppointmentHandler {
	return &ConfirmPublicAppointmentHandler{service: service, logger: logger}
}

// ServeHTTP implementa http.Handler.
func (h *ConfirmPublicAppointmentHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	slug := httpserver.URLParam(r, slugParam)
	serviceID := httpserver.URLParam(r, serviceIDParam)
	professionalID := httpserver.URLParam(r, professionalIDParam)

	// 1. Cabecera: obligatoria, validada antes de tocar PostgreSQL o leer el
	//    cuerpo (mismo orden que bookinghttpapi.CreateManualAppointmentHandler).
	key, err := httpserver.IdempotencyKeyFromRequest(r)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	// 2. Cuerpo CRUDO, leído una sola vez: la huella de idempotencia debe
	//    calcularse sobre los bytes exactos recibidos.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		httpserver.WriteProblem(w, httpserver.Translate(apperr.Invalid("cuerpo de la solicitud ilegible"), requestID))
		return
	}

	var req ConfirmPublicAppointmentRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}
	if dec.More() {
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}

	fingerprint := httpserver.IdempotencyFingerprint(r, body)

	result, emailErr, err := h.service.ConfirmAppointment(r.Context(), publicbooking.ConfirmPublicAppointmentInput{
		Slug:           slug,
		ServiceID:      serviceID,
		ProfessionalID: professionalID,
		StartsAtRaw:    req.StartsAt,
		Identity: publicbooking.CustomerIdentityInput{
			FullName:       req.FullName,
			Phone:          req.Phone,
			Email:          req.Email,
			Note:           req.Note,
			ForSomeoneElse: req.ForSomeoneElse,
			AttendeeName:   req.AttendeeName,
		},
		HomeService: homeServiceInput(req.HomeService),
	}, key, fingerprint)
	if err != nil {
		var conflict *publicbooking.ScheduleConflictError
		if errors.As(err, &conflict) {
			writeScheduleConflictProblem(w, requestID, conflict)
			return
		}
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	if emailErr != nil {
		// El resultado se descarta deliberadamente para la respuesta (la
		// cita ya quedó confirmada, DEC-091); solo se registra sin
		// destinatario, código ni enlace (RN-DAT-02).
		h.logger.WarnContext(r.Context(), "publicbooking: fallo al enviar el correo de confirmación", "requestId", requestID)
	}

	switch result.Decision.Outcome {
	case idempotency.OutcomeProceed, idempotency.OutcomeReplay:
		httpserver.WriteStoredResponse(w, result.Response)
	default:
		httpserver.WriteProblem(w, httpserver.Translate(result.Decision.AsError(), requestID))
	}
}

// writeScheduleConflictProblem escribe el 409 de RN-CON-05/DEC-090:
// httpserver.Translate calcula la parte segura y común (type/title/code/
// status/detail); esta función solo agrega `alternatives` (RFC 9457,
// extensión abierta que Problem.yaml ya declara) antes de codificar.
func writeScheduleConflictProblem(w http.ResponseWriter, requestID string, conflict *publicbooking.ScheduleConflictError) {
	problem := httpserver.Translate(conflict, requestID)
	alternatives := make([]AlternativeSlotResponse, 0, len(conflict.Alternatives))
	for _, alt := range conflict.Alternatives {
		alternatives = append(alternatives, AlternativeSlotResponse{StartsAt: alt.StartsAt})
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(problem.Status)
	_ = json.NewEncoder(w).Encode(ScheduleConflictProblemResponse{Problem: problem, Alternatives: alternatives})
}

func homeServiceInput(r *HomeServiceRequest) *publicbooking.HomeServiceInput {
	if r == nil {
		return nil
	}
	return &publicbooking.HomeServiceInput{Address: r.Address, Latitude: r.Latitude, Longitude: r.Longitude}
}

// GetPublicGoogleReviewsHandler expone GET /public/businesses/{slug}/reviews
// (HU-101, DEC-129): la calificación y las reseñas de Google del negocio,
// sin sesión. Solo un slug inválido o no publicable es un error (el 404 uniforme
// de HU-090); sin ficha, sin credencial o ante una consulta fallida responde 200
// con la estructura vacía (CA-101-01, CA-101-03).
type GetPublicGoogleReviewsHandler struct {
	service *publicbooking.GoogleReviewsService
}

// NewGetPublicGoogleReviewsHandler construye el handler de reseñas de Google.
func NewGetPublicGoogleReviewsHandler(service *publicbooking.GoogleReviewsService) *GetPublicGoogleReviewsHandler {
	return &GetPublicGoogleReviewsHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *GetPublicGoogleReviewsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	reviews, err := h.service.Get(r.Context(), httpserver.URLParam(r, slugParam))
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newPublicGoogleReviewsResponse(reviews))
}

func newPublicGoogleReviewsResponse(g publicbooking.GoogleReviews) PublicGoogleReviewsResponse {
	items := make([]PublicGoogleReviewResponse, 0, len(g.Reviews))
	for _, r := range g.Reviews {
		items = append(items, PublicGoogleReviewResponse{
			AuthorName: r.AuthorName, AuthorURL: r.AuthorURL, Rating: r.Rating,
			Text: r.Text, RelativeTime: r.RelativeTime,
		})
	}
	return PublicGoogleReviewsResponse{
		Rating: g.Rating, RatingCount: g.RatingCount, MapsURL: g.MapsURL, Reviews: items,
	}
}

// weekdayNames son los valores de DayOfWeek.yaml en orden ISO (1 = lunes).
var weekdayNames = [...]string{"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"}

func weekdayName(iso int) string {
	if iso < 1 || iso > 7 {
		return ""
	}
	return weekdayNames[iso-1]
}

// clockText escribe minutos desde medianoche como `HH:MM`; 1440 es `24:00`.
func clockText(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}
