// Casos del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III) que se
// verifican en el caso de uso de disponibilidad pública y su confirmación:
// CP-020 (anticipación mínima) y CP-021 (horizonte máximo). Usan el fixture del
// plan: Barbería Alfa, reloj fijo a las 09:00 del lunes, jornada 09:00–18:00,
// anticipación de 60 min y horizonte de 30 días. La etapa «Pruebas unitarias ·
// Plan de Pruebas (CP)» del Jenkinsfile corre todo lo que empieza por TestCP.
package publicbooking_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// Valores de la política de prueba del plan. CP-020 los compara con horas
// escritas a mano, así que cambiar cpAnticipacionMinutos (p. ej. a 30) hace
// fallar la prueba: es el cambio que se usa para ver el pipeline en rojo.
const (
	cpAnticipacionMinutos = 60
	cpHorizonteDias       = 30
)

func cpBogota(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatalf("zona America/Bogota: %v", err)
	}
	return loc
}

// cpAlfa arma el caso de uso de disponibilidad de la Barbería Alfa con el
// reloj en now, la jornada 09:00–18:00 en cada fecha de workingDates y la
// política indicada (rejilla de 1 min para poder probar 09:59, 10:00 y 10:01).
func cpAlfa(now time.Time, minAdvance, maxDays int, workingDates ...string) (*publicbooking.AvailabilityService, *fakeBookingPolicy) {
	repo, effectiveDay, blocks, _, assignments, timezones := newAvailabilityFixture(now)
	repo.businessID = "barberia-alfa"
	effectiveDay.byDate = map[string]fakeDayResult{}
	for _, d := range workingDates {
		effectiveDay.byDate[d] = fakeDayResult{isWorking: true, starts: []string{"09:00"}, durations: []int{540}}
	}
	policy := &fakeBookingPolicy{minAdvanceMinutes: minAdvance, maxAdvanceDays: maxDays, slotGridMinutes: 1}
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	return svc, policy
}

func cpOffered(t *testing.T, svc *publicbooking.AvailabilityService) map[time.Time]bool {
	t.Helper()
	got, err := svc.ListPublicAvailability(context.Background(), "barberia-alfa", availServiceID, availProfessionalID)
	if err != nil {
		t.Fatalf("ListPublicAvailability: %v", err)
	}
	offered := make(map[time.Time]bool, len(got.Slots))
	for _, s := range got.Slots {
		offered[s.StartsAt.UTC()] = true
	}
	return offered
}

func TestCP020_AnticipacionMinima(t *testing.T) {
	loc := cpBogota(t)
	now := time.Date(2026, time.September, 14, 9, 0, 0, 0, loc) // lunes, 09:00
	hoy := now.Format("2006-01-02")
	h := func(hour, minute int) time.Time {
		return time.Date(2026, time.September, 14, hour, minute, 0, 0, loc).UTC()
	}

	t.Run("CP-020 con 60 min de anticipación, 09:59 no se ofrece y 10:00 y 10:01 sí", func(t *testing.T) {
		svc, _ := cpAlfa(now, cpAnticipacionMinutos, cpHorizonteDias, hoy)
		offered := cpOffered(t, svc)
		if offered[h(9, 59)] {
			t.Errorf("09:59 está antes del mínimo de 60 min y se ofreció")
		}
		if !offered[h(10, 0)] {
			t.Errorf("10:00 es exactamente el mínimo (límite inclusivo) y no se ofreció")
		}
		if !offered[h(10, 1)] {
			t.Errorf("10:01 supera el mínimo y no se ofreció")
		}
		if offered[h(9, 30)] || offered[h(9, 0)] {
			t.Errorf("se ofrecieron horas anteriores al mínimo")
		}
	})

	t.Run("CP-020 cambiar la anticipación a 120 min mueve la primera hora a 11:00", func(t *testing.T) {
		svc, policy := cpAlfa(now, cpAnticipacionMinutos, cpHorizonteDias, hoy)
		policy.minAdvanceMinutes = 120
		offered := cpOffered(t, svc)
		if offered[h(10, 59)] || !offered[h(11, 0)] {
			t.Errorf("con 120 min esperaba 10:59 fuera y 11:00 dentro; 10:59=%v 11:00=%v", offered[h(10, 59)], offered[h(11, 0)])
		}
	})

	t.Run("CP-020 la reserva directa por la API antes del mínimo se rechaza", func(t *testing.T) {
		svc := cpConfirmacionAlfa(now, cpAnticipacionMinutos, hoy)
		_, _, err := svc.ConfirmAppointment(context.Background(), validConfirmInput(time.Date(2026, time.September, 14, 9, 59, 0, 0, loc)), idempotency.Key("cp020-k1"), idempotency.Fingerprint("cp020-f1"))
		var conflict *publicbooking.ScheduleConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("09:59 saltándose la interfaz: esperaba conflicto de agenda, got %v", err)
		}
		if appErr, ok := apperr.As(conflict); !ok || appErr.Kind != apperr.KindScheduleConflict {
			t.Fatalf("esperaba KindScheduleConflict, got %v", conflict)
		}
	})

	t.Run("CP-020 la reserva directa justo en el mínimo se acepta", func(t *testing.T) {
		svc := cpConfirmacionAlfa(now, cpAnticipacionMinutos, hoy)
		if _, _, err := svc.ConfirmAppointment(context.Background(), validConfirmInput(time.Date(2026, time.September, 14, 10, 0, 0, 0, loc)), idempotency.Key("cp020-k2"), idempotency.Fingerprint("cp020-f2")); err != nil {
			t.Fatalf("10:00 es el mínimo exacto y la confirmación falló: %v", err)
		}
	})
}

func TestCP021_HorizonteMaximo(t *testing.T) {
	loc := cpBogota(t)
	now := time.Date(2026, time.September, 14, 9, 0, 0, 0, loc) // lunes, 09:00
	dentro := "2026-10-13"                                      // día 29
	limite := "2026-10-14"                                      // día 30: now + 30 días
	fuera := "2026-10-15"                                       // día 31
	at := func(day, hour, minute int) time.Time {
		return time.Date(2026, time.October, day, hour, minute, 0, 0, loc).UTC()
	}

	t.Run("CP-021 con 30 días, dentro y en el límite hay horas y fuera no", func(t *testing.T) {
		svc, _ := cpAlfa(now, cpAnticipacionMinutos, cpHorizonteDias, dentro, limite, fuera)
		offered := cpOffered(t, svc)
		if !offered[at(13, 17, 0)] {
			t.Errorf("el día 29 está dentro del horizonte y no ofreció 17:00")
		}
		if !offered[at(14, 9, 0)] {
			t.Errorf("09:00 del día 30 es exactamente el límite (inclusivo) y no se ofreció")
		}
		if offered[at(14, 9, 1)] {
			t.Errorf("09:01 del día 30 supera el horizonte y se ofreció")
		}
		if offered[at(15, 9, 0)] {
			t.Errorf("el día 31 está fuera del horizonte y se ofreció")
		}
	})

	t.Run("CP-021 ampliar el horizonte a 31 días abre el día 31", func(t *testing.T) {
		svc, policy := cpAlfa(now, cpAnticipacionMinutos, cpHorizonteDias, dentro, limite, fuera)
		policy.maxAdvanceDays = 31
		if offered := cpOffered(t, svc); !offered[at(15, 9, 0)] {
			t.Errorf("con 31 días esperaba 09:00 del día 31 disponible")
		}
	})

	t.Run("CP-021 la reserva directa fuera del horizonte no crea la cita", func(t *testing.T) {
		svc := cpConfirmacionAlfa(now, cpAnticipacionMinutos, dentro, limite, fuera)
		_, _, err := svc.ConfirmAppointment(context.Background(), validConfirmInput(time.Date(2026, time.October, 15, 10, 0, 0, 0, loc)), idempotency.Key("cp021-k1"), idempotency.Fingerprint("cp021-f1"))
		var conflict *publicbooking.ScheduleConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("fuera del horizonte: esperaba conflicto de agenda, got %v", err)
		}
	})
}

// cpConfirmacionAlfa arma la confirmación pública sobre la misma disponibilidad
// de cpAlfa, para probar que saltarse la interfaz no evita las reglas.
func cpConfirmacionAlfa(now time.Time, minAdvance int, workingDates ...string) *publicbooking.ConfirmationService {
	repo, effectiveDay, blocks, _, assignments, timezones := newAvailabilityFixture(now)
	effectiveDay.byDate = map[string]fakeDayResult{}
	for _, d := range workingDates {
		effectiveDay.byDate[d] = fakeDayResult{isWorking: true, starts: []string{"09:00"}, durations: []int{540}}
	}
	policy := &fakeBookingPolicy{minAdvanceMinutes: minAdvance, maxAdvanceDays: cpHorizonteDias, slotGridMinutes: 1}
	availability := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	profiles := &fakeRepository{found: true, profile: publicbooking.BusinessProfile{Name: "Barbería Alfa", Timezone: "America/Bogota"}}
	appointments := &fakePublicAppointmentPort{decision: idempotency.Decision{Outcome: idempotency.OutcomeProceed}, stored: idempotency.StoredResponse{Status: 201, ContentType: "application/json", Body: "{}"}}
	return publicbooking.NewConfirmationService(
		profiles, repo, availability, assignments, &fakeCustomerRepository{}, appointments, &fakeConfirmationEmailPort{},
		fixedAvailabilityClock{now: now}, "https://reservas.example.test",
	)
}
