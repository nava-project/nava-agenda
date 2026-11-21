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

type handlerSlots struct{ starts []time.Time }

func (s handlerSlots) ManualStarts(context.Context, string, string, int, string, string) ([]time.Time, string, int, error) {
	return s.starts, "America/Bogota", 30, nil
}

func serveManualAvailability(t *testing.T, found bool, starts []time.Time, query string) *httptest.ResponseRecorder {
	t.Helper()
	h := httpapi.NewListManualAvailabilityHandler(booking.NewManualAvailabilityService(handlerCatalog{found: found}, handlerSlots{starts: starts}))
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
