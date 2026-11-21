package booking_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
)

// Pruebas de ManualAvailabilityService (#717): validación del tramo (422),
// 404 uniforme de la asignación (DEC-072) y paso de la respuesta del puerto.

const (
	manualAvailProfessionalID = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"
	manualAvailServiceID      = "3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
)

type fakeManualSlotsPort struct {
	starts                   []time.Time
	called                   bool
	from, to                 string
	duration                 int
	excludeStart, excludeEnd time.Time
	err                      error
}

func (f *fakeManualSlotsPort) ManualStarts(_ context.Context, _, _ string, durationMinutes int, fromDate, toDate string, excludeStartsAt, excludeEndsAt time.Time) ([]time.Time, string, int, error) {
	f.called, f.from, f.to, f.duration = true, fromDate, toDate, durationMinutes
	f.excludeStart, f.excludeEnd = excludeStartsAt, excludeEndsAt
	return f.starts, "America/Bogota", 30, f.err
}

// fakeExcludablePort devuelve un turno fijo para un id, o found=false.
type fakeExcludablePort struct {
	id     string
	own    booking.ExcludableAppointment
	err    error
	called bool
}

func (f *fakeExcludablePort) ExcludableAppointment(_ context.Context, _, appointmentID string) (booking.ExcludableAppointment, bool, error) {
	f.called = true
	if f.err != nil {
		return booking.ExcludableAppointment{}, false, f.err
	}
	if appointmentID != f.id {
		return booking.ExcludableAppointment{}, false, nil
	}
	return f.own, true, nil
}

func TestManualAvailability_RangeValidation_Returns422(t *testing.T) {
	cases := []struct{ name, from, to string }{
		{"sin from", "", ""},
		{"from mal formado", "2026-11-3", ""},
		{"to mal formado", "2026-11-23", "23/11/2026"},
		{"to anterior a from", "2026-11-23", "2026-11-22"},
		{"32 días", "2026-11-01", "2026-12-02"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			slots := &fakeManualSlotsPort{}
			svc := booking.NewManualAvailabilityService(fakeProfessionalServicePort{found: true, durationMinutes: 30}, slots, &fakeExcludablePort{})
			_, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, tc.from, tc.to, "")
			assertKind(t, err, apperr.KindValidation)
			if slots.called {
				t.Fatal("no debía calcular inicios con un tramo inválido")
			}
		})
	}
}

func TestManualAvailability_ThirtyOneDaysAndSingleDay_AreAccepted(t *testing.T) {
	slots := &fakeManualSlotsPort{}
	svc := booking.NewManualAvailabilityService(fakeProfessionalServicePort{found: true, durationMinutes: 45}, slots, &fakeExcludablePort{})

	if _, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-01", "2026-12-01", ""); err != nil {
		t.Fatalf("31 días: %v", err)
	}
	got, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "", "")
	if err != nil {
		t.Fatalf("un día: %v", err)
	}
	if slots.from != "2026-11-23" || slots.to != "2026-11-23" || slots.duration != 45 {
		t.Fatalf("puerto recibió %s–%s/%d", slots.from, slots.to, slots.duration)
	}
	if got.Starts == nil || len(got.Starts) != 0 {
		t.Fatalf("sin inicios debe ser una lista vacía, no nula: %#v", got.Starts)
	}
	if got.DurationMinutes != 45 || got.Timezone != "America/Bogota" || got.SlotGridMinutes != 30 {
		t.Fatalf("contexto inesperado: %+v", got)
	}
}

func TestManualAvailability_UnassignedForeignOrMalformed_ReturnsUniform404(t *testing.T) {
	cases := []struct {
		name                    string
		professionalID, service string
		catalog                 fakeProfessionalServicePort
	}{
		{"servicio no asignado, ajeno o inexistente", manualAvailProfessionalID, manualAvailServiceID, fakeProfessionalServicePort{found: false}},
		{"profesional sin forma de UUID", "no-es-uuid", manualAvailServiceID, fakeProfessionalServicePort{found: true, durationMinutes: 30}},
		{"servicio sin forma de UUID", manualAvailProfessionalID, "no-es-uuid", fakeProfessionalServicePort{found: true, durationMinutes: 30}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			slots := &fakeManualSlotsPort{}
			svc := booking.NewManualAvailabilityService(tc.catalog, slots, &fakeExcludablePort{})
			_, err := svc.List(context.Background(), "shop-1", tc.professionalID, tc.service, "2026-11-23", "2026-11-24", "")
			assertKind(t, err, apperr.KindNotFound)
			if slots.called {
				t.Fatal("no debía calcular inicios sin asignación")
			}
		})
	}
}

func TestManualAvailability_PassesThePortStarts(t *testing.T) {
	start := time.Date(2026, 11, 23, 14, 0, 0, 0, time.UTC)
	svc := booking.NewManualAvailabilityService(
		fakeProfessionalServicePort{found: true, durationMinutes: 30},
		&fakeManualSlotsPort{starts: []time.Time{start}},
		&fakeExcludablePort{},
	)
	got, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "2026-11-23", "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got.Starts) != 1 || !got.Starts[0].Equal(start) {
		t.Fatalf("Starts = %v", got.Starts)
	}
}

const manualAvailAppointmentID = "6b0d1c2e-3f4a-45b6-87c8-d9e0f1a2b3c4"

func confirmedOwn() booking.ExcludableAppointment {
	start := time.Date(2026, 11, 23, 14, 0, 0, 0, time.UTC)
	return booking.ExcludableAppointment{
		ProfessionalID:          manualAvailProfessionalID,
		ServiceID:               manualAvailServiceID,
		Status:                  booking.StatusConfirmed,
		StartsAt:                start,
		EndsAt:                  start.Add(30 * time.Minute),
		DurationMinutesSnapshot: 30,
	}
}

// #776: un turno confirmado de este profesional y servicio sale de la ocupación,
// y el cálculo usa su duración congelada (30), no la del catálogo (45).
func TestManualAvailability_ExcludesOwnConfirmedAppointmentWithItsSnapshotDuration(t *testing.T) {
	slots := &fakeManualSlotsPort{}
	own := confirmedOwn()
	svc := booking.NewManualAvailabilityService(
		fakeProfessionalServicePort{found: true, durationMinutes: 45},
		slots,
		&fakeExcludablePort{id: manualAvailAppointmentID, own: own},
	)
	got, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "", " "+manualAvailAppointmentID+" ")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if slots.duration != 30 || got.DurationMinutes != 30 {
		t.Fatalf("duración: puerto %d, respuesta %d; quería 30 (snapshot)", slots.duration, got.DurationMinutes)
	}
	if !slots.excludeStart.Equal(own.StartsAt) || !slots.excludeEnd.Equal(own.EndsAt) {
		t.Fatalf("intervalo excluido %v–%v", slots.excludeStart, slots.excludeEnd)
	}
}

// Cualquier exclusión que no vale se ignora en silencio: la misma llamada al
// puerto que sin el parámetro (duración del catálogo, sin intervalo), sin error.
func TestManualAvailability_InvalidExclusion_IsIgnoredSilently(t *testing.T) {
	mutate := func(f func(*booking.ExcludableAppointment)) booking.ExcludableAppointment {
		own := confirmedOwn()
		f(&own)
		return own
	}
	cases := []struct {
		name     string
		raw      string
		port     *fakeExcludablePort
		lookedUp bool
	}{
		{"vacío", "", &fakeExcludablePort{}, false},
		{"sin forma de UUID", "no-es-uuid", &fakeExcludablePort{}, false},
		{"inexistente o de otro negocio", manualAvailAppointmentID, &fakeExcludablePort{id: "otro"}, true},
		{"de otro profesional", manualAvailAppointmentID, &fakeExcludablePort{id: manualAvailAppointmentID, own: mutate(func(o *booking.ExcludableAppointment) { o.ProfessionalID = "1c2d3e4f-5a6b-47c8-89d0-e1f2a3b4c5d6" })}, true},
		{"de otro servicio", manualAvailAppointmentID, &fakeExcludablePort{id: manualAvailAppointmentID, own: mutate(func(o *booking.ExcludableAppointment) { o.ServiceID = "1c2d3e4f-5a6b-47c8-89d0-e1f2a3b4c5d6" })}, true},
		{"cancelado por el cliente", manualAvailAppointmentID, &fakeExcludablePort{id: manualAvailAppointmentID, own: mutate(func(o *booking.ExcludableAppointment) { o.Status = booking.StatusCancelledByCustomer })}, true},
		{"cancelado por el profesional", manualAvailAppointmentID, &fakeExcludablePort{id: manualAvailAppointmentID, own: mutate(func(o *booking.ExcludableAppointment) { o.Status = booking.StatusCancelledByProfessional })}, true},
		{"completado", manualAvailAppointmentID, &fakeExcludablePort{id: manualAvailAppointmentID, own: mutate(func(o *booking.ExcludableAppointment) { o.Status = booking.StatusCompleted })}, true},
		{"no asistió", manualAvailAppointmentID, &fakeExcludablePort{id: manualAvailAppointmentID, own: mutate(func(o *booking.ExcludableAppointment) { o.Status = booking.StatusNoShow })}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			slots := &fakeManualSlotsPort{}
			svc := booking.NewManualAvailabilityService(fakeProfessionalServicePort{found: true, durationMinutes: 45}, slots, tc.port)
			got, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "", tc.raw)
			if err != nil {
				t.Fatalf("una exclusión que no vale no es un error: %v", err)
			}
			if tc.port.called != tc.lookedUp {
				t.Fatalf("lectura del turno = %v, quería %v", tc.port.called, tc.lookedUp)
			}
			if slots.duration != 45 || got.DurationMinutes != 45 || !slots.excludeStart.IsZero() || !slots.excludeEnd.IsZero() {
				t.Fatalf("debía calcular como sin parámetro: duración %d, intervalo %v–%v", slots.duration, slots.excludeStart, slots.excludeEnd)
			}
		})
	}
}

// La exclusión no salta la asignación: sin servicio asignado sigue el 404
// uniforme y el turno ni se lee.
func TestManualAvailability_ExclusionDoesNotBypassTheAssignment404(t *testing.T) {
	port := &fakeExcludablePort{id: manualAvailAppointmentID, own: confirmedOwn()}
	svc := booking.NewManualAvailabilityService(fakeProfessionalServicePort{found: false}, &fakeManualSlotsPort{}, port)
	_, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "", manualAvailAppointmentID)
	assertKind(t, err, apperr.KindNotFound)
	if port.called {
		t.Fatal("no debía leer el turno sin asignación")
	}
}

func TestManualAvailability_ExclusionReadFailure_IsInternal(t *testing.T) {
	port := &fakeExcludablePort{err: context.DeadlineExceeded}
	svc := booking.NewManualAvailabilityService(fakeProfessionalServicePort{found: true, durationMinutes: 30}, &fakeManualSlotsPort{}, port)
	_, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "", manualAvailAppointmentID)
	assertKind(t, err, apperr.KindInternal)
}
