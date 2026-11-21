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
// validadas, en la zona del negocio.
type ManualSlotsPort interface {
	ManualStarts(ctx context.Context, businessID, professionalID string, durationMinutes int, fromDate, toDate string) (
		starts []time.Time, timezone string, slotGridMinutes int, err error,
	)
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
	catalog ProfessionalServicePort
	slots   ManualSlotsPort
}

// NewManualAvailabilityService construye el caso de uso.
func NewManualAvailabilityService(catalog ProfessionalServicePort, slots ManualSlotsPort) *ManualAvailabilityService {
	return &ManualAvailabilityService{catalog: catalog, slots: slots}
}

// List valida el tramo de fechas (422) y la asignación (404 uniforme, el mismo
// de la creación manual: DEC-072, RN-TEN-01) antes de calcular. rawTo vacío
// significa un solo día, rawFrom.
func (s *ManualAvailabilityService) List(ctx context.Context, businessID, professionalID, serviceID, rawFrom, rawTo string) (ManualAvailability, error) {
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

	starts, timezone, slotGridMinutes, err := s.slots.ManualStarts(ctx, businessID, professionalID, durationMinutes, fromDate, toDate)
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
