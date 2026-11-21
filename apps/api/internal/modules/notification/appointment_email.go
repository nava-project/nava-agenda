package notification

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Los correos de la cita (confirmación, recordatorio, cancelación y
// reprogramación) llevan el turno como tarjeta (#755): la hora protagonista, la
// fecha como se dice en español y los datos unidos por puntos guía, como la
// tarjeta de la cita en la app.

var (
	weekdayNames = [...]string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}
	monthNames   = [...]string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
		"agosto", "septiembre", "octubre", "noviembre", "diciembre"}
)

// appointmentDay es la fecha legible en la zona de t: «miércoles 7 de enero».
func appointmentDay(t time.Time) string {
	return fmt.Sprintf("%s %d de %s", weekdayNames[t.Weekday()], t.Day(), monthNames[t.Month()-1])
}

// appointmentClock es la hora de 12 horas con «a. m.»/«p. m.», como se lee en
// Colombia: «4:30 p. m.». Los espacios son de no separación (nbsp): la hora
// nunca se parte en dos líneas.
func appointmentClock(t time.Time) string {
	h := t.Hour() % 12
	if h == 0 {
		h = 12
	}
	suffix := "a. m."
	if t.Hour() >= 12 {
		suffix = "p. m."
	}
	return keepClockTogether(fmt.Sprintf("%d:%02d %s", h, t.Minute(), suffix))
}

// zoneLabel nombra la zona del negocio como la diría una persona. Solo conoce
// la de Colombia; con otra devuelve "" y la tarjeta no inventa un nombre ni
// muestra el identificador IANA.
func zoneLabel(t time.Time) string {
	if t.Location().String() == "America/Bogota" {
		return "hora de Colombia"
	}
	return ""
}

// durationText redacta la duración planificada: «45 min», «1 h», «1 h 30 min».
func durationText(minutes int) string {
	switch {
	case minutes <= 0:
		return ""
	case minutes < 60:
		return fmt.Sprintf("%d min", minutes)
	case minutes%60 == 0:
		return fmt.Sprintf("%d h", minutes/60)
	default:
		return fmt.Sprintf("%d h %d min", minutes/60, minutes%60)
	}
}

func appointmentTicket(seal string, startsAt time.Time, rows ...emailDetail) *emailTicket {
	return &emailTicket{
		Seal:  seal,
		Clock: appointmentClock(startsAt),
		Zone:  zoneLabel(startsAt),
		Day:   appointmentDay(startsAt),
		Rows:  rows,
	}
}

// confirmationEmail redacta la confirmación del turno recién reservado. startsAt
// llega en la zona del negocio. Una fila sin valor (sin profesional, duración o
// lugar conocidos) no se pinta.
func confirmationEmail(
	businessName, serviceName, professionalName, attendeeName string,
	startsAt time.Time, durationMinutes int,
	address string, atHome bool,
	accessLink string,
) emailContent {
	placeLabel := "Dónde"
	if atHome {
		placeLabel = "A domicilio"
	}
	c := emailContent{
		Preheader: fmt.Sprintf("Tu turno en %s: %s, %s.", businessName, appointmentDay(startsAt), appointmentClock(startsAt)),
		Brand:     businessName,
		Kicker:    "Tu turno",
		Title:     "Tu turno está listo",
		Greeting:  fmt.Sprintf("Hola %s,", attendeeName),
		Paragraphs: []string{
			fmt.Sprintf("Tu turno en %s quedó confirmado. Te esperamos.", businessName),
		},
		Ticket: appointmentTicket("Confirmado", startsAt,
			emailDetail{Label: "Servicio", Value: serviceName},
			emailDetail{Label: "Con", Value: professionalName},
			emailDetail{Label: "Duración", Value: durationText(durationMinutes)},
			emailDetail{Label: placeLabel, Value: address},
		),
		Footnotes: []string{"Si no reservaste este turno, ignora este mensaje."},
	}
	if accessLink != "" {
		c.Closing = []string{"Consulta tu turno cuando quieras desde aquí:"}
		c.Button = &emailButton{Label: "Ver mi turno", URL: accessLink}
	} else {
		c.Closing = []string{"Muy pronto podrás consultar tu turno en línea con el enlace que enviaremos por separado."}
	}
	return c
}

// clockJoiner une la hora con su «a. m.»/«p. m.» con espacios de no separación.
var clockJoiner = strings.NewReplacer(" a. m.", "\u00a0a.\u00a0m.", " p. m.", "\u00a0p.\u00a0m.")

func keepClockTogether(s string) string { return clockJoiner.Replace(s) }

var errUnknownChangeNotice = errors.New("notification: tipo de aviso desconocido")

// changeNoticeEmail redacta el aviso de cancelación, reprogramación o
// recordatorio con el estado vigente del turno (RN-REC-03). relativeWhen es el
// «cuándo» del recordatorio («hoy a las 4:30 p. m.»); vacío en los demás.
func changeNoticeEmail(
	kind, businessName, serviceName, professionalName, attendeeName string,
	startsAt time.Time, relativeWhen string,
) (subject string, c emailContent, err error) {
	rows := []emailDetail{
		{Label: "Servicio", Value: serviceName},
		{Label: "Con", Value: professionalName},
	}
	c = emailContent{
		Brand:     businessName,
		Kicker:    "Tu turno",
		Greeting:  fmt.Sprintf("Hola %s,", attendeeName),
		Footnotes: []string{"Si no esperabas este mensaje, ignóralo."},
	}
	switch kind {
	case changeNoticeCancelled:
		subject = "Tu turno fue cancelado"
		c.Preheader = fmt.Sprintf("%s canceló tu turno del %s.", businessName, appointmentDay(startsAt))
		c.Title = "Tu turno fue cancelado"
		c.Paragraphs = []string{fmt.Sprintf("%s canceló este turno.", businessName)}
		c.Ticket = appointmentTicket("Cancelado", startsAt, rows...)
		c.Ticket.Danger, c.Ticket.Struck = true, true
		c.Closing = []string{"¿Quieres otro horario? Reserva de nuevo o comunícate con el negocio."}
	case changeNoticeRescheduled:
		subject = "Tu turno cambió de horario"
		c.Preheader = fmt.Sprintf("%s movió tu turno al %s, %s.", businessName, appointmentDay(startsAt), appointmentClock(startsAt))
		c.Title = "Tu turno cambió de horario"
		c.Paragraphs = []string{fmt.Sprintf("%s movió tu turno. Este es el horario nuevo:", businessName)}
		c.Ticket = appointmentTicket("Nuevo horario", startsAt, rows...)
		c.Closing = []string{"Si no puedes a esa hora, comunícate con el negocio."}
	case changeNoticeReminder:
		subject = "Recordatorio de tu turno"
		c.Title = "Tu turno es muy pronto"
		if relativeWhen != "" {
			c.Title = "Tu turno es " + keepClockTogether(relativeWhen)
		}
		c.Preheader = fmt.Sprintf("Te esperamos en %s.", businessName)
		c.Paragraphs = []string{fmt.Sprintf("Te esperamos en %s.", businessName)}
		c.Ticket = appointmentTicket("Recordatorio", startsAt, rows...)
		c.Closing = []string{"Si no puedes asistir, avísale al negocio con tiempo."}
	default:
		return "", emailContent{}, errUnknownChangeNotice
	}
	return subject, c, nil
}
