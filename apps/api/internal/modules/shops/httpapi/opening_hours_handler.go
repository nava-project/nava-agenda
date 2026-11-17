package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"system-barbershop/internal/modules/auth"
	"system-barbershop/internal/modules/shops"
	"system-barbershop/internal/platform/apperr"
	"system-barbershop/internal/platform/httpserver"
)

// OpeningSegmentDTO es la forma exacta del componente OpenAPI
// OpeningHoursSegment.yaml (HU-107, DEC-182): un tramo `[opens, closes)` de un
// día de la semana, con horas `HH:MM` en la zona del local. `closes` admite
// `24:00`. El perfil público usa la misma forma.
type OpeningSegmentDTO struct {
	DayOfWeek string `json:"dayOfWeek"`
	Opens     string `json:"opens"`
	Closes    string `json:"closes"`
}

// OpeningHoursSettingsResponse es la representación de GET y PUT
// /private/settings/opening-hours.
type OpeningHoursSettingsResponse struct {
	OpeningHours      []OpeningSegmentDTO `json:"openingHours"`
	ClosedOnHolidays  bool                `json:"closedOnHolidays"`
	MaxSegmentsPerDay int                 `json:"maxSegmentsPerDay"`
}

// ReplaceOpeningHoursRequest es el cuerpo de PUT
// /private/settings/opening-hours: la semana completa. Cerrado: un campo
// desconocido se rechaza.
type ReplaceOpeningHoursRequest struct {
	OpeningHours     *[]OpeningSegmentDTO `json:"openingHours"`
	ClosedOnHolidays *bool                `json:"closedOnHolidays"`
}

// GetOpeningHoursHandler expone GET /private/settings/opening-hours.
type GetOpeningHoursHandler struct {
	service *shops.OpeningHoursService
}

// NewGetOpeningHoursHandler construye el handler de lectura.
func NewGetOpeningHoursHandler(service *shops.OpeningHoursService) *GetOpeningHoursHandler {
	return &GetOpeningHoursHandler{service: service}
}

// ServeHTTP implementa http.Handler. El negocio sale exclusivamente de
// auth.Principal.
func (h *GetOpeningHoursHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return
	}
	hours, err := h.service.Get(r.Context(), principal.BarbershopID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	writeOpeningHours(w, hours)
}

// ReplaceOpeningHoursHandler expone PUT /private/settings/opening-hours.
type ReplaceOpeningHoursHandler struct {
	service *shops.OpeningHoursService
}

// NewReplaceOpeningHoursHandler construye el handler de escritura.
func NewReplaceOpeningHoursHandler(service *shops.OpeningHoursService) *ReplaceOpeningHoursHandler {
	return &ReplaceOpeningHoursHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *ReplaceOpeningHoursHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return
	}

	var req ReplaceOpeningHoursRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Invalid("cuerpo JSON inválido o con un campo desconocido"), requestID))
		return
	}
	if dec.More() {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Invalid("cuerpo JSON inválido o con un campo desconocido"), requestID))
		return
	}
	if req.OpeningHours == nil || req.ClosedOnHolidays == nil {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Validation("openingHours y closedOnHolidays son obligatorios"), requestID))
		return
	}

	input := shops.OpeningHours{ClosedOnHolidays: *req.ClosedOnHolidays}
	for i, dto := range *req.OpeningHours {
		seg, err := parseOpeningSegment(dto)
		if err != nil {
			httpserver.WriteProblem(w, httpserver.Translate(
				apperr.Validation(fmt.Sprintf("openingHours[%d]: %s", i, err)), requestID))
			return
		}
		input.Segments = append(input.Segments, seg)
	}

	stored, err := h.service.Replace(r.Context(), principal.BarbershopID, input)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	writeOpeningHours(w, stored)
}

func parseOpeningSegment(dto OpeningSegmentDTO) (shops.OpeningSegment, error) {
	day, ok := shops.ParseWeekday(dto.DayOfWeek)
	if !ok {
		return shops.OpeningSegment{}, errors.New("dayOfWeek debe ser un día de MONDAY a SUNDAY")
	}
	opens, ok := shops.ParseClock(dto.Opens)
	if !ok {
		return shops.OpeningSegment{}, errors.New("opens debe tener la forma HH:MM")
	}
	closes, ok := shops.ParseClock(dto.Closes)
	if !ok {
		return shops.OpeningSegment{}, errors.New("closes debe tener la forma HH:MM (24:00 es medianoche)")
	}
	return shops.OpeningSegment{Weekday: day, Opens: opens, Closes: closes}, nil
}

func writeOpeningHours(w http.ResponseWriter, hours shops.OpeningHours) {
	segments := make([]OpeningSegmentDTO, 0, len(hours.Segments))
	for _, seg := range hours.Segments {
		segments = append(segments, OpeningSegmentDTO{
			DayOfWeek: seg.Weekday.String(), Opens: seg.Opens.String(), Closes: seg.Closes.String(),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(OpeningHoursSettingsResponse{
		OpeningHours:      segments,
		ClosedOnHolidays:  hours.ClosedOnHolidays,
		MaxSegmentsPerDay: shops.MaxOpeningSegmentsPerDay,
	})
}
