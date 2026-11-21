package booking

import (
	"context"
	"fmt"
	"strings"
	"time"

	"nava-agenda/internal/platform/apperr"
)

// manualAvailabilityMaxDays es el tramo máximo de fechas, ambas incluidas, que
// acepta la lectura de inicios para un turno manual (#717). Acota el costo de
// una sola lectura: la jornada se resuelve día por día.
const manualAvailabilityMaxDays = 31

// ManualSlotsPort entrega los inicios libres para registrar un turno manual
// (#717). Lo satisface publicbooking.AvailabilityService con el mismo núcleo
// de la reserva pública (jornada efectiva, bloqueos y citas que ocupan
// agenda), sin la anticipación mínima ni la ventana máxima (RN-DIS-04): el
// mismo criterio que RescheduleSlotsPort frente a HU-104, para que booking no
// importe publicbooking. fromDate y toDate son fechas civiles "AAAA-MM-DD" ya
// validadas, en la zona del negocio. excludeStartsAt/excludeEndsAt, si no son
// cero, son el intervalo del turno que se reprograma (#776): deja de contar como
// ocupado, con el mismo withoutOwnAppointment de la reprogramación pública.
type ManualSlotsPort interface {
	ManualStarts(
		ctx context.Context,
		businessID, professionalID string,
		durationMinutes int,
		fromDate, toDate string,
		excludeStartsAt, excludeEndsAt time.Time,
	) (starts []time.Time, timezone string, slotGridMinutes int, err error)
}

// ExcludableAppointment es lo mínimo que la lectura de inicios necesita de un
// turno para excluirlo de la ocupación al reprogramarlo (#776).
type ExcludableAppointment struct {
	ProfessionalID          string
	ServiceID               string
	Status                  Status
	StartsAt                time.Time
	EndsAt                  time.Time
	DurationMinutesSnapshot int
}

// ExcludableAppointmentPort lee un turno dentro de businessID (RLS) para
// excluirlo de la ocupación. found=false cubre un id inexistente o de otro
// negocio, sin distinguir la causa (RN-TEN-01).
type ExcludableAppointmentPort interface {
	ExcludableAppointment(ctx context.Context, businessID, appointmentID string) (ExcludableAppointment, bool, error)
}

// ManualAvailability es la respuesta de ManualAvailabilityService.List.
type ManualAvailability struct {
	Starts          []time.Time
	DurationMinutes int
	Timezone        string
	SlotGridMinutes int
}

// ManualAvailabilityService implementa
// GET /private/professionals/{professionalId}/services/{serviceId}/availability
// (#717): los inicios libres del servicio con el profesional, para elegir la
// hora de un turno manual sobre la disponibilidad real.
type ManualAvailabilityService struct {
	catalog      ProfessionalServicePort
	slots        ManualSlotsPort
	appointments ExcludableAppointmentPort
}

// NewManualAvailabilityService construye el caso de uso.
func NewManualAvailabilityService(
	catalog ProfessionalServicePort,
	slots ManualSlotsPort,
	appointments ExcludableAppointmentPort,
) *ManualAvailabilityService {
	return &ManualAvailabilityService{catalog: catalog, slots: slots, appointments: appointments}
}

// List valida el tramo de fechas (422) y la asignación (404 uniforme, el mismo
// de la creación manual: DEC-072, RN-TEN-01) antes de calcular. rawTo vacío
// significa un solo día, rawFrom.
//
// rawExclude es el turno que se reprograma (#776, enmienda de DEC-190). Solo se
// usa si es un turno de este negocio, de este profesional y de este servicio, y
// sigue `confirmed` (el único estado que se reprograma, HU-065): entonces su
// intervalo deja de contar como ocupado y el cálculo usa su duración congelada
// (duration_minutes_snapshot), la misma con la que la reprogramación lo moverá,
// igual que la reprogramación pública (HU-104). Cualquier otro valor se ignora en
// silencio: la respuesta es la misma que sin él y no revela si el turno existe.
func (s *ManualAvailabilityService) List(ctx context.Context, businessID, professionalID, serviceID, rawFrom, rawTo, rawExclude string) (ManualAvailability, error) {
	if err := ctx.Err(); err != nil {
		return ManualAvailability{}, apperr.Internal(fmt.Errorf("booking: contexto cancelado antes de listar inicios manuales: %w", err))
	}

	fromDate, toDate, err := parseManualRange(rawFrom, rawTo)
	if err != nil {
		return ManualAvailability{}, err
	}

	professionalID = strings.TrimSpace(professionalID)
	serviceID = strings.TrimSpace(serviceID)
	if !LooksLikeProfessionalID(professionalID) || !LooksLikeProfessionalID(serviceID) {
		return ManualAvailability{}, errServiceNotAssigned()
	}

	_, durationMinutes, _, _, found, err := s.catalog.ActiveAssignedService(ctx, businessID, professionalID, serviceID)
	if err != nil {
		return ManualAvailability{}, err
	}
	if !found || durationMinutes <= 0 {
		return ManualAvailability{}, errServiceNotAssigned()
	}

	var excludeStartsAt, excludeEndsAt time.Time
	own, ok, err := s.excludable(ctx, businessID, professionalID, serviceID, rawExclude)
	if err != nil {
		return ManualAvailability{}, err
	}
	if ok {
		durationMinutes = own.DurationMinutesSnapshot
		excludeStartsAt, excludeEndsAt = own.StartsAt, own.EndsAt
	}

	starts, timezone, slotGridMinutes, err := s.slots.ManualStarts(ctx, businessID, professionalID, durationMinutes, fromDate, toDate, excludeStartsAt, excludeEndsAt)
	if err != nil {
		return ManualAvailability{}, err
	}
	if starts == nil {
		starts = []time.Time{}
	}
	return ManualAvailability{
		Starts:          starts,
		DurationMinutes: durationMinutes,
		Timezone:        timezone,
		SlotGridMinutes: slotGridMinutes,
	}, nil
}

// excludable resuelve rawExclude a un turno que se puede excluir, o ok=false
// sin error para cualquier valor que no cumpla (forma inválida, inexistente, de
// otro negocio, de otro profesional o servicio, o en un estado que no se
// reprograma). Solo un fallo de lectura es error.
func (s *ManualAvailabilityService) excludable(ctx context.Context, businessID, professionalID, serviceID, rawExclude string) (ExcludableAppointment, bool, error) {
	appointmentID := strings.TrimSpace(rawExclude)
	if appointmentID == "" || !LooksLikeAppointmentID(appointmentID) {
		return ExcludableAppointment{}, false, nil
	}
	own, found, err := s.appointments.ExcludableAppointment(ctx, businessID, appointmentID)
	if err != nil {
		return ExcludableAppointment{}, false, apperr.Internal(fmt.Errorf("booking: leer el turno a excluir de los inicios: %w", err))
	}
	if !found ||
		own.ProfessionalID != professionalID ||
		own.ServiceID != serviceID ||
		own.Status != StatusConfirmed ||
		own.DurationMinutesSnapshot <= 0 ||
		!own.EndsAt.After(own.StartsAt) {
		return ExcludableAppointment{}, false, nil
	}
	return own, true, nil
}

// parseManualRange valida from/to como fechas civiles, to ≥ from y un tramo
// de hasta manualAvailabilityMaxDays días. Todas las fallas son 422: el
// contenido está bien formado como petición, pero el rango no es procesable.
func parseManualRange(rawFrom, rawTo string) (string, string, error) {
	fromDate := strings.TrimSpace(rawFrom)
	if fromDate == "" {
		return "", "", apperr.Validation("from es obligatorio: una fecha civil con el formato AAAA-MM-DD")
	}
	from, err := time.Parse(dailyAgendaDateLayout, fromDate)
	if err != nil {
		return "", "", apperr.Validation("from debe ser una fecha civil con el formato AAAA-MM-DD")
	}

	toDate := strings.TrimSpace(rawTo)
	if toDate == "" {
		toDate = fromDate
	}
	to, err := time.Parse(dailyAgendaDateLayout, toDate)
	if err != nil {
		return "", "", apperr.Validation("to debe ser una fecha civil con el formato AAAA-MM-DD")
	}

	// Fechas civiles sin zona (UTC): la resta da días enteros, sin horario de verano.
	days := int(to.Sub(from).Hours()/24) + 1
	if days < 1 {
		return "", "", apperr.Validation("la fecha final no puede ser anterior a la inicial")
	}
	if days > manualAvailabilityMaxDays {
		return "", "", apperr.Validation(fmt.Sprintf("el tramo de fechas no puede pasar de %d días", manualAvailabilityMaxDays))
	}
	return fromDate, toDate, nil
}
