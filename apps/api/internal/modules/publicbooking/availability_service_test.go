// Pruebas del caso de uso EN AISLAMIENTO, sin PostgreSQL real: cubren
// resolución de slug/forma de serviceId-professionalId, orquestación de los
// cinco puertos y traducción a AvailabilityResult. El algoritmo de
// generación de franjas en sí (fusión, resta, rejilla, DEC-135) se prueba
// exhaustivamente en internal/modules/availability. La resolución real
// contra PostgreSQL (ResolveBusinessID, ListOccupiedIntervals, dos
// tenants) se prueba en
// internal/modules/publicbooking/postgres/availability_repository_test.go.
package publicbooking_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/platform/apperr"
)

const (
	availServiceID      = "11111111-1111-1111-1111-111111111111"
	availProfessionalID = "22222222-2222-2222-2222-222222222222"
)

type fakeAvailabilityRepository struct {
	businessID string
	found      bool
	resolveErr error

	occStarts, occEnds []time.Time
	occErr             error

	// serviceProfessionalIDs/serviceProfessionalErr alimentan ListServiceProfessionalIDs
	// (agregado de disponibilidad por servicio, DEC-162).
	serviceProfessionalIDs []string
	serviceProfessionalErr error
}

func (f *fakeAvailabilityRepository) ListServiceProfessionalIDs(_ context.Context, _, _ string) ([]string, error) {
	return f.serviceProfessionalIDs, f.serviceProfessionalErr
}

func (f *fakeAvailabilityRepository) ResolveBusinessID(_ context.Context, _ string) (string, bool, error) {
	return f.businessID, f.found, f.resolveErr
}

func (f *fakeAvailabilityRepository) ListOccupiedIntervals(_ context.Context, _, _ string, _, _ time.Time) ([]time.Time, []time.Time, error) {
	return f.occStarts, f.occEnds, f.occErr
}

type fakeEffectiveDay struct {
	// byDate mapea "AAAA-MM-DD" a (isWorking, starts, durations).
	byDate map[string]fakeDayResult
	err    error
}

type fakeDayResult struct {
	isWorking bool
	starts    []string
	durations []int
}

func (f *fakeEffectiveDay) ResolveEffectiveDay(_ context.Context, _, _, dateCivil string) (bool, []string, []int, error) {
	if f.err != nil {
		return false, nil, nil, f.err
	}
	d, ok := f.byDate[dateCivil]
	if !ok {
		return false, nil, nil, nil
	}
	return d.isWorking, d.starts, d.durations, nil
}

type fakeBusyBlocks struct {
	starts, ends []time.Time
	err          error
}

func (f *fakeBusyBlocks) BusyIntervals(_ context.Context, _, _, _, _, _ string) ([]time.Time, []time.Time, error) {
	return f.starts, f.ends, f.err
}

type fakeBookingPolicy struct {
	minAdvanceMinutes, maxAdvanceDays, slotGridMinutes int
	// perProfessional simula la configuración propia de un profesional (DEC-169):
	// {minAdvanceMinutes, maxAdvanceDays, slotGridMinutes}.
	perProfessional map[string][3]int
	err             error
}

func (f *fakeBookingPolicy) BookingPolicy(_ context.Context, _, professionalID string) (int, int, int, error) {
	if override, ok := f.perProfessional[professionalID]; ok {
		return override[0], override[1], override[2], f.err
	}
	return f.minAdvanceMinutes, f.maxAdvanceDays, f.slotGridMinutes, f.err
}

type fakeServiceAssignment struct {
	durationMinutes int
	found           bool
	err             error
}

func (f *fakeServiceAssignment) ActiveAssignedService(_ context.Context, _, _, _ string) (string, int, int64, string, bool, error) {
	return "Corte clásico", f.durationMinutes, 0, "COP", f.found, f.err
}

type fakeAvailabilityTimezone struct {
	timezone string
	err      error
}

func (f *fakeAvailabilityTimezone) Timezone(_ context.Context, _ string) (string, error) {
	return f.timezone, f.err
}

type fixedAvailabilityClock struct{ now time.Time }

func (c fixedAvailabilityClock) Now() time.Time { return c.now }

// availabilityFixture agrupa los cinco dobles con valores por defecto
// razonables (negocio resuelta, servicio de 30 min asignado, zona
// America/Bogota, política sin restricción real, jornada 9:00-18:00 hoy sin
// ocupaciones) para que cada prueba solo sobreescriba lo que le interesa.
func newAvailabilityFixture(now time.Time) (
	*fakeAvailabilityRepository, *fakeEffectiveDay, *fakeBusyBlocks, *fakeBookingPolicy, *fakeServiceAssignment, *fakeAvailabilityTimezone,
) {
	today := now.Format("2006-01-02")
	return &fakeAvailabilityRepository{businessID: "shop-1", found: true},
		&fakeEffectiveDay{byDate: map[string]fakeDayResult{
			today: {isWorking: true, starts: []string{"09:00"}, durations: []int{540}}, // 9:00-18:00
		}},
		&fakeBusyBlocks{},
		&fakeBookingPolicy{minAdvanceMinutes: 0, maxAdvanceDays: 1, slotGridMinutes: 30},
		&fakeServiceAssignment{durationMinutes: 30, found: true},
		&fakeAvailabilityTimezone{timezone: "America/Bogota"}
}

func TestListPublicAvailability_HappyPath_ReturnsOrderedSlots(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)

	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	got, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, availProfessionalID)
	if err != nil {
		t.Fatalf("ListPublicAvailability: %v", err)
	}
	if got.DurationMinutes != 30 || got.Timezone != "America/Bogota" || got.SlotGridMinutes != 30 {
		t.Fatalf("contexto inesperado: %+v", got)
	}
	if len(got.Slots) == 0 {
		t.Fatal("esperaba al menos una franja")
	}
	first := got.Slots[0].StartsAt
	if !first.Equal(time.Date(2026, time.September, 14, 9, 0, 0, 0, loc)) {
		t.Fatalf("primera franja = %v, want 9:00", first)
	}
	for i := 1; i < len(got.Slots); i++ {
		if !got.Slots[i].StartsAt.After(got.Slots[i-1].StartsAt) {
			t.Fatalf("orden no estrictamente creciente en índice %d: %v", i, got.Slots)
		}
	}
}

func TestListPublicAvailability_UnknownSlug_ReturnsUniformNotFound(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	repo.found = false

	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	_, err := svc.ListPublicAvailability(context.Background(), "no-existe", availServiceID, availProfessionalID)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindNotFound {
		t.Fatalf("expected apperr.KindNotFound, got %v", err)
	}
}

func TestListPublicAvailability_MalformedServiceOrProfessionalID_ReturnsEmptyNotError(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	tests := []struct {
		name           string
		serviceID      string
		professionalID string
	}{
		{"serviceId no es UUID", "not-a-uuid", availProfessionalID},
		{"professionalId no es UUID", availServiceID, "not-a-uuid"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", tc.serviceID, tc.professionalID)
			if err != nil {
				t.Fatalf("esperaba nil, got err=%v", err)
			}
			if len(got.Slots) != 0 {
				t.Fatalf("esperaba slots vacío, got %v", got.Slots)
			}
		})
	}
}

func TestListPublicAvailability_ServiceNotAssigned_ReturnsEmptyNotError(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	assignments.found = false

	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	got, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, availProfessionalID)
	if err != nil {
		t.Fatalf("esperaba nil, got err=%v", err)
	}
	if len(got.Slots) != 0 {
		t.Fatalf("esperaba slots vacío, got %v", got.Slots)
	}
}

func TestListPublicAvailability_BusyBlocksAndAppointments_SubtractBoth(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)

	// Bloqueo 9:00-12:00; cita 12:00-13:00; el primer inicio libre es 13:00.
	blocks.starts = []time.Time{time.Date(2026, time.September, 14, 9, 0, 0, 0, loc)}
	blocks.ends = []time.Time{time.Date(2026, time.September, 14, 12, 0, 0, 0, loc)}
	repo.occStarts = []time.Time{time.Date(2026, time.September, 14, 12, 0, 0, 0, loc)}
	repo.occEnds = []time.Time{time.Date(2026, time.September, 14, 13, 0, 0, 0, loc)}

	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	got, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, availProfessionalID)
	if err != nil {
		t.Fatalf("ListPublicAvailability: %v", err)
	}
	if len(got.Slots) == 0 {
		t.Fatal("esperaba al menos una franja tras el bloqueo y la cita")
	}
	want := time.Date(2026, time.September, 14, 13, 0, 0, 0, loc)
	if !got.Slots[0].StartsAt.Equal(want) {
		t.Fatalf("primera franja = %v, want %v", got.Slots[0].StartsAt, want)
	}
}

func TestListPublicAvailability_NonWorkingDay_ReturnsEmpty(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	today := now.Format("2006-01-02")
	effectiveDay.byDate[today] = fakeDayResult{isWorking: false}

	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	got, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, availProfessionalID)
	if err != nil {
		t.Fatalf("ListPublicAvailability: %v", err)
	}
	if len(got.Slots) != 0 {
		t.Fatalf("esperaba slots vacío en día no laborable, got %v", got.Slots)
	}
}

// DEC-169: la rejilla y la anticipación propias de un profesional rigen sus
// franjas; otro profesional del mismo servicio sigue con la del negocio, y el
// agregado informa la rejilla más fina.
func TestListPublicServiceAvailability_PerProfessionalPolicy_AppliesEachProfessionalsWindow(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)

	const ownProfessional = "33333333-3333-3333-3333-333333333333"
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	repo.serviceProfessionalIDs = []string{availProfessionalID, ownProfessional}
	// Propia: rejilla de 45 y dos horas de anticipación (primera franja 10:00
	// alineada desde las 9:00 → 10:30). El negocio: rejilla de 30, sin
	// anticipación.
	policy.perProfessional = map[string][3]int{ownProfessional: {120, 1, 45}}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	if got.SlotGridMinutes != 30 {
		t.Fatalf("el agregado debe informar la rejilla más fina (30), got %d", got.SlotGridMinutes)
	}

	byProfessional := map[string][]time.Time{}
	for _, s := range got.Slots {
		byProfessional[s.ProfessionalID] = append(byProfessional[s.ProfessionalID], s.StartsAt)
	}
	inherited, own := byProfessional[availProfessionalID], byProfessional[ownProfessional]
	if len(inherited) < 2 || !inherited[0].Equal(time.Date(2026, time.September, 14, 9, 0, 0, 0, loc)) ||
		inherited[1].Sub(inherited[0]) != 30*time.Minute {
		t.Fatalf("el profesional que hereda debe seguir la rejilla de 30 desde las 9:00: %v", inherited)
	}
	if len(own) < 2 || own[0].Before(now.Add(120*time.Minute)) || own[1].Sub(own[0]) != 45*time.Minute {
		t.Fatalf("el profesional con ventana propia debe respetar 120 min de anticipación y rejilla de 45: %v", own)
	}
}
