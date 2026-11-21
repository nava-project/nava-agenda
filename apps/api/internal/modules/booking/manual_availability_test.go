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
	starts   []time.Time
	called   bool
	from, to string
	duration int
	err      error
}

func (f *fakeManualSlotsPort) ManualStarts(_ context.Context, _, _ string, durationMinutes int, fromDate, toDate string) ([]time.Time, string, int, error) {
	f.called, f.from, f.to, f.duration = true, fromDate, toDate, durationMinutes
	return f.starts, "America/Bogota", 30, f.err
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
			svc := booking.NewManualAvailabilityService(fakeProfessionalServicePort{found: true, durationMinutes: 30}, slots)
			_, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, tc.from, tc.to)
			assertKind(t, err, apperr.KindValidation)
			if slots.called {
				t.Fatal("no debía calcular inicios con un tramo inválido")
			}
		})
	}
}

func TestManualAvailability_ThirtyOneDaysAndSingleDay_AreAccepted(t *testing.T) {
	slots := &fakeManualSlotsPort{}
	svc := booking.NewManualAvailabilityService(fakeProfessionalServicePort{found: true, durationMinutes: 45}, slots)

	if _, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-01", "2026-12-01"); err != nil {
		t.Fatalf("31 días: %v", err)
	}
	got, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "")
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
			svc := booking.NewManualAvailabilityService(tc.catalog, slots)
			_, err := svc.List(context.Background(), "shop-1", tc.professionalID, tc.service, "2026-11-23", "2026-11-24")
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
	)
	got, err := svc.List(context.Background(), "shop-1", manualAvailProfessionalID, manualAvailServiceID, "2026-11-23", "2026-11-23")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got.Starts) != 1 || !got.Starts[0].Equal(start) {
		t.Fatalf("Starts = %v", got.Starts)
	}
}
