// Caso CP-007 del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III):
// horario semanal por barbero. Fixture del plan: barberos B1 y B2 de la
// Barbería Alfa; B1 atiende el lunes de 09:00 a 18:00 y no atiende el domingo.
// La etapa «Pruebas unitarias · Plan de Pruebas (CP)» del Jenkinsfile corre todo
// lo que empieza por TestCP.
package schedule_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/schedule"
	"nava-agenda/internal/platform/idempotency"
)

func TestCP007_HorarioSemanalPorBarbero(t *testing.T) {
	bogota, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	// 2026-09-14 es lunes y 2026-09-20 domingo; ninguno es festivo.
	at := func(day, hour, minute int) time.Time {
		return time.Date(2026, time.September, day, hour, minute, 0, 0, bogota)
	}
	lunesB1 := []schedule.WorkingHour{{StartsTime: "09:00", DurationMinutes: 540}}
	lunesB2 := []schedule.WorkingHour{{StartsTime: "13:00", DurationMinutes: 300}}

	within := func(t *testing.T, weekly []schedule.WorkingHour, start time.Time) bool {
		t.Helper()
		adapter := schedule.NewManualBookingBlocks(schedule.NewService(newResolveRepo(t, nil, false, weekly), fakeProfessionalPort{}))
		got, err := adapter.WithinWorkingHours(context.Background(), "barberia-alfa", validProfessionalID, start, start.Add(30*time.Minute), "America/Bogota")
		if err != nil {
			t.Fatalf("WithinWorkingHours: %v", err)
		}
		return got
	}

	t.Run("CP-007 el lunes de B1 solo admite horas dentro de 09:00–18:00", func(t *testing.T) {
		if !within(t, lunesB1, at(14, 9, 0)) || !within(t, lunesB1, at(14, 17, 30)) {
			t.Error("09:00 y 17:30 están dentro de la jornada de B1 y no se admitieron")
		}
		if within(t, lunesB1, at(14, 8, 30)) || within(t, lunesB1, at(14, 18, 0)) {
			t.Error("08:30 y 18:00 están fuera de la jornada de B1 y se admitieron")
		}
	})

	t.Run("CP-007 el domingo cerrado no admite ninguna hora", func(t *testing.T) {
		for _, hour := range []int{9, 12, 17} {
			if within(t, nil, at(20, hour, 0)) {
				t.Errorf("el domingo sin jornada admitió las %02d:00", hour)
			}
		}
	})

	t.Run("CP-007 otro barbero tiene su propia jornada", func(t *testing.T) {
		if within(t, lunesB2, at(14, 10, 0)) {
			t.Error("las 10:00 están fuera de la jornada de B2 (13:00–18:00) y se admitieron")
		}
		if !within(t, lunesB2, at(14, 13, 0)) {
			t.Error("las 13:00 están dentro de la jornada de B2 y no se admitieron")
		}
	})

	t.Run("CP-007 un rango invertido o vacío no se guarda", func(t *testing.T) {
		repo := &fakeRepository{createFn: failCreateIfCalled(t)}
		svc := schedule.NewService(repo, fakeProfessionalPort{exists: true})
		// La jornada se guarda como inicio + duración: 18:00 → 09:00 es una
		// duración negativa, y 09:00 → 09:00 una vacía.
		for _, duration := range []int{-540, 0} {
			_, err := svc.Create(context.Background(), "barberia-alfa", validProfessionalID, 1, "18:00", duration, "cp007-k", "cp007-f")
			mustBeValidation(t, err)
		}
		if repo.createCalls != 0 {
			t.Fatalf("se llamó al repositorio %d veces con un rango inválido", repo.createCalls)
		}
	})

	t.Run("CP-007 el lunes 09:00–18:00 se guarda tal cual", func(t *testing.T) {
		repo := &fakeRepository{createFn: func(_ context.Context, _, _ string, input schedule.CreateInput, _ idempotency.Key, _ idempotency.Fingerprint) (schedule.CreateResult, error) {
			if input.ISOWeekday != 1 || input.StartsTime != "09:00" || input.DurationMinutes != 540 {
				t.Fatalf("entrada inesperada: %+v", input)
			}
			return schedule.CreateResult{Decision: idempotency.Decision{Outcome: idempotency.OutcomeProceed}}, nil
		}}
		if _, err := schedule.NewService(repo, fakeProfessionalPort{exists: true}).Create(context.Background(), "barberia-alfa", validProfessionalID, 1, "09:00", 540, "cp007-k2", "cp007-f2"); err != nil {
			t.Fatalf("Create: %v", err)
		}
	})
}
