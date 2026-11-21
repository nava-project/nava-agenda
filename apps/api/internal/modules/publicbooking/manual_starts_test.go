package publicbooking_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/availability"
	"nava-agenda/internal/modules/publicbooking"
)

// Pruebas de ManualStarts (#717) y de la igualdad de la reserva pública tras
// sacar los límites del cálculo a un parámetro (startsWithin).

func manualLoc(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	return loc
}

func clockOf(t *testing.T, starts []time.Time, loc *time.Location) []string {
	t.Helper()
	out := make([]string, 0, len(starts))
	for _, s := range starts {
		out = append(out, s.In(loc).Format("2006-01-02 15:04"))
	}
	return out
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// El primer inicio aceptable es «ahora» truncado al minuto, sobre instantes:
// un inicio igual a ese minuto entra y uno de un minuto antes no.
func TestManualStarts_NowTruncatedToTheMinute_IsTheEarliestStart(t *testing.T) {
	loc := manualLoc(t)
	cases := []struct {
		name      string
		now       time.Time
		wantFirst string
	}{
		{"a las 10:30:45 entra el inicio de las 10:30", time.Date(2026, 9, 14, 10, 30, 45, 0, loc), "2026-09-14 10:30"},
		{"a las 10:31:00 el de las 10:30 ya no entra", time.Date(2026, 9, 14, 10, 31, 0, 0, loc), "2026-09-14 11:00"},
		{"a las 10:07 el primero es el siguiente de la rejilla", time.Date(2026, 9, 14, 10, 7, 30, 0, loc), "2026-09-14 10:30"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(tc.now)
			svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: tc.now.UTC()})

			starts, tz, grid, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-14", time.Time{}, time.Time{})
			if err != nil {
				t.Fatalf("ManualStarts: %v", err)
			}
			if tz != "America/Bogota" || grid != 30 {
				t.Fatalf("contexto = %q/%d", tz, grid)
			}
			got := clockOf(t, starts, loc)
			if len(got) == 0 || got[0] != tc.wantFirst {
				t.Fatalf("primer inicio = %v, want %s", got, tc.wantFirst)
			}
		})
	}
}

// La cita manual está exenta de la anticipación mínima y de la ventana máxima
// (RN-DIS-04): un día fuera de la ventana pública y la hora de ahora mismo
// aparecen igual.
func TestManualStarts_IgnoresMinimumAdvanceAndMaximumWindow(t *testing.T) {
	loc := manualLoc(t)
	now := time.Date(2026, 9, 14, 9, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	policy.minAdvanceMinutes = 240
	policy.maxAdvanceDays = 1
	effectiveDay.byDate["2026-09-20"] = fakeDayResult{isWorking: true, starts: []string{"14:00"}, durations: []int{60}}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	starts, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-20", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("ManualStarts: %v", err)
	}
	got := clockOf(t, starts, loc)
	for _, want := range []string{"2026-09-14 09:00", "2026-09-20 14:00", "2026-09-20 14:30"} {
		if !contains(got, want) {
			t.Fatalf("falta %s en %v", want, got)
		}
	}
}

// Solo el tramo pedido: ni el día anterior ni el siguiente, y un tramo ya
// pasado entero no ofrece nada.
func TestManualStarts_OnlyTheRequestedDates(t *testing.T) {
	loc := manualLoc(t)
	now := time.Date(2026, 9, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	for _, d := range []string{"2026-09-15", "2026-09-16", "2026-09-17"} {
		effectiveDay.byDate[d] = fakeDayResult{isWorking: true, starts: []string{"09:00"}, durations: []int{60}}
	}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	starts, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-16", "2026-09-16", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("ManualStarts: %v", err)
	}
	if got := clockOf(t, starts, loc); len(got) != 2 || got[0] != "2026-09-16 09:00" || got[1] != "2026-09-16 09:30" {
		t.Fatalf("inicios = %v, want solo los del 16", got)
	}

	past, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-10", "2026-09-13", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("ManualStarts pasado: %v", err)
	}
	if len(past) != 0 {
		t.Fatalf("un tramo pasado no ofrece inicios, got %v", clockOf(t, past, loc))
	}
}

// Bloqueos y citas que ocupan agenda se restan igual que en la pública.
func TestManualStarts_SubtractsBlocksAndAppointments(t *testing.T) {
	loc := manualLoc(t)
	now := time.Date(2026, 9, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	blocks.starts = []time.Time{time.Date(2026, 9, 14, 9, 0, 0, 0, loc)}
	blocks.ends = []time.Time{time.Date(2026, 9, 14, 10, 0, 0, 0, loc)}
	repo.occStarts = []time.Time{time.Date(2026, 9, 14, 11, 0, 0, 0, loc)}
	repo.occEnds = []time.Time{time.Date(2026, 9, 14, 11, 30, 0, 0, loc)}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	_, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "", time.Time{}, time.Time{})
	if err == nil {
		t.Fatal("toDate vacío llega validado desde booking; aquí debe fallar como error interno")
	}
	starts, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-14", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("ManualStarts: %v", err)
	}
	got := clockOf(t, starts, loc)
	for _, absent := range []string{"2026-09-14 09:00", "2026-09-14 09:30", "2026-09-14 11:00"} {
		if contains(got, absent) {
			t.Fatalf("%s debía quedar ocupado: %v", absent, got)
		}
	}
	for _, present := range []string{"2026-09-14 10:00", "2026-09-14 10:30", "2026-09-14 11:30"} {
		if !contains(got, present) {
			t.Fatalf("falta %s: %v", present, got)
		}
	}
}

// Con anticipación 0 y la misma ventana, la reserva pública y el turno manual
// dan exactamente los mismos inicios: una sola fuente de verdad.
func TestManualStarts_MatchesPublicAvailabilityWithZeroAdvance(t *testing.T) {
	loc := manualLoc(t)
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	policy.minAdvanceMinutes = 0
	policy.maxAdvanceDays = 3
	for i, d := range []string{"2026-09-15", "2026-09-16", "2026-09-17"} {
		effectiveDay.byDate[d] = fakeDayResult{isWorking: true, starts: []string{"08:00", "14:00"}, durations: []int{180 + 15*i, 240}}
	}
	blocks.starts = []time.Time{time.Date(2026, 9, 15, 9, 0, 0, 0, loc)}
	blocks.ends = []time.Time{time.Date(2026, 9, 15, 9, 45, 0, 0, loc)}
	repo.occStarts = []time.Time{time.Date(2026, 9, 16, 15, 0, 0, 0, loc)}
	repo.occEnds = []time.Time{time.Date(2026, 9, 16, 16, 0, 0, 0, loc)}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	public, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, availProfessionalID)
	if err != nil {
		t.Fatalf("ListPublicAvailability: %v", err)
	}
	manual, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-17", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("ManualStarts: %v", err)
	}
	// La ventana pública termina en now + 3 días exactos; la manual, al final
	// del día 17. Se compara sobre la ventana pública.
	limit := now.AddDate(0, 0, 3)
	var manualInWindow []time.Time
	for _, s := range manual {
		if !s.After(limit) {
			manualInWindow = append(manualInWindow, s)
		}
	}
	pub := make([]time.Time, 0, len(public.Slots))
	for _, s := range public.Slots {
		pub = append(pub, s.StartsAt)
	}
	if a, b := clockOf(t, pub, loc), clockOf(t, manualInWindow, loc); len(a) == 0 || len(a) != len(b) {
		t.Fatalf("pública %d inicios, manual %d:\npública %v\nmanual  %v", len(a), len(b), a, b)
	} else {
		for i := range a {
			if a[i] != b[i] {
				t.Fatalf("difieren en %d: pública %s, manual %s", i, a[i], b[i])
			}
		}
	}
}

// Igualdad del refactor: la reserva pública da exactamente lo que daba el
// cálculo anterior (los mismos límites derivados de la política, pasados ahora
// como parámetro) con varios días, dos tramos, bloqueos, citas, anticipación y
// ventana. La referencia reproduce el cálculo previo paso a paso.
func TestListPublicAvailability_RefactorKeepsTheSameStarts(t *testing.T) {
	loc := manualLoc(t)
	for _, tc := range []struct {
		name                string
		now                 time.Time
		minAdvance, maxDays int
		grid                int
	}{
		{"mañana con anticipación de 90 min", time.Date(2026, 9, 14, 7, 10, 0, 0, loc), 90, 3, 15},
		{"tarde, ventana de un día", time.Date(2026, 9, 14, 15, 40, 0, 0, loc), 0, 1, 30},
		{"noche, rejilla de 20", time.Date(2026, 9, 14, 21, 0, 0, 0, loc), 60, 4, 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(tc.now)
			policy.minAdvanceMinutes, policy.maxAdvanceDays, policy.slotGridMinutes = tc.minAdvance, tc.maxDays, tc.grid
			days := map[string]fakeDayResult{}
			for i := 0; i <= 5; i++ {
				d := time.Date(2026, 9, 14+i, 0, 0, 0, 0, loc).Format("2006-01-02")
				days[d] = fakeDayResult{isWorking: i != 2, starts: []string{"08:30", "13:00"}, durations: []int{200, 300}}
			}
			effectiveDay.byDate = days
			blocks.starts = []time.Time{time.Date(2026, 9, 15, 10, 0, 0, 0, loc), time.Date(2026, 9, 17, 13, 0, 0, 0, loc)}
			blocks.ends = []time.Time{time.Date(2026, 9, 15, 11, 10, 0, 0, loc), time.Date(2026, 9, 17, 14, 0, 0, 0, loc)}
			repo.occStarts = []time.Time{time.Date(2026, 9, 14, 16, 0, 0, 0, loc), time.Date(2026, 9, 18, 9, 5, 0, 0, loc)}
			repo.occEnds = []time.Time{time.Date(2026, 9, 14, 16, 45, 0, 0, loc), time.Date(2026, 9, 18, 9, 50, 0, 0, loc)}
			svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: tc.now})

			got, err := svc.ListPublicAvailability(context.Background(), "barberia-ejemplo", availServiceID, availProfessionalID)
			if err != nil {
				t.Fatalf("ListPublicAvailability: %v", err)
			}

			// Referencia: el cálculo previo al refactor, con los mismos datos.
			earliest := tc.now.Add(time.Duration(tc.minAdvance) * time.Minute)
			latest := tc.now.AddDate(0, 0, tc.maxDays)
			from := time.Date(tc.now.In(loc).Year(), tc.now.In(loc).Month(), tc.now.In(loc).Day(), 0, 0, 0, 0, loc)
			to := time.Date(latest.In(loc).Year(), latest.In(loc).Month(), latest.In(loc).Day(), 0, 0, 0, 0, loc)
			var segments []availability.Interval
			for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
				day := days[d.Format("2006-01-02")]
				if !day.isWorking {
					continue
				}
				for i, st := range day.starts {
					s, _ := time.ParseInLocation("2006-01-02 15:04", d.Format("2006-01-02")+" "+st, loc)
					segments = append(segments, availability.Interval{Start: s, End: s.Add(time.Duration(day.durations[i]) * time.Minute)})
				}
			}
			var busy []availability.Interval
			for i := range blocks.starts {
				busy = append(busy, availability.Interval{Start: blocks.starts[i], End: blocks.ends[i]})
			}
			for i := range repo.occStarts {
				busy = append(busy, availability.Interval{Start: repo.occStarts[i], End: repo.occEnds[i]})
			}
			want := availability.GenerateStarts(segments, busy, availability.Policy{
				ServiceDuration: 30 * time.Minute,
				GridStep:        time.Duration(tc.grid) * time.Minute,
				EarliestStart:   earliest,
				LatestStart:     latest,
			})

			if len(want) == 0 || len(got.Slots) != len(want) {
				t.Fatalf("got %d inicios, want %d", len(got.Slots), len(want))
			}
			for i := range want {
				if !got.Slots[i].StartsAt.Equal(want[i]) {
					t.Fatalf("inicio %d = %v, want %v", i, got.Slots[i].StartsAt, want[i])
				}
			}
		})
	}
}

// #776: el intervalo excluido (el turno que se reprograma) sale de la ocupación
// y su misma hora vuelve; otra cita del mismo profesional sigue ocupando, y un
// bloqueo con el mismo intervalo no se libera por coincidir.
func TestManualStarts_ExcludedOwnAppointment_FreesOnlyItsInterval(t *testing.T) {
	loc := manualLoc(t)
	now := time.Date(2026, 9, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	ownStart := time.Date(2026, 9, 14, 11, 0, 0, 0, loc)
	ownEnd := ownStart.Add(30 * time.Minute)
	otherStart := time.Date(2026, 9, 14, 12, 0, 0, 0, loc)
	repo.occStarts = []time.Time{ownStart, otherStart}
	repo.occEnds = []time.Time{ownEnd, otherStart.Add(30 * time.Minute)}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})

	without, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-14", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("ManualStarts sin exclusión: %v", err)
	}
	if contains(clockOf(t, without, loc), "2026-09-14 11:00") {
		t.Fatal("sin exclusión, las 11:00 del propio turno están ocupadas")
	}

	with, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-14", ownStart, ownEnd)
	if err != nil {
		t.Fatalf("ManualStarts con exclusión: %v", err)
	}
	got := clockOf(t, with, loc)
	if !contains(got, "2026-09-14 11:00") {
		t.Fatalf("la hora del propio turno debía volver: %v", got)
	}
	if contains(got, "2026-09-14 12:00") {
		t.Fatalf("otra cita no se libera: %v", got)
	}
	if len(with) != len(without)+1 {
		t.Fatalf("solo debía volver un inicio: sin %d, con %d", len(without), len(with))
	}

	// Un bloqueo idéntico al turno sigue contando: excluir el turno no lo borra.
	blocks.starts = []time.Time{ownStart}
	blocks.ends = []time.Time{ownEnd}
	blocked, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-14", ownStart, ownEnd)
	if err != nil {
		t.Fatalf("ManualStarts con bloqueo: %v", err)
	}
	if contains(clockOf(t, blocked, loc), "2026-09-14 11:00") {
		t.Fatal("un bloqueo con el mismo intervalo debía seguir ocupando las 11:00")
	}
}

// #776: un turno propio que ya empezó no hace aparecer su hora pasada; el
// primer inicio sigue siendo «ahora» truncado al minuto.
func TestManualStarts_ExcludedOwnAppointmentInThePast_OffersNoPastStart(t *testing.T) {
	loc := manualLoc(t)
	now := time.Date(2026, 9, 14, 11, 10, 20, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	ownStart := time.Date(2026, 9, 14, 11, 0, 0, 0, loc)
	repo.occStarts = []time.Time{ownStart}
	repo.occEnds = []time.Time{ownStart.Add(30 * time.Minute)}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now.UTC()})

	starts, _, _, err := svc.ManualStarts(context.Background(), "shop-1", availProfessionalID, 30, "2026-09-14", "2026-09-14", ownStart, ownStart.Add(30*time.Minute))
	if err != nil {
		t.Fatalf("ManualStarts: %v", err)
	}
	for _, s := range starts {
		if s.Before(now.Truncate(time.Minute)) {
			t.Fatalf("inicio en el pasado: %s", s.In(loc).Format("15:04"))
		}
	}
	if contains(clockOf(t, starts, loc), "2026-09-14 11:00") {
		t.Fatal("la hora pasada del propio turno no se ofrece")
	}
}
