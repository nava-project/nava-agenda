package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"system-barbershop/internal/modules/auth"
	"system-barbershop/internal/modules/shops"
	"system-barbershop/internal/platform/apperr"
	"system-barbershop/internal/platform/httpserver"
)

// ReminderSettingsResponse es la representación de GET y PATCH
// /private/settings/reminders (DEC-174).
type ReminderSettingsResponse struct {
	LeadMinutes int   `json:"leadMinutes"`
	LeadOptions []int `json:"leadOptions"`
}

// UpdateReminderSettingsRequest es el cuerpo de PATCH
// /private/settings/reminders. Cerrado: un campo desconocido se rechaza.
type UpdateReminderSettingsRequest struct {
	LeadMinutes *int `json:"leadMinutes"`
}

// GetReminderSettingsHandler expone GET /private/settings/reminders.
type GetReminderSettingsHandler struct {
	service *shops.ReminderSettingsService
}

// NewGetReminderSettingsHandler construye el handler de lectura.
func NewGetReminderSettingsHandler(service *shops.ReminderSettingsService) *GetReminderSettingsHandler {
	return &GetReminderSettingsHandler{service: service}
}

// ServeHTTP implementa http.Handler. El negocio sale exclusivamente de
// auth.Principal.
func (h *GetReminderSettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return
	}
	lead, err := h.service.Get(r.Context(), principal.BarbershopID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	writeReminderSettings(w, lead)
}

// UpdateReminderSettingsHandler expone PATCH /private/settings/reminders.
type UpdateReminderSettingsHandler struct {
	service *shops.ReminderSettingsService
}

// NewUpdateReminderSettingsHandler construye el handler de actualización.
func NewUpdateReminderSettingsHandler(service *shops.ReminderSettingsService) *UpdateReminderSettingsHandler {
	return &UpdateReminderSettingsHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *UpdateReminderSettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return
	}

	var req UpdateReminderSettingsRequest
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
	if req.LeadMinutes == nil {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Validation("leadMinutes es obligatorio"), requestID))
		return
	}

	lead, err := h.service.Update(r.Context(), principal.BarbershopID, shops.ReminderLeadMinutes(*req.LeadMinutes))
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	writeReminderSettings(w, lead)
}

func writeReminderSettings(w http.ResponseWriter, lead shops.ReminderLeadMinutes) {
	options := make([]int, len(shops.ReminderLeadOptions))
	for i, option := range shops.ReminderLeadOptions {
		options[i] = int(option)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(ReminderSettingsResponse{LeadMinutes: int(lead), LeadOptions: options})
}
