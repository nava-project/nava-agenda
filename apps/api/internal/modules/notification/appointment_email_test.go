package notification

import (
	"strings"
	"testing"
	"time"
)

func TestAppointmentWhen_ReadsLikeSpanish(t *testing.T) {
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		at         time.Time
		day, clock string
		zone       string
	}{
		{time.Date(2027, 1, 6, 16, 30, 0, 0, loc), "miércoles 6 de enero", "4:30\u00a0p.\u00a0m.", "hora de Colombia"},
		{time.Date(2027, 3, 1, 0, 5, 0, 0, loc), "lunes 1 de marzo", "12:05\u00a0a.\u00a0m.", "hora de Colombia"},
		{time.Date(2027, 12, 25, 12, 0, 0, 0, time.UTC), "sábado 25 de diciembre", "12:00\u00a0p.\u00a0m.", ""},
	}
	for _, c := range cases {
		if got := appointmentDay(c.at); got != c.day {
			t.Errorf("día de %v = %q, esperaba %q", c.at, got, c.day)
		}
		if got := appointmentClock(c.at); got != c.clock {
			t.Errorf("hora de %v = %q, esperaba %q", c.at, got, c.clock)
		}
		if got := zoneLabel(c.at); got != c.zone {
			t.Errorf("zona de %v = %q, esperaba %q (nunca el nombre IANA)", c.at, got, c.zone)
		}
	}
}

func TestAppointmentClock_NeverBreaksAcrossLines(t *testing.T) {
	got := appointmentClock(time.Date(2027, 1, 6, 16, 30, 0, 0, time.UTC))
	if strings.Contains(got, " ") {
		t.Fatalf("la hora lleva espacios de no separación: %q", got)
	}
}

func TestDurationText(t *testing.T) {
	for in, want := range map[int]string{0: "", 45: "45 min", 60: "1 h", 90: "1 h 30 min", 120: "2 h"} {
		if got := durationText(in); got != want {
			t.Errorf("durationText(%d) = %q, esperaba %q", in, got, want)
		}
	}
}

func TestTicketRows_LongValuesGoBelowTheirLabelAndEmptyOnesVanish(t *testing.T) {
	rows := ticketRows([]emailDetail{
		{Label: "Servicio", Value: "Corte clásico"},
		{Label: "Con", Value: ""},
		{Label: "Dónde", Value: "Carrera 45 # 26-85, apartamento 1203"},
	})
	if len(rows) != 2 {
		t.Fatalf("la fila sin valor no se pinta: %+v", rows)
	}
	if !rows[0].Inline || rows[1].Inline {
		t.Fatalf("un valor corto va en línea y uno largo debajo: %+v", rows)
	}
}

func TestConfirmationEmail_TicketCarriesTheAppointment(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	c := confirmationEmail("Barbería Centro", "Corte", "Laura", "Ana",
		time.Date(2027, 1, 6, 16, 30, 0, 0, loc), 45, "", true, "https://agenda.nava.test/mi-turno/x")
	html, err := c.HTML()
	if err != nil {
		t.Fatal(err)
	}
	text := c.Text()
	for _, want := range []string{"Confirmado", "4:30\u00a0p.\u00a0m.", "hora de Colombia", "miércoles 6 de enero", "Laura", "45 min", "Ver mi turno"} {
		if !strings.Contains(html, want) || !strings.Contains(text, want) {
			t.Errorf("%q debe estar en html y en texto", want)
		}
	}
	if strings.Contains(html, "A domicilio") {
		t.Error("sin dirección no hay fila de lugar")
	}
	if strings.Contains(html, "America/Bogota") || strings.Contains(text, "America/Bogota") {
		t.Error("la zona no se muestra como identificador IANA")
	}
	if !strings.Contains(html, `class="leader"`) {
		t.Error("las filas cortas van unidas por puntos guía")
	}
}

func TestChangeNoticeEmail_CancelledIsStruckAndSaysItInWords(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	_, c, err := changeNoticeEmail(changeNoticeCancelled, "Barbería Centro", "Corte", "Laura", "Ana",
		time.Date(2027, 1, 6, 16, 30, 0, 0, loc), "")
	if err != nil {
		t.Fatal(err)
	}
	html, _ := c.HTML()
	if !strings.Contains(html, "text-decoration:line-through") {
		t.Error("la hora del turno cancelado va tachada")
	}
	text := c.Text()
	if !strings.Contains(text, "Era el miércoles 6 de enero · 4:30\u00a0p.\u00a0m.") {
		t.Errorf("el texto plano dice con palabras que el turno ya no está:\n%s", text)
	}
	for _, p := range c.Paragraphs {
		if strings.HasSuffix(p, ":") {
			t.Errorf("un párrafo que termina en «:» debe ir seguido de la tarjeta, no de otro párrafo: %q", p)
		}
	}
	if !strings.Contains(text, "Reserva de nuevo") {
		t.Error("la cancelación dice qué hacer ahora")
	}
}

func TestChangeNoticeEmail_ReminderTitleUsesTheRelativeWhen(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	at := time.Date(2027, 1, 6, 16, 30, 0, 0, loc)
	_, c, _ := changeNoticeEmail(changeNoticeReminder, "B", "S", "P", "A", at, "hoy a las 4:30 p. m.")
	if c.Title != "Tu turno es hoy a las 4:30\u00a0p.\u00a0m." {
		t.Errorf("título = %q", c.Title)
	}
	_, c, _ = changeNoticeEmail(changeNoticeReminder, "B", "S", "P", "A", at, "")
	if c.Title != "Tu turno es muy pronto" {
		t.Errorf("sin «cuándo», título = %q", c.Title)
	}
}
