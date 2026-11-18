package publicbooking_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
)

// HU-104 (DEC-178, punto 4): el turno propio no cuenta como ocupado, pero las
// demás citas y los bloqueos sí, igual que en la reserva pública.
func TestOfferedRescheduleStarts_IgnoresOnlyTheOwnAppointment(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	at := func(h, m int) time.Time { return time.Date(2026, time.September, 14, h, m, 0, 0, loc) }

	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	// Propio 10:00-10:30; otra cita 11:00-11:30; bloqueo 12:00-13:00.
	repo.occStarts = []time.Time{at(10, 0), at(11, 0)}
	repo.occEnds = []time.Time{at(10, 30), at(11, 30)}
	blocks.starts = []time.Time{at(12, 0)}
	blocks.ends = []time.Time{at(13, 0)}
	// La asignación desactivada no importa: el turno ya existe con su snapshot.
	assignments.found = false

	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	starts, err := svc.OfferedRescheduleStarts(context.Background(), "shop-1", availProfessionalID, 30, at(10, 0), at(10, 30))
	if err != nil {
		t.Fatalf("OfferedRescheduleStarts: %v", err)
	}
	has := func(t0 time.Time) bool {
		for _, s := range starts {
			if s.Equal(t0) {
				return true
			}
		}
		return false
	}
	if !has(at(10, 0)) || !has(at(10, 30)) {
		t.Fatalf("la hora propia y la siguiente quedan libres: %v", starts)
	}
	if has(at(11, 0)) || has(at(12, 0)) || has(at(12, 30)) {
		t.Fatalf("otra cita y el bloqueo siguen ocupando: %v", starts)
	}
}

// Un bloqueo con exactamente el mismo intervalo que el turno sigue contando:
// solo se quita una ocupación idéntica, la de la cita.
func TestOfferedRescheduleStarts_BlockWithSameIntervalStillCounts(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	at := func(h, m int) time.Time { return time.Date(2026, time.September, 14, h, m, 0, 0, loc) }

	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	repo.occStarts = []time.Time{at(10, 0)}
	repo.occEnds = []time.Time{at(10, 30)}
	blocks.starts = []time.Time{at(10, 0)}
	blocks.ends = []time.Time{at(10, 30)}

	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	starts, err := svc.OfferedRescheduleStarts(context.Background(), "shop-1", availProfessionalID, 30, at(10, 0), at(10, 30))
	if err != nil {
		t.Fatalf("OfferedRescheduleStarts: %v", err)
	}
	for _, s := range starts {
		if s.Equal(at(10, 0)) {
			t.Fatalf("el bloqueo de 10:00 sigue ocupando: %v", starts)
		}
	}
}
