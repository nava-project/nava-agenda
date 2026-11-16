package appointmentnotice

import (
	"fmt"
	"strings"
	"time"
)

var monthNames = [...]string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
	"agosto", "septiembre", "octubre", "noviembre", "diciembre"}

// WhenText redacta el instante del turno para el recordatorio por WhatsApp
// (DEC-175), en la zona del negocio y como lo diría una persona: «hoy a las
// 3:30 p. m.», «mañana a las 9:00 a. m.» o «el 17 de noviembre a las 12:15
// p. m.». Con anticipaciones de hasta 60 minutos casi siempre es «hoy»; «mañana»
// cubre un turno poco después de medianoche.
func WhenText(startsAt, now time.Time, loc *time.Location) string {
	start := startsAt.In(loc)
	today := now.In(loc)
	hour := clockText(start)
	switch {
	case sameDay(start, today):
		return "hoy a las " + hour
	case sameDay(start, today.AddDate(0, 0, 1)):
		return "mañana a las " + hour
	default:
		return fmt.Sprintf("el %d de %s a las %s", start.Day(), monthNames[start.Month()-1], hour)
	}
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

// clockText usa el reloj de 12 horas con «a. m.»/«p. m.», como se lee en Colombia.
func clockText(t time.Time) string {
	h := t.Hour() % 12
	if h == 0 {
		h = 12
	}
	suffix := "a. m."
	if t.Hour() >= 12 {
		suffix = "p. m."
	}
	return fmt.Sprintf("%d:%02d %s", h, t.Minute(), suffix)
}

// firstName saluda por el primer nombre («Hola Laura»); sin nombre, «Hola de nuevo».
func firstName(full string) string {
	if fields := strings.Fields(full); len(fields) > 0 {
		return fields[0]
	}
	return "de nuevo"
}
