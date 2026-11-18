// Pruebas del agregado de disponibilidad por servicio (DEC-162) EN
// AISLAMIENTO, sin PostgreSQL real: cubren la resolución de slug/forma de
// serviceId, la orquestación por profesional elegible, el orden (startsAt,
// professionalId) y, sobre todo, la equivalencia con ListPublicAvailability: el
// agregado no puede divergir de la ruta por profesional porque comparten
// computeAvailableStarts. La consulta real de profesionales elegibles con dos
// tenants se prueba en postgres/availability_repository_test.go.
package publicbooking_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/platform/apperr"
)

const (
	aggProfessionalA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	aggProfessionalB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	aggProfessionalC = "cccccccc-cccc-cccc-cccc-cccccccccccc"
)

// perProfessionalEffectiveDay devuelve una jornada distinta según el profesional, para
// comprobar que el agregado consulta a cada uno con sus propios datos.
type perProfessionalEffectiveDay struct {
	byProfessional map[string]fakeDayResult
}

func (f *perProfessionalEffectiveDay) ResolveEffectiveDay(_ context.Context, _, professionalID, _ string) (bool, []string, []int, error) {
	d, ok := f.byProfessional[professionalID]
	if !ok {
		return false, nil, nil, nil
	}
	return d.isWorking, d.starts, d.durations, nil
}

// perProfessionalAssignments marca como asignados solo a los profesionales listados.
type perProfessionalAssignments struct {
	assigned map[string]bool
	duration int
	err      error
	calls    []string
}

func (f *perProfessionalAssignments) ActiveAssignedService(_ context.Context, _, professionalID, _ string) (string, int, int64, string, bool, error) {
	f.calls = append(f.calls, professionalID)
	return "Corte clásico", f.duration, 0, "COP", f.assigned[professionalID], f.err
}

// perProfessionalOccupancyRepo ocupa agenda solo para los profesionales con entrada.
type perProfessionalOccupancyRepo struct {
	*fakeAvailabilityRepository
	occupied map[string][2][]time.Time
}

func (f *perProfessionalOccupancyRepo) ListOccupiedIntervals(_ context.Context, _, professionalID string, _, _ time.Time) ([]time.Time, []time.Time, error) {
	o := f.occupied[professionalID]
	return o[0], o[1], nil
}

func newAggregateService(t *testing.T, professionalIDs []string, assigned map[string]bool, days map[string]fakeDayResult) (*publicbooking.AvailabilityService, *perProfessionalAssignments, *perProfessionalOccupancyRepo, time.Time) {
	t.Helper()
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo := &perProfessionalOccupancyRepo{
		fakeAvailabilityRepository: &fakeAvailabilityRepository{businessID: "shop-1", found: true, serviceProfessionalIDs: professionalIDs},
		occupied:                   map[string][2][]time.Time{},
	}
	assignments := &perProfessionalAssignments{assigned: assigned, duration: 30}
	svc := publicbooking.NewAvailabilityService(
		repo,
		&perProfessionalEffectiveDay{byProfessional: days},
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

// TestListPublicServiceAvailability_MatchesPerProfessionalEndpoint es la prueba de
// no divergencia: para cada profesional, sus franjas dentro del agregado son
// EXACTAMENTE las que devuelve ListPublicAvailability, incluso cuando uno
// tiene una cita y otro no.
func TestListPublicServiceAvailability_MatchesPerProfessionalEndpoint(t *testing.T) {
	days := map[string]fakeDayResult{aggProfessionalA: fullDay(), aggProfessionalB: fullDay()}
	svc, _, repo, now := newAggregateService(t,
		[]string{aggProfessionalB, aggProfessionalA},
		map[string]bool{aggProfessionalA: true, aggProfessionalB: true}, days)
	loc := now.Location()
	// B tiene una cita 9:00-9:30: pierde su primera franja y A no.
	repo.occupied[aggProfessionalB] = [2][]time.Time{
		{time.Date(2026, time.September, 14, 9, 0, 0, 0, loc)},
		{time.Date(2026, time.September, 14, 9, 30, 0, 0, loc)},
	}

	agg, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	for _, professionalID := range []string{aggProfessionalA, aggProfessionalB} {
		single, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, professionalID)
		if err != nil {
			t.Fatalf("ListPublicAvailability(%s): %v", professionalID, err)
		}
		var fromAggregate []time.Time
		for _, s := range agg.Slots {
			if s.ProfessionalID == professionalID {
				fromAggregate = append(fromAggregate, s.StartsAt)
			}
		}
		if len(fromAggregate) != len(single.Slots) {
			t.Fatalf("profesional %s: agregado %d franjas, por profesional %d", professionalID, len(fromAggregate), len(single.Slots))
		}
		for i := range fromAggregate {
			if !fromAggregate[i].Equal(single.Slots[i].StartsAt) {
				t.Fatalf("profesional %s franja %d: %v != %v", professionalID, i, fromAggregate[i], single.Slots[i].StartsAt)
			}
		}
		if agg.DurationMinutes != single.DurationMinutes || agg.Timezone != single.Timezone || agg.SlotGridMinutes != single.SlotGridMinutes {
			t.Fatalf("contexto distinto: agregado %+v, por profesional %+v", agg, single)
		}
	}
	// A: 9:00 y 9:30; B (cita 9:00-9:30): solo 9:30.
	if len(agg.Slots) != 3 {
		t.Fatalf("esperaba 3 franjas en total, got %+v", agg.Slots)
	}
}

func TestListPublicServiceAvailability_OrdersByStartsAtThenProfessionalID(t *testing.T) {
	days := map[string]fakeDayResult{aggProfessionalA: fullDay(), aggProfessionalB: fullDay(), aggProfessionalC: fullDay()}
	// El repositorio entrega los profesionales en desorden a propósito.
	svc, _, _, _ := newAggregateService(t,
		[]string{aggProfessionalC, aggProfessionalA, aggProfessionalB},
		map[string]bool{aggProfessionalA: true, aggProfessionalB: true, aggProfessionalC: true}, days)

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	want := []string{aggProfessionalA, aggProfessionalB, aggProfessionalC, aggProfessionalA, aggProfessionalB, aggProfessionalC}
	if len(got.Slots) != len(want) {
		t.Fatalf("esperaba %d franjas, got %+v", len(want), got.Slots)
	}
	for i, s := range got.Slots {
		if s.ProfessionalID != want[i] {
			t.Fatalf("índice %d: profesional %s, want %s (orden (startsAt, professionalId))", i, s.ProfessionalID, want[i])
		}
		if i > 0 && s.StartsAt.Before(got.Slots[i-1].StartsAt) {
			t.Fatalf("startsAt decrece en índice %d", i)
		}
	}
}

func TestListPublicServiceAvailability_SkipsProfessionalWithoutActiveAssignment(t *testing.T) {
	days := map[string]fakeDayResult{aggProfessionalA: fullDay(), aggProfessionalB: fullDay()}
	svc, assignments, _, _ := newAggregateService(t,
		[]string{aggProfessionalA, aggProfessionalB},
		map[string]bool{aggProfessionalA: true, aggProfessionalB: false}, days)

	got, err := svc.ListPublicServiceAvailability(context.Background(), "barberia-ejemplo", availServiceID)
	if err != nil {
		t.Fatalf("ListPublicServiceAvailability: %v", err)
	}
	for _, s := range got.Slots {
		if s.ProfessionalID == aggProfessionalB {
			t.Fatalf("un profesional sin asignación vigente no debe aportar franjas: %+v", s)
		}
	}
	if len(got.Slots) == 0 {
		t.Fatal("el profesional asignado debe aportar franjas")
	}
	if len(assignments.calls) != 2 {
		t.Fatalf("cada candidato se verifica con ActiveAssignedService, got %v", assignments.calls)
	}
}

func TestListPublicServiceAvailability_EligibleProfessionalWithoutSlots_KeepsContext(t *testing.T) {
	// Jornada no laborable: elegible pero sin franjas hoy. El contexto
	// (duración, zona, rejilla) sigue presente, igual que en el endpoint por
	// profesional ("sin franjas hoy").
	svc, _, _, _ := newAggregateService(t, []string{aggProfessionalA},
		map[string]bool{aggProfessionalA: true}, map[string]fakeDayResult{aggProfessionalA: {isWorking: false}})

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

func TestListPublicServiceAvailability_NoEligibleProfessionals_ReturnsUniformEmpty(t *testing.T) {
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
	svc, _, repo, _ := newAggregateService(t, []string{aggProfessionalA}, map[string]bool{aggProfessionalA: true}, nil)
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
	svc, assignments, _, _ := newAggregateService(t, []string{aggProfessionalA}, map[string]bool{aggProfessionalA: true}, map[string]fakeDayResult{aggProfessionalA: fullDay()})

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
	tests := map[string]func(*perProfessionalAssignments, *perProfessionalOccupancyRepo){
		"candidatos": func(_ *perProfessionalAssignments, r *perProfessionalOccupancyRepo) { r.serviceProfessionalErr = boom },
		"asignación": func(a *perProfessionalAssignments, _ *perProfessionalOccupancyRepo) { a.err = boom },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			svc, assignments, repo, _ := newAggregateService(t, []string{aggProfessionalA}, map[string]bool{aggProfessionalA: true}, map[string]fakeDayResult{aggProfessionalA: fullDay()})
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
	svc, _, _, _ := newAggregateService(t, []string{aggProfessionalA}, map[string]bool{aggProfessionalA: true}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := svc.ListPublicServiceAvailability(ctx, "barberia-ejemplo", availServiceID)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("esperaba apperr.KindInternal, got %v", err)
	}
}
