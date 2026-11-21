// Casos del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III) del ciclo
// de vida del turno: CP-016 (cancelación según la política), CP-029 (estados y
// transiciones) y CP-032 (inasistencia). Fixture del plan: cita confirmada de la
// Barbería Alfa a las 10:00 y política de cancelación hasta 2 h antes. La etapa
// «Pruebas unitarias · Plan de Pruebas (CP)» del Jenkinsfile corre todo lo que
// empieza por TestCP. Lo que exige la fila bloqueada en PostgreSQL (repetir una
// cancelación ya aceptada sin efectos nuevos, la matriz completa de
// transiciones) se prueba con base real en internal/modules/booking/postgres.
package booking_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// cpPoliticaDosHoras es la política de prueba del plan: cancelar hasta 120 min
// antes, sin cancelación tardía.
var cpPoliticaDosHoras = booking.CustomerCancellationPolicy{DeadlineMinutes: 120, LateClientAllowed: false}

func cpInicioCita() time.Time { return time.Date(2026, time.September, 14, 15, 0, 0, 0, time.UTC) } // 10:00 en Bogotá

func TestCP016_CancelacionHastaDosHorasAntes(t *testing.T) {
	inicio := cpInicioCita()
	for _, tc := range []struct {
		name    string
		now     time.Time
		permite bool
	}{
		{"CP-016 a 2 h + 1 min del turno se permite", inicio.Add(-2*time.Hour - time.Minute), true},
		{"CP-016 justo en el límite de 2 h se permite", inicio.Add(-2 * time.Hour), true},
		{"CP-016 a 2 h − 1 min del turno se rechaza informando la política", inicio.Add(-2*time.Hour + time.Minute), false},
		{"CP-016 con el turno ya iniciado se rechaza", inicio, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := cpPoliticaDosHoras.Evaluate(inicio, tc.now, "")
			if tc.permite {
				if err != nil {
					t.Fatalf("esperaba cancelación permitida, got %v", err)
				}
				return
			}
			assertKind(t, err, apperr.KindCancellationWindowClosed)
		})
	}

	t.Run("CP-016 volver a enviar la misma cancelación reutiliza su clave y su reloj", func(t *testing.T) {
		repo := &fakeCustomerCancelRepository{}
		fixed := inicio.Add(-3 * time.Hour)
		svc := booking.NewCancelAppointmentByCustomerService(repo, func() time.Time { return fixed })
		req := booking.CancelAppointmentByCustomerRequest{AppointmentID: validCancelAppointmentID, ExpectedVersionToken: "v1"}
		for i := 0; i < 2; i++ {
			if _, err := svc.CancelAppointmentByCustomer(context.Background(), "barberia-alfa", req, "cp016-k", "cp016-f"); err != nil {
				t.Fatalf("intento %d: %v", i+1, err)
			}
		}
		// La idempotencia (una sola cancelación y un solo evento) la resuelve el
		// repositorio con la misma clave; aquí se comprueba que el servicio no
		// altera la entrada entre intentos.
		if repo.calls != 2 || repo.last.AppointmentID != validCancelAppointmentID || !repo.last.Now.Equal(fixed) {
			t.Fatalf("entrada inesperada: %d llamadas, %+v", repo.calls, repo.last)
		}
	})
}

func TestCP029_EstadosYTransicionesValidas(t *testing.T) {
	t.Run("CP-029 los cinco estados son distintos y solo los que ocupan agenda la bloquean", func(t *testing.T) {
		ocupa := map[booking.Status]bool{
			booking.StatusConfirmed:               true,
			booking.StatusCompleted:               true,
			booking.StatusNoShow:                  true,
			booking.StatusCancelledByCustomer:     false,
			booking.StatusCancelledByProfessional: false,
		}
		vistos := map[string]bool{}
		for status, want := range ocupa {
			if vistos[string(status)] {
				t.Fatalf("estado repetido: %q", status)
			}
			vistos[string(status)] = true
			if got := status.OccupiesSchedule(); got != want {
				t.Errorf("%q.OccupiesSchedule() = %v, want %v", status, got, want)
			}
		}
	})

	t.Run("CP-029 confirmada pasa a completada y a no asistió", func(t *testing.T) {
		repo := &fakeCloseRepository{}
		now := cpInicioCita().Add(time.Hour)
		completed, err := booking.NewCompleteAppointmentService(repo, fakeClock{now: now}).CompleteAppointment(context.Background(), "barberia-alfa", validCloseRequest(), "cp029-k1", "cp029-f1")
		if err != nil || completed.Appointment.Status != booking.StatusCompleted {
			t.Fatalf("completar: status=%q err=%v", completed.Appointment.Status, err)
		}
		noShow, err := booking.NewMarkNoShowService(repo, fakeClock{now: now}).MarkNoShow(context.Background(), "barberia-alfa", validCloseRequest(), "cp029-k2", "cp029-f2")
		if err != nil || noShow.Appointment.Status != booking.StatusNoShow {
			t.Fatalf("no asistió: status=%q err=%v", noShow.Appointment.Status, err)
		}
	})

	t.Run("CP-029 corregir hacia confirmada o a un estado inexistente se rechaza sin tocar datos", func(t *testing.T) {
		for _, destino := range []string{string(booking.StatusConfirmed), "pending", ""} {
			repo := &fakeCorrectRepository{}
			req := validCorrectRequest()
			req.DestinationStatus = destino
			_, err := booking.NewCorrectAppointmentStatusService(repo, fakeClock{now: cpInicioCita()}).CorrectAppointmentStatus(context.Background(), "barberia-alfa", req, "cp029-k3", "cp029-f3")
			assertKind(t, err, apperr.KindValidation)
			if repo.lastCorrectInput.AppointmentID != "" {
				t.Errorf("destino %q: llamó al repositorio con una transición prohibida", destino)
			}
		}
	})

	t.Run("CP-029 una transición que el estado guardado no admite devuelve error de estado", func(t *testing.T) {
		repo := &fakeCloseRepository{
			completeFn: func(context.Context, string, booking.CloseAppointmentInput, idempotency.Key, idempotency.Fingerprint) (booking.CompleteAppointmentResult, error) {
				return booking.CompleteAppointmentResult{}, apperr.InvalidState("el turno ya tiene un resultado terminal registrado")
			},
		}
		_, err := booking.NewCompleteAppointmentService(repo, fakeClock{now: cpInicioCita()}).CompleteAppointment(context.Background(), "barberia-alfa", validCloseRequest(), "cp029-k4", "cp029-f4")
		assertKind(t, err, apperr.KindInvalidState)
	})
}

func TestCP032_RegistroDeInasistencia(t *testing.T) {
	// Reloj fijo una hora después del inicio de la cita: su hora ya pasó.
	ahora := cpInicioCita().Add(time.Hour)

	t.Run("CP-032 se registra no asistió con el actor del personal y la hora del reloj", func(t *testing.T) {
		repo := &fakeCloseRepository{}
		got, err := booking.NewMarkNoShowService(repo, fakeClock{now: ahora}).MarkNoShow(context.Background(), "barberia-alfa", validCloseRequest(), "cp032-k1", "cp032-f1")
		if err != nil {
			t.Fatalf("MarkNoShow: %v", err)
		}
		if got.Appointment.Status != booking.StatusNoShow {
			t.Fatalf("estado = %q, want no_show", got.Appointment.Status)
		}
		in := repo.lastNoShowInput
		if in.Actor.Type != booking.ActorTypeStaff || in.Actor.StaffUserID == nil || *in.Actor.StaffUserID != "staff-1" || !in.Now.Equal(ahora) {
			t.Fatalf("actor o momento inesperado: %+v", in)
		}
	})

	t.Run("CP-032 sin actor autorizado se rechaza y la cita no se toca", func(t *testing.T) {
		repo := &fakeCloseRepository{}
		req := validCloseRequest()
		req.ActorStaffUserID = ""
		_, err := booking.NewMarkNoShowService(repo, fakeClock{now: ahora}).MarkNoShow(context.Background(), "barberia-alfa", req, "cp032-k2", "cp032-f2")
		assertKind(t, err, apperr.KindValidation)
		if repo.lastNoShowInput.AppointmentID != "" {
			t.Fatal("llamó al repositorio sin actor autorizado")
		}
	})
}
