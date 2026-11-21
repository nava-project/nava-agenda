package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/modules/booking/httpapi"
	"nava-agenda/internal/platform/httpserver"
)

// Pruebas del handler de GET /private/professionals/{professionalId}/services/{serviceId}/availability
// (#717): parámetros, principal, forma de la respuesta y traducción de errores.

const (
	manualAvailHandlerProfessionalID = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"
	manualAvailHandlerServiceID      = "3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
)

type handlerCatalog struct{ found bool }

func (c handlerCatalog) ActiveAssignedService(context.Context, string, string, string) (string, int, int64, string, bool, error) {
	return "Corte", 30, 2000000, "COP", c.found, nil
}

type handlerSlots struct {
	starts      []time.Time
	gotDuration *int
}

func (s handlerSlots) ManualStarts(_ context.Context, _, _ string, durationMinutes int, _, _ string, _, _ time.Time) ([]time.Time, string, int, error) {
	if s.gotDuration != nil {
		*s.gotDuration = durationMinutes
	}
	return s.starts, "America/Bogota", 30, nil
}

// handlerExcludable responde con un turno confirmado propio para
// manualAvailHandlerAppointmentID y «no encontrado» para cualquier otro.
type handlerExcludable struct{}

const manualAvailHandlerAppointmentID = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e"

func (handlerExcludable) ExcludableAppointment(_ context.Context, _, appointmentID string) (booking.ExcludableAppointment, bool, error) {
	if appointmentID != manualAvailHandlerAppointmentID {
		return booking.ExcludableAppointment{}, false, nil
	}
	start := time.Date(2026, 11, 23, 14, 0, 0, 0, time.UTC)
	return booking.ExcludableAppointment{
		ProfessionalID: manualAvailHandlerProfessionalID, ServiceID: manualAvailHandlerServiceID,
		Status: booking.StatusConfirmed, StartsAt: start, EndsAt: start.Add(20 * time.Minute), DurationMinutesSnapshot: 20,
	}, true, nil
}

func serveManualAvailability(t *testing.T, found bool, starts []time.Time, query string) *httptest.ResponseRecorder {
	t.Helper()
	h := httpapi.NewListManualAvailabilityHandler(booking.NewManualAvailabilityService(handlerCatalog{found: found}, handlerSlots{starts: starts}, handlerExcludable{}))
	req := requestWithPrincipal(http.MethodGet, "/api/v1/private/professionals/"+manualAvailHandlerProfessionalID+"/services/"+manualAvailHandlerServiceID+"/availability"+query, nil)
	req = httpserver.RequestWithURLParam(req, "professionalId", manualAvailHandlerProfessionalID)
	req = httpserver.RequestWithURLParam(req, "serviceId", manualAvailHandlerServiceID)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestListManualAvailabilityHandler_Returns200WithUTCStarts(t *testing.T) {
	bogota, _ := time.LoadLocation("America/Bogota")
	start := time.Date(2026, 11, 23, 9, 0, 0, 0, bogota)
	rec := serveManualAvailability(t, true, []time.Time{start}, "?from=2026-11-23&to=2026-11-24")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Slots []struct {
			StartsAt string `json:"startsAt"`
		} `json:"slots"`
		DurationMinutes int    `json:"durationMinutes"`
		Timezone        string `json:"timezone"`
		SlotGridMinutes int    `json:"slotGridMinutes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Slots) != 1 || body.Slots[0].StartsAt != "2026-11-23T14:00:00Z" {
		t.Fatalf("slots = %+v, want 2026-11-23T14:00:00Z", body.Slots)
	}
	if body.DurationMinutes != 30 || body.Timezone != "America/Bogota" || body.SlotGridMinutes != 30 {
		t.Fatalf("contexto inesperado: %+v", body)
	}
}

func TestListManualAvailabilityHandler_EmptyIsAnArray(t *testing.T) {
	rec := serveManualAvailability(t, true, nil, "?from=2026-11-23")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]json.RawMessage
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if string(body["slots"]) != "[]" {
		t.Fatalf("slots = %s, want []", body["slots"])
	}
}

func TestListManualAvailabilityHandler_BadRange_Returns422Problem(t *testing.T) {
	for _, query := range []string{"", "?from=hoy", "?from=2026-11-23&to=2026-11-01", "?from=2026-11-01&to=2026-12-15"} {
		rec := serveManualAvailability(t, true, nil, query)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%q: expected 422, got %d: %s", query, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
			t.Fatalf("%q: Content-Type = %q", query, ct)
		}
	}
}

func TestListManualAvailabilityHandler_Unassigned_Returns404Problem(t *testing.T) {
	rec := serveManualAvailability(t, false, nil, "?from=2026-11-23")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// #776: excludeAppointmentId llega al servicio; con un turno propio válido la
// duración es la del snapshot y, con uno inválido, la respuesta es idéntica a
// no enviar el parámetro.
func TestListManualAvailabilityHandler_ExcludeAppointmentID(t *testing.T) {
	base := "?from=2026-11-23"
	plain := serveManualAvailability(t, true, nil, base)
	valid := serveManualAvailability(t, true, nil, base+"&excludeAppointmentId="+manualAvailHandlerAppointmentID)
	if valid.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", valid.Code, valid.Body.String())
	}
	var body struct {
		DurationMinutes int `json:"durationMinutes"`
	}
	if err := json.Unmarshal(valid.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DurationMinutes != 20 {
		t.Fatalf("durationMinutes = %d, want 20 (snapshot)", body.DurationMinutes)
	}
	for _, bad := range []string{"", "no-es-uuid", "0e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b"} {
		rec := serveManualAvailability(t, true, nil, base+"&excludeAppointmentId="+bad)
		if rec.Code != http.StatusOK || rec.Body.String() != plain.Body.String() {
			t.Fatalf("excludeAppointmentId=%q: %d %s, want the same 200 as without it: %s", bad, rec.Code, rec.Body.String(), plain.Body.String())
		}
	}
}
