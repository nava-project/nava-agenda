// Caso CP-033 del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III):
// recordatorio vigente tras cambios. Una cita de la Barbería Alfa a las 10:00
// se reprograma dos veces antes del envío (11:00 y luego 12:00, hora de Bogotá);
// el worker ejecuta los tres trabajos de recordatorio. La etapa «Pruebas
// unitarias · Plan de Pruebas (CP)» del Jenkinsfile corre todo lo que empieza
// por TestCP. La reprogramación de la cola en PostgreSQL se prueba en
// internal/modules/booking/postgres (TestReminderHook_CreateAndReschedule).
package appointmentnotice_test

import (
	"testing"
	"time"

	"nava-agenda/internal/modules/appointmentnotice"
)

func TestCP033_RecordatorioVigenteTrasReprogramar(t *testing.T) {
	hora := func(h int) time.Time { return time.Date(2026, time.January, 7, h+5, 0, 0, 0, time.UTC) } // h en Bogotá
	vigente := hora(12)
	recordatorio := func(programadoPara time.Time) appointmentnotice.Context {
		c := reminderContext()
		c.BusinessName = "Barbería Alfa"
		c.StartsAt = vigente
		c.NoticeStateAt = programadoPara
		return c
	}

	for _, viejo := range []time.Time{hora(10), hora(11)} {
		t.Run("CP-033 el trabajo obsoleto de las "+viejo.Add(-5*time.Hour).Format("15:04")+" no envía la hora anterior", func(t *testing.T) {
			store, mailer := &fakeStore{ctx: recordatorio(viejo)}, &fakeMailer{}
			fin, _ := process(t, store, mailer, 1)
			if len(mailer.calls) != 0 {
				t.Fatalf("el recordatorio obsoleto envió %d correos", len(mailer.calls))
			}
			if fin.Outcome != appointmentnotice.OutcomeSkipped || fin.Code != appointmentnotice.CodeSuperseded {
				t.Fatalf("cierre = %s/%s, want skipped/%s", fin.Outcome, fin.Code, appointmentnotice.CodeSuperseded)
			}
		})
	}

	t.Run("CP-033 el trabajo vigente envía un único recordatorio con el horario actual", func(t *testing.T) {
		store, mailer := &fakeStore{ctx: recordatorio(vigente)}, &fakeMailer{}
		fin, _ := process(t, store, mailer, 1)
		if len(mailer.calls) != 1 {
			t.Fatalf("esperaba un recordatorio, se enviaron %d", len(mailer.calls))
		}
		if got := mailer.calls[0].startsAt.Format("15:04"); got != "12:00" || mailer.calls[0].kind != "reminder" {
			t.Fatalf("recordatorio = %s a las %s, want reminder a las 12:00", mailer.calls[0].kind, got)
		}
		if fin.Outcome != appointmentnotice.OutcomeSent || !fin.CoversStateAt.Equal(vigente) {
			t.Fatalf("cierre = %+v, debe cubrir la hora vigente", fin)
		}
	})

	t.Run("CP-033 repetir el trabajo ya enviado no duplica el recordatorio", func(t *testing.T) {
		ctx := recordatorio(vigente)
		ctx.AlreadyCovered = true
		store, mailer := &fakeStore{ctx: ctx}, &fakeMailer{}
		fin, _ := process(t, store, mailer, 2)
		if len(mailer.calls) != 0 || fin.Code != appointmentnotice.CodeSuperseded {
			t.Fatalf("repetición: %d envíos, código %q", len(mailer.calls), fin.Code)
		}
	})
}
