// Pruebas del adaptador HTTP de la reprogramación del cliente (HU-104) en
// aislamiento: cabeceras obligatorias, cuerpo cerrado, traducción de los
// rechazos y franjas en UTC. La transacción real se prueba con PostgreSQL en
// booking/postgres.
package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"system-barbershop/internal/modules/customeraccess"
	"system-barbershop/internal/modules/customeraccess/httpapi"
	"system-barbershop/internal/platform/apperr"
	"system-barbershop/internal/platform/httpserver"
	"system-barbershop/internal/platform/idempotency"
)

type fakeRescheduler struct {
	calls    int
	startsAt string
	version  string
	shop     string
	appt     string
	starts   []time.Time
	err      error
	decision idempotency.Decision
	stored   idempotency.StoredResponse
}

func (f *fakeRescheduler) ListRescheduleStarts(_ context.Context, shop, appt string) ([]time.Time, error) {
	f.shop, f.appt = shop, appt
	return f.starts, f.err
}

func (f *fakeRescheduler) RescheduleAppointment(
	_ context.Context, shop, appt, startsAt, version string, _ idempotency.Key, _ idempotency.Fingerprint,
) (idempotency.Decision, idempotency.StoredResponse, error) {
	f.calls++
	f.shop, f.appt, f.startsAt, f.version = shop, appt, startsAt, version
	return f.decision, f.stored, f.err
}

func rescheduleService(r *fakeRescheduler, found bool) *customeraccess.Service {
	repo := &fakeRepository{
		targetFound: found,
		target:      customeraccess.CancellationTarget{BarbershopID: "shop-1", AppointmentID: "appt-1", Timezone: "America/Bogota"},
	}
	return customeraccess.NewService(repo, customeraccess.WithRescheduler(r, func(done int) int { return 2 - done }))
}

func rescheduleRequest(body string, headers map[string]string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/customer/appointments/token-en-claro/reschedule", strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return httpserver.RequestWithURLParam(req, "token", "token-en-claro")
}

func TestRescheduleHandler_Success_ForwardsStartAndVersion(t *testing.T) {
	r := &fakeRescheduler{
		decision: idempotency.Decision{Outcome: idempotency.OutcomeProceed},
		stored:   idempotency.StoredResponse{Status: 200, ContentType: "application/json", Body: `{"startsAt":"2026-11-20T20:00:00Z","endsAt":"2026-11-20T20:30:00Z"}`},
	}
	rec := httptest.NewRecorder()
	httpapi.NewRescheduleAppointmentHandler(rescheduleService(r, true)).ServeHTTP(rec, rescheduleRequest(`{"startsAt":"2026-11-20T20:00:00Z"}`, okHeaders))

	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "2026-11-20T20:00:00Z") {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", rec.Header().Get("Cache-Control"))
	}
	if r.calls != 1 || r.shop != "shop-1" || r.appt != "appt-1" || r.startsAt != "2026-11-20T20:00:00Z" || r.version != "v1" {
		t.Fatalf("rescheduler = %+v", r)
	}
}

func TestRescheduleHandler_RejectsBadRequestsBeforeTouchingTheService(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		headers map[string]string
	}{
		{"sin Idempotency-Key", `{"startsAt":"2026-11-20T20:00:00Z"}`, map[string]string{"If-Match": "v1"}},
		{"sin If-Match", `{"startsAt":"2026-11-20T20:00:00Z"}`, map[string]string{"Idempotency-Key": okHeaders["Idempotency-Key"]}},
		{"cuerpo vacío", ``, okHeaders},
		{"sin startsAt", `{}`, okHeaders},
		{"campo desconocido", `{"startsAt":"2026-11-20T20:00:00Z","barberId":"x"}`, okHeaders},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := &fakeRescheduler{}
			rec := httptest.NewRecorder()
			httpapi.NewRescheduleAppointmentHandler(rescheduleService(r, true)).ServeHTTP(rec, rescheduleRequest(tc.body, tc.headers))
			if rec.Code != http.StatusBadRequest || r.calls != 0 {
				t.Fatalf("got %d calls=%d %s", rec.Code, r.calls, rec.Body.String())
			}
		})
	}
}

func TestRescheduleHandler_TranslatesRejections(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{apperr.RescheduleWindowClosed("fuera"), http.StatusUnprocessableEntity, "reschedule-window-closed"},
		{apperr.RescheduleLimitReached("límite"), http.StatusUnprocessableEntity, "reschedule-limit-reached"},
		{apperr.ScheduleConflict("ocupada"), http.StatusConflict, "slot-conflict"},
		{apperr.VersionConflict("cambió"), http.StatusConflict, "version-conflict"},
	}
	for _, tc := range cases {
		r := &fakeRescheduler{err: tc.err}
		rec := httptest.NewRecorder()
		httpapi.NewRescheduleAppointmentHandler(rescheduleService(r, true)).ServeHTTP(rec, rescheduleRequest(`{"startsAt":"2026-11-20T20:00:00Z"}`, okHeaders))
		if rec.Code != tc.status {
			t.Fatalf("%s: status %d", tc.code, rec.Code)
		}
		if p := problemOf(t, rec); p.Code != tc.code {
			t.Fatalf("code = %q, quiero %q", p.Code, tc.code)
		}
	}
}

func TestRescheduleHandler_UnknownToken_UniformNotFound(t *testing.T) {
	r := &fakeRescheduler{}
	rec := httptest.NewRecorder()
	httpapi.NewRescheduleAppointmentHandler(rescheduleService(r, false)).ServeHTTP(rec, rescheduleRequest(`{"startsAt":"2026-11-20T20:00:00Z"}`, okHeaders))
	if rec.Code != http.StatusNotFound || r.calls != 0 {
		t.Fatalf("got %d calls=%d", rec.Code, r.calls)
	}
}

func TestListRescheduleSlotsHandler_ReturnsTimezoneAndUTCStarts(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	r := &fakeRescheduler{starts: []time.Time{time.Date(2026, 11, 20, 15, 0, 0, 0, loc)}}
	req := httpserver.RequestWithURLParam(httptest.NewRequest(http.MethodGet, "/api/v1/customer/appointments/t/reschedule-slots", nil), "token", "t")
	rec := httptest.NewRecorder()
	httpapi.NewListRescheduleSlotsHandler(rescheduleService(r, true)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	var body httpapi.RescheduleSlotsResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Timezone != "America/Bogota" || len(body.Starts) != 1 || !strings.Contains(rec.Header().Get("Content-Type"), "json") {
		t.Fatalf("body = %+v", body)
	}
	if r.shop != "shop-1" || r.appt != "appt-1" {
		t.Fatalf("resolución del token: %+v", r)
	}
}

func TestListRescheduleSlotsHandler_UnknownToken_UniformNotFound(t *testing.T) {
	req := httpserver.RequestWithURLParam(httptest.NewRequest(http.MethodGet, "/x", nil), "token", "t")
	rec := httptest.NewRecorder()
	httpapi.NewListRescheduleSlotsHandler(rescheduleService(&fakeRescheduler{}, false)).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d", rec.Code)
	}
}
