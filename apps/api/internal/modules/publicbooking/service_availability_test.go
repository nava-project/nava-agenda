// Pruebas del agregado de disponibilidad por servicio (DEC-162) EN
// AISLAMIENTO, sin PostgreSQL real: cubren la resolución de slug/forma de
// serviceId, la orquestación por barbero elegible, el orden (startsAt,
// barberId) y, sobre todo, la equivalencia con ListPublicAvailability: el
// agregado no puede divergir de la ruta por barbero porque comparten
// computeAvailableStarts. La consulta real de barberos elegibles con dos
// tenants se prueba en postgres/availability_repository_test.go.
package publicbooking_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"system-barbershop/internal/modules/publicbooking"
	"system-barbershop/internal/platform/apperr"
)

const (
	aggBarberA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	aggBarberB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	aggBarberC = "cccccccc-cccc-cccc-cccc-cccccccccccc"
)

// perBarberEffectiveDay devuelve una jornada distinta según el barbero, para
// comprobar que el agregado consulta a cada uno con sus propios datos.
type perBarberEffectiveDay struct {
	byBarber map[string]fakeDayResult
}

func (f *perBarberEffectiveDay) ResolveEffectiveDay(_ context.Context, _, barberID, _ string) (bool, []string, []int, error) {
	d, ok := f.byBarber[barberID]
	if !ok {
		return false, nil, nil, nil
	}
	return d.isWorking, d.starts, d.durations, nil
}

// perBarberAssignments marca como asignados solo a los barberos listados.
type perBarberAssignments struct {
	assigned map[string]bool
	duration int
	err      error
	calls    []string
}

func (f *perBarberAssignments) ActiveAssignedService(_ context.Context, _, barberID, _ string) (string, int, int64, string, bool, error) {
	f.calls = append(f.calls, barberID)
	return "Corte clásico", f.duration, 0, "COP", f.assigned[barberID], f.err
}

// perBarberOccupancyRepo ocupa agenda solo para los barberos con entrada.
type perBarberOccupancyRepo struct {
	*fakeAvailabilityRepository
	occupied map[string][2][]time.Time
}

func (f *perBarberOccupancyRepo) ListOccupiedIntervals(_ context.Context, _, barberID string, _, _ time.Time) ([]time.Time, []time.Time, error) {
	o := f.occupied[barberID]
	return o[0], o[1], nil
}

func newAggregateService(t *testing.T, barberIDs []string, assigned map[string]bool, days map[string]fakeDayResult) (*publicbooking.AvailabilityService, *perBarberAssignments, *perBarberOccupancyRepo, time.Time) {
	t.Helper()
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo := &perBarberOccupancyRepo{
		fakeAvailabilityRepository: &fakeAvailabilityRepository{barbershopID: "shop-1", found: true, serviceBarberIDs: barberIDs},
		occupied:                   map[string][2][]time.Time{},
	}
	assignments := &perBarberAssignments{assigned: assigned, duration: 30}
	svc := publicbooking.NewAvailabilityService(
		repo,
		&perBarberEffectiveDay{byBarber: days},
		&fakeBusyBlocks{},
		&fakeBookingPolicy{minAdvanceMinutes: 0, maxAdvanceDays: 1, slotGridMinutes: 30},
		assignments,
		&fakeAvailabilityTimezone{timezone: "America/Bogota"},
		fixedAvailabilityClock{now: now},
	)
	return svc, assignments, repo, now
}

func fullDay() fakeDayResult {
	return fakeDayResult{isWorking: true, starts: []string{"09:00"}, durations: []int{60}} // 9:00-10:00
}

// TestListPublicServiceAvailability_MatchesPerBarberEndpoint es la prueba de
// no divergencia: para cada barbero, sus franjas dentro del agregado son
// EXACTAMENTE las que devuelve ListPublicAvailability, incluso cuando uno
// tiene una cita y otro no.
func TestListPublicServiceAvailability_MatchesPerBarberEndpoint(t *testing.T) {
	days := map[string]fakeDayResult{aggBarberA: fullDay(), aggBarberB: fullDay()}
	svc, _, repo, now := newAggregateService(t,
		[]string{aggBarberB, aggBarberA},
		map[string]bool{aggBarberA: true, aggBarberB: true}, days)
	loc := now.Location()
	// B tiene una cita 9:00-9:30: pierde su primera franja y A no.
	repo.occupied[aggBarberB] = [2][]time.Time{
		{time.Date(2026, time.September, 14, 9, 0, 0, 0, loc)},
		{time.Date(2026, time.September, 14, 9, 30, 0, 0, loc)},
	}

	agg, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	for _, barberID := range []string{aggBarberA, aggBarberB} {
		single, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, barberID)
		if err != nil {
			t.Fatalf("ListPublicAvailability(%s): %v", barberID, err)
		}
		var fromAggregate []time.Time
		for _, s := range agg.Slots {
			if s.BarberID == barberID {
				fromAggregate = append(fromAggregate, s.StartsAt)
			}
		}
		if len(fromAggregate) != len(single.Slots) {
			t.Fatalf("barbero %s: agregado %d franjas, por barbero %d", barberID, len(fromAggregate), len(single.Slots))
		}
		for i := range fromAggregate {
			if !fromAggregate[i].Equal(single.Slots[i].StartsAt) {
				t.Fatalf("barbero %s franja %d: %v != %v", barberID, i, fromAggregate[i], single.Slots[i].StartsAt)
			}
		}
		if agg.DurationMinutes != single.DurationMinutes || agg.Timezone != single.Timezone || agg.SlotGridMinutes != single.SlotGridMinutes {
			t.Fatalf("contexto distinto: agregado %+v, por barbero %+v", agg, single)
		}
	}
	// A: 9:00 y 9:30; B (cita 9:00-9:30): solo 9:30.
	if len(agg.Slots) != 3 {
		t.Fatalf("esperaba 3 franjas en total, got %+v", agg.Slots)
	}
}

func TestListPublicServiceAvailability_OrdersByStartsAtThenBarberID(t *testing.T) {
	days := map[string]fakeDayResult{aggBarberA: fullDay(), aggBarberB: fullDay(), aggBarberC: fullDay()}
	// El repositorio entrega los barberos en desorden a propósito.
	svc, _, _, _ := newAggregateService(t,
		[]string{aggBarberC, aggBarberA, aggBarberB},
		map[string]bool{aggBarberA: true, aggBarberB: true, aggBarberC: true}, days)

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	want := []string{aggBarberA, aggBarberB, aggBarberC, aggBarberA, aggBarberB, aggBarberC}
	if len(got.Slots) != len(want) {
		t.Fatalf("esperaba %d franjas, got %+v", len(want), got.Slots)
	}
	for i, s := range got.Slots {
		if s.BarberID != want[i] {
			t.Fatalf("índice %d: barbero %s, want %s (orden (startsAt, barberId))", i, s.BarberID, want[i])
		}
		if i > 0 && s.StartsAt.Before(got.Slots[i-1].StartsAt) {
			t.Fatalf("startsAt decrece en índice %d", i)
		}
	}
}

func TestListPublicServiceAvailability_SkipsBarberWithoutActiveAssignment(t *testing.T) {
	days := map[string]fakeDayResult{aggBarberA: fullDay(), aggBarberB: fullDay()}
	svc, assignments, _, _ := newAggregateService(t,
		[]string{aggBarberA, aggBarberB},
		map[string]bool{aggBarberA: true, aggBarberB: false}, days)

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	for _, s := range got.Slots {
		if s.BarberID == aggBarberB {
			t.Fatalf("un barbero sin asignación vigente no debe aportar franjas: %+v", s)
		}
	}
	if len(got.Slots) == 0 {
		t.Fatal("el barbero asignado debe aportar franjas")
	}
	if len(assignments.calls) != 2 {
		t.Fatalf("cada candidato se verifica con ActiveAssignedService, got %v", assignments.calls)
	}
}

func TestListPublicServiceAvailability_EligibleBarberWithoutSlots_KeepsContext(t *testing.T) {
	// Jornada no laborable: elegible pero sin franjas hoy. El contexto
	// (duración, zona, rejilla) sigue presente, igual que en el endpoint por
	// barbero ("sin franjas hoy").
	svc, _, _, _ := newAggregateService(t, []string{aggBarberA},
		map[string]bool{aggBarberA: true}, map[string]fakeDayResult{aggBarberA: {isWorking: false}})

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	if got.Slots == nil || len(got.Slots) != 0 {
		t.Fatalf("slots debe ser un arreglo vacío no nulo, got %#v", got.Slots)
	}
	if got.DurationMinutes != 30 || got.Timezone != "America/Bogota" || got.SlotGridMinutes != 30 {
		t.Fatalf("contexto inesperado: %+v", got)
	}
}

func TestListPublicServiceAvailability_NoEligibleBarbers_ReturnsUniformEmpty(t *testing.T) {
	svc, assignments, _, _ := newAggregateService(t, nil, nil, nil)

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	if got.Slots == nil || len(got.Slots) != 0 || got.DurationMinutes != 0 || got.Timezone != "" || got.SlotGridMinutes != 0 {
		t.Fatalf("esperaba la respuesta vacía uniforme, got %#v", got)
	}
	if len(assignments.calls) != 0 {
		t.Fatalf("sin candidatos no se verifica nada, got %v", assignments.calls)
	}
}

func TestListPublicServiceAvailability_UnknownOrInvalidSlug_ReturnsUniformNotFound(t *testing.T) {
	svc, _, repo, _ := newAggregateService(t, []string{aggBarberA}, map[string]bool{aggBarberA: true}, nil)
	repo.found = false

	for name, slug := range map[string]string{
		"desconocido": "no-existe",
		"vacío":       " ",
		"largo":       strings.Repeat("a", publicbooking.MaxSlugLength+1),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.ListPublicServiceAvailability(context.Background(), slug, availServiceID)
			appErr, ok := apperr.As(err)
			if !ok || appErr.Kind != apperr.KindNotFound {
				t.Fatalf("esperaba apperr.KindNotFound, got %v", err)
			}
		})
	}
}

func TestListPublicServiceAvailability_MalformedServiceID_ReturnsEmptyNotError(t *testing.T) {
	svc, assignments, _, _ := newAggregateService(t, []string{aggBarberA}, map[string]bool{aggBarberA: true}, map[string]fakeDayResult{aggBarberA: fullDay()})

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", "no-es-uuid")
	if err != nil {
		t.Fatalf("esperaba nil, got %v", err)
	}
	if len(got.Slots) != 0 || got.DurationMinutes != 0 {
		t.Fatalf("esperaba vacío, got %+v", got)
	}
	if len(assignments.calls) != 0 {
		t.Fatal("un serviceId inválido no debe llegar a los puertos")
	}
}

func TestListPublicServiceAvailability_PortErrors_AreInternal(t *testing.T) {
	boom := errors.New("boom")
	tests := map[string]func(*perBarberAssignments, *perBarberOccupancyRepo){
		"candidatos": func(_ *perBarberAssignments, r *perBarberOccupancyRepo) { r.serviceBarberErr = boom },
		"asignación": func(a *perBarberAssignments, _ *perBarberOccupancyRepo) { a.err = boom },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			svc, assignments, repo, _ := newAggregateService(t, []string{aggBarberA}, map[string]bool{aggBarberA: true}, map[string]fakeDayResult{aggBarberA: fullDay()})
			mutate(assignments, repo)
			_, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
			appErr, ok := apperr.As(err)
			if !ok || appErr.Kind != apperr.KindInternal {
				t.Fatalf("esperaba apperr.KindInternal, got %v", err)
			}
		})
	}
}

func TestListPublicServiceAvailability_CancelledContext_IsInternal(t *testing.T) {
	svc, _, _, _ := newAggregateService(t, []string{aggBarberA}, map[string]bool{aggBarberA: true}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := svc.ListPublicServiceAvailability(ctx, "barberia-ejemplo", availServiceID)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("esperaba apperr.KindInternal, got %v", err)
	}
}
