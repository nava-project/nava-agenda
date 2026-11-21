// Pruebas de integración de #717 (inicios libres para un turno manual) contra
// el router REAL de producción (buildRouter) y PostgreSQL real con dos
// negocios. Requieren las migraciones aplicadas y database/testdata/dos_negocios.sql
// + testdata/hu005_credenciales_sesiones.sql cargados.
//
//	export TEST_DATABASE_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable"
//	go test -race ./cmd/api/...
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Semana fija de 2027 (futura para siempre en esta suite):
//   - lunes 19: jornada normal con un bloqueo y tres turnos;
//   - martes 20: Día de la Independencia, con el calendario de festivos activado;
//   - miércoles 21: excepción cerrada;
//   - jueves 22: excepción abierta con un tramo especial de 10:00 a 12:00.
const (
	manualDayNormal    = "2027-07-19"
	manualDayHoliday   = "2027-07-20"
	manualDayClosed    = "2027-07-21"
	manualDaySpecial   = "2027-07-22"
	manualAvailability = "/availability"
)

type manualAvailabilityBody struct {
	Slots []struct {
		StartsAt time.Time `json:"startsAt"`
	} `json:"slots"`
	DurationMinutes int    `json:"durationMinutes"`
	Timezone        string `json:"timezone"`
	SlotGridMinutes int    `json:"slotGridMinutes"`
}

func doManualAvailability(router http.Handler, rawToken, professionalID, serviceID, query string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/professionals/"+professionalID+"/services/"+serviceID+manualAvailability+query, nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: rawToken})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// doAppointmentCommand envía un comando de turno con Idempotency-Key y, si se
// da, If-Match (cancelar y reprogramar lo exigen).
func doAppointmentCommand(router http.Handler, rawToken, path, key, ifMatch, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/private"+path, bytes.NewReader([]byte(body)))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Idempotency-Key", key)
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	req.AddCookie(&http.Cookie{Name: cookieName, Value: rawToken})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func mustStatus(t *testing.T, rec *httptest.ResponseRecorder, want int, what string) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("%s: expected %d, got %d: %s", what, want, rec.Code, rec.Body.String())
	}
}

func createManualAppointment(t *testing.T, router http.Handler, raw, professionalID, serviceID, startsAt string) string {
	t.Helper()
	body := fmt.Sprintf(`{"professionalId":%q,"serviceId":%q,"attendeeName":"Cliente de prueba","customerFullName":"Cliente de prueba","customerPhone":null,"customerEmail":null,"customerNote":null,"startsAt":%q}`,
		professionalID, serviceID, startsAt)
	rec := doAppointmentCommand(router, raw, "/appointments", uniqueToken(t, "manual-avail-appt"), "", body)
	mustStatus(t, rec, http.StatusCreated, "crear turno "+startsAt)
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	return created.ID
}

func appointmentVersion(t *testing.T, router http.Handler, raw, appointmentID string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/appointments/"+appointmentID, nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: raw})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	mustStatus(t, rec, http.StatusOK, "detalle del turno")
	var detail struct {
		VersionToken string `json:"versionToken"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &detail)
	return detail.VersionToken
}

// manualStartsByDay agrupa los inicios por fecha civil, con la hora "15:04",
// en la zona que la propia respuesta declara.
func manualStartsByDay(t *testing.T, body manualAvailabilityBody) map[string][]string {
	t.Helper()
	loc, err := time.LoadLocation(body.Timezone)
	if err != nil {
		t.Fatalf("zona %q: %v", body.Timezone, err)
	}
	out := map[string][]string{}
	for _, s := range body.Slots {
		local := s.StartsAt.In(loc)
		day := local.Format("2006-01-02")
		out[day] = append(out[day], local.Format("15:04"))
	}
	return out
}

func hasClock(list []string, clock string) bool {
	for _, c := range list {
		if c == clock {
			return true
		}
	}
	return false
}

// TestManualAvailability_HTTP_EffectiveDayMinusBlocksAndAppointments_TwoTenants
// recorre, con PostgreSQL real, lo que la lectura privada resta y respeta:
// jornada recurrente, festivo activado, excepción cerrada y tramo especial;
// bloqueo y turno restados; un turno cancelado libera su hueco y uno
// reprogramado ocupa solo el nuevo. El negocio B nunca ve nada de A (404).
func TestManualAvailability_HTTP_EffectiveDayMinusBlocksAndAppointments_TwoTenants(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { db.Close() })
	router, err := buildRouter(db, discardLogger(), testRouterConfig())
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}

	rawA := createSessionCookie(t, db, shopA, staffUserActiveA, "manual-avail-a")
	professional := createProfessionalViaRouter(t, router, rawA, "Profesional Inicios Manuales "+uniqueToken(t, "pro"))
	service := createServiceViaRouter(t, router, rawA, "Servicio Inicios Manuales "+uniqueToken(t, "svc"))
	mustStatus(t, doAssignServiceRequest(router, rawA, professional.ID, service.ID), http.StatusCreated, "asignar servicio")

	for weekday := 1; weekday <= 7; weekday++ {
		body := fmt.Sprintf(`{"isoWeekday":%d,"startsTime":"09:00","durationMinutes":480}`, weekday)
		mustStatus(t, doCreateWorkingHourRequest(router, rawA, professional.ID, uniqueToken(t, "manual-avail-wh"), body), http.StatusCreated, "tramo semanal")
	}
	mustStatus(t, doUpdateHolidayCalendarRequest(router, rawA, professional.ID, `{"enabled":true}`), http.StatusOK, "activar festivos")
	mustStatus(t, doCreateScheduleExceptionRequest(router, rawA, professional.ID, uniqueToken(t, "manual-avail-closed"),
		`{"effectiveDate":"`+manualDayClosed+`","isClosed":true}`), http.StatusCreated, "excepción cerrada")
	mustStatus(t, doCreateScheduleExceptionRequest(router, rawA, professional.ID, uniqueToken(t, "manual-avail-open"),
		`{"effectiveDate":"`+manualDaySpecial+`","isClosed":false,"segments":[{"startsTime":"10:00","durationMinutes":120}]}`), http.StatusCreated, "excepción abierta")
	mustStatus(t, doJSONRequest(router, http.MethodPost, rawA, "/professionals/"+professional.ID+"/time-blocks", uniqueToken(t, "manual-avail-block"),
		`{"blockType":"emergency","startsAt":"`+manualDayNormal+`T09:00:00-05:00","endsAt":"`+manualDayNormal+`T10:00:00-05:00"}`), http.StatusCreated, "bloqueo")

	createManualAppointment(t, router, rawA, professional.ID, service.ID, manualDayNormal+"T11:00:00")
	cancelled := createManualAppointment(t, router, rawA, professional.ID, service.ID, manualDayNormal+"T12:00:00")
	mustStatus(t, doAppointmentCommand(router, rawA, "/appointments/"+cancelled+"/cancel", uniqueToken(t, "manual-avail-cancel"),
		appointmentVersion(t, router, rawA, cancelled), ""), http.StatusOK, "cancelar")
	moved := createManualAppointment(t, router, rawA, professional.ID, service.ID, manualDayNormal+"T14:00:00")
	mustStatus(t, doAppointmentCommand(router, rawA, "/appointments/"+moved+"/reschedule", uniqueToken(t, "manual-avail-move"),
		appointmentVersion(t, router, rawA, moved), `{"startsAt":"`+manualDayNormal+`T15:00:00"}`), http.StatusOK, "reprogramar")

	rec := doManualAvailability(router, rawA, professional.ID, service.ID, "?from="+manualDayNormal+"&to="+manualDaySpecial)
	mustStatus(t, rec, http.StatusOK, "inicios de A")
	var body manualAvailabilityBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DurationMinutes != 30 || body.SlotGridMinutes <= 0 || 60%body.SlotGridMinutes != 0 {
		t.Fatalf("contexto inesperado (la prueba asume una rejilla que divide la hora): %+v", body)
	}
	byDay := manualStartsByDay(t, body)

	normal := byDay[manualDayNormal]
	for _, absent := range []string{"09:00", "11:00", "15:00"} {
		if hasClock(normal, absent) {
			t.Fatalf("%s %s debía estar ocupado (bloqueo, turno o turno reprogramado): %v", manualDayNormal, absent, normal)
		}
	}
	for _, present := range []string{"10:00", "12:00", "14:00", "16:30"} {
		if !hasClock(normal, present) {
			t.Fatalf("%s %s debía estar libre (fin del bloqueo, turno cancelado, hora vieja del reprogramado): %v", manualDayNormal, present, normal)
		}
	}
	if hasClock(normal, "17:00") {
		t.Fatalf("17:00 no cabe: la jornada termina a las 17:00: %v", normal)
	}
	if got := byDay[manualDayHoliday]; len(got) != 0 {
		t.Fatalf("festivo activado: sin inicios, got %v", got)
	}
	if got := byDay[manualDayClosed]; len(got) != 0 {
		t.Fatalf("excepción cerrada: sin inicios, got %v", got)
	}
	special := byDay[manualDaySpecial]
	if len(special) == 0 || special[0] != "10:00" || special[len(special)-1] != "11:30" {
		t.Fatalf("tramo especial 10:00–12:00: inicios de 10:00 a 11:30, got %v", special)
	}

	// Aislamiento (RN-TEN-01): B con el profesional y el servicio de A, o con
	// su propio profesional y el servicio de A, recibe el mismo 404 que «no
	// existe», sin distinguir la causa.
	rawB := createSessionCookie(t, db, shopB, staffUserActiveB, "manual-avail-b")
	professionalB := createProfessionalViaRouter(t, router, rawB, "Profesional B Inicios "+uniqueToken(t, "pro-b"))
	notFound := []*httptest.ResponseRecorder{
		doManualAvailability(router, rawB, professional.ID, service.ID, "?from="+manualDayNormal),
		doManualAvailability(router, rawB, professionalB.ID, service.ID, "?from="+manualDayNormal),
		doManualAvailability(router, rawA, professional.ID, "00000000-0000-4000-8000-000000000000", "?from="+manualDayNormal),
		doManualAvailability(router, rawA, "no-es-uuid", service.ID, "?from="+manualDayNormal),
	}
	var details []string
	for i, r := range notFound {
		mustStatus(t, r, http.StatusNotFound, fmt.Sprintf("404 uniforme #%d", i))
		var p struct {
			Detail string `json:"detail"`
			Code   string `json:"code"`
		}
		_ = json.Unmarshal(r.Body.Bytes(), &p)
		details = append(details, p.Code+"|"+p.Detail)
	}
	for i := 1; i < len(details); i++ {
		if details[i] != details[0] {
			t.Fatalf("el 404 distingue la causa: %q frente a %q", details[i], details[0])
		}
	}
}

// TestManualAvailability_HTTP_BadRange_Returns422 cubre el rango: from
// ausente o mal formado, to anterior a from y más de 31 días.
func TestManualAvailability_HTTP_BadRange_Returns422(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { db.Close() })
	router, err := buildRouter(db, discardLogger(), testRouterConfig())
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}
	raw := createSessionCookie(t, db, shopA, staffUserActiveA, "manual-avail-range")
	professional := createProfessionalViaRouter(t, router, raw, "Profesional Rango "+uniqueToken(t, "pro"))
	service := createServiceViaRouter(t, router, raw, "Servicio Rango "+uniqueToken(t, "svc"))
	mustStatus(t, doAssignServiceRequest(router, raw, professional.ID, service.ID), http.StatusCreated, "asignar servicio")

	for _, query := range []string{"", "?from=2027-7-19", "?from=2027-07-19&to=2027-07-18", "?from=2027-07-01&to=2027-08-01"} {
		rec := doManualAvailability(router, raw, professional.ID, service.ID, query)
		mustStatus(t, rec, http.StatusUnprocessableEntity, "rango "+query)
	}
	mustStatus(t, doManualAvailability(router, raw, professional.ID, service.ID, "?from=2027-07-01&to=2027-07-31"), http.StatusOK, "31 días")
}
