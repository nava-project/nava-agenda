package publicbooking

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"nava-agenda/internal/modules/availability"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/clock"
)

// AvailabilityService implementa el caso de uso de HU-094: proyectar los
// inicios públicos válidos de un servicio ya elegido, para un profesional ya
// elegido, dentro del negocio resuelto por slug. Deliberadamente
// SEPARADO de Service (que resuelve HU-090/HU-091/HU-092): necesita
// colaborar con schedule/shops/catalog a través de puertos pequeños
// (EffectiveDayPort/BusyBlocksPort/BookingPolicyPort/ServiceAssignmentPort/
// AvailabilityTimezonePort, mismo criterio de HU-061), algo que las otras
// tres operaciones -de una sola tabla- nunca necesitaron.
type AvailabilityService struct {
	repo         AvailabilityRepository
	effectiveDay EffectiveDayPort
	blocks       BusyBlocksPort
	policy       BookingPolicyPort
	assignments  ServiceAssignmentPort
	timezones    AvailabilityTimezonePort
	clock        clock.Clock
}

// NewAvailabilityService construye el caso de uso a partir de sus seis
// colaboradores.
func NewAvailabilityService(
	repo AvailabilityRepository,
	effectiveDay EffectiveDayPort,
	blocks BusyBlocksPort,
	policy BookingPolicyPort,
	assignments ServiceAssignmentPort,
	timezones AvailabilityTimezonePort,
	clk clock.Clock,
) *AvailabilityService {
	return &AvailabilityService{
		repo:         repo,
		effectiveDay: effectiveDay,
		blocks:       blocks,
		policy:       policy,
		assignments:  assignments,
		timezones:    timezones,
		clock:        clk,
	}
}

// civilDateLayout es el formato de fecha civil que EffectiveDayPort y
// BusyBlocksPort esperan ("AAAA-MM-DD"), mismo layout que
// schedule.dateLayout.
const civilDateLayout = "2006-01-02"

// civilDateTimeLayout combina civilDateLayout con la hora "HH:MM" que
// EffectiveDayPort devuelve para cada tramo (RN-DIS-07: siempre hora local
// del negocio, nunca del dispositivo).
const civilDateTimeLayout = "2006-01-02 15:04"

// ListPublicAvailability resuelve rawSlug -mismo criterio de recorte y
// forma que Service.ResolveBusiness- y, si resuelve, proyecta los
// inicios válidos del servicio rawServiceID con el profesional rawProfessionalID
// (CA-094-01 a CA-094-06). Un slug inválido, desconocido o de un negocio
// no publicable produce el mismo apperr.NotFound uniforme que las demás
// operaciones públicas (CA-090-02). Un rawServiceID/rawProfessionalID sin forma
// de UUID, ajeno, inexistente, inactivo o sin asignación vigente NUNCA
// produce un error distinto (mismo criterio que CA-092-03): el resultado es
// una disponibilidad vacía, exactamente igual que "sin franjas hoy".
func (s *AvailabilityService) ListPublicAvailability(ctx context.Context, rawSlug, rawServiceID, rawProfessionalID string) (AvailabilityResult, error) {
	if err := ctx.Err(); err != nil {
		return AvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de calcular disponibilidad: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return AvailabilityResult{}, errBusinessNotPublic()
	}

	businessID, found, err := s.repo.ResolveBusinessID(ctx, slug)
	if err != nil {
		return AvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: resolver negocio para disponibilidad: %w", err))
	}
	if !found {
		return AvailabilityResult{}, errBusinessNotPublic()
	}

	if !LooksLikePublicServiceID(rawServiceID) || !LooksLikePublicProfessionalID(rawProfessionalID) {
		return AvailabilityResult{}, nil
	}

	_, durationMinutes, _, _, assigned, err := s.assignments.ActiveAssignedService(ctx, businessID, rawProfessionalID, rawServiceID)
	if err != nil {
		return AvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: verificar asignación para disponibilidad: %w", err))
	}
	if !assigned || durationMinutes <= 0 {
		return AvailabilityResult{}, nil
	}

	starts, timezone, slotGridMinutes, err := s.computeAvailableStarts(ctx, businessID, rawProfessionalID, durationMinutes)
	if err != nil {
		return AvailabilityResult{}, err
	}

	slots := make([]AvailabilitySlot, 0, len(starts))
	for _, t := range starts {
		slots = append(slots, AvailabilitySlot{StartsAt: t})
	}

	return AvailabilityResult{
		Slots:           slots,
		DurationMinutes: durationMinutes,
		Timezone:        timezone,
		SlotGridMinutes: slotGridMinutes,
	}, nil
}

// ListPublicServiceAvailability resuelve rawSlug -mismo criterio que
// ListPublicAvailability- y proyecta, en una sola respuesta, los inicios
// públicos válidos del servicio activo rawServiceID para TODOS sus profesionales
// elegibles (DEC-162). Sustituye a una llamada de ListPublicAvailability por
// profesional para quien necesita el panorama completo. No reimplementa nada:
// por cada profesional elegible reutiliza ActiveAssignedService (la misma
// verificación de asignación vigente) y computeAvailableStarts (la única
// fuente de verdad de las franjas, la misma que usa el endpoint por profesional
// y la confirmación), así que ambas rutas no pueden divergir ni en
// ventana, ni en rejilla, ni en bloqueos y citas.
//
// El resultado se ordena por (StartsAt, ProfessionalID). Un slug inválido,
// desconocido o no publicable produce el mismo apperr.NotFound uniforme;
// un rawServiceID sin forma de UUID, ajeno, inexistente, inactivo o sin
// ningún profesional con asignación vigente NUNCA produce un error distinto: el
// resultado es vacío (CA-092-03), igual que el endpoint por profesional.
func (s *AvailabilityService) ListPublicServiceAvailability(ctx context.Context, rawSlug, rawServiceID string) (ServiceAvailabilityResult, error) {
	if err := ctx.Err(); err != nil {
		return ServiceAvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de calcular disponibilidad del servicio: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return ServiceAvailabilityResult{}, errBusinessNotPublic()
	}

	businessID, found, err := s.repo.ResolveBusinessID(ctx, slug)
	if err != nil {
		return ServiceAvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: resolver negocio para disponibilidad del servicio: %w", err))
	}
	if !found {
		return ServiceAvailabilityResult{}, errBusinessNotPublic()
	}

	if !LooksLikePublicServiceID(rawServiceID) {
		return ServiceAvailabilityResult{}, nil
	}

	professionalIDs, err := s.repo.ListServiceProfessionalIDs(ctx, businessID, rawServiceID)
	if err != nil {
		return ServiceAvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: listar profesionales elegibles del servicio: %w", err))
	}

	result := ServiceAvailabilityResult{Slots: []ProfessionalAvailabilitySlot{}}
	for _, professionalID := range professionalIDs {
		if err := ctx.Err(); err != nil {
			return ServiceAvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado calculando disponibilidad del servicio: %w", err))
		}

		_, durationMinutes, _, _, assigned, err := s.assignments.ActiveAssignedService(ctx, businessID, professionalID, rawServiceID)
		if err != nil {
			return ServiceAvailabilityResult{}, apperr.Internal(fmt.Errorf("publicbooking: verificar asignación para disponibilidad del servicio: %w", err))
		}
		if !assigned || durationMinutes <= 0 {
			continue
		}

		starts, timezone, slotGridMinutes, err := s.computeAvailableStarts(ctx, businessID, professionalID, durationMinutes)
		if err != nil {
			return ServiceAvailabilityResult{}, err
		}

		// La duración es del servicio y la zona del negocio: iguales para
		// todos los profesionales, así que basta fijarlas con el primero elegible
		// aunque no tenga franjas hoy. La rejilla puede variar por profesional
		// (DEC-169): se informa la más fina, la que ningún inicio del
		// agregado contradice.
		result.DurationMinutes = durationMinutes
		result.Timezone = timezone
		if result.SlotGridMinutes == 0 || slotGridMinutes < result.SlotGridMinutes {
			result.SlotGridMinutes = slotGridMinutes
		}
		for _, t := range starts {
			result.Slots = append(result.Slots, ProfessionalAvailabilitySlot{ProfessionalID: professionalID, StartsAt: t})
		}
	}

	sort.Slice(result.Slots, func(i, j int) bool {
		a, b := result.Slots[i], result.Slots[j]
		if !a.StartsAt.Equal(b.StartsAt) {
			return a.StartsAt.Before(b.StartsAt)
		}
		return a.ProfessionalID < b.ProfessionalID
	})
	return result, nil
}

// computeAvailableStarts calcula, para professionalID/durationMinutes YA
// verificados (asignación activa vigente) dentro de businessID, el mismo
// conjunto de inicios públicos válidos que ListPublicAvailability expone
// (HU-094): única fuente de verdad reutilizada tal cual por
// ConfirmationService (HU-097) para revalidar la franja elegida al
// confirmar (CA-097-02) y para calcular alternativas cronológicamente
// cercanas cuando la carrera se pierde (RN-CON-05, DEC-090) — ninguna otra
// copia de esta lógica debe existir en el paquete.
func (s *AvailabilityService) computeAvailableStarts(
	ctx context.Context,
	businessID, professionalID string,
	durationMinutes int,
) (starts []time.Time, timezone string, slotGridMinutes int, err error) {
	return s.computeAvailableStartsExcluding(ctx, businessID, professionalID, durationMinutes, nil)
}

// computeAvailableStartsExcluding es computeAvailableStarts sin contar como
// ocupada la cita cuyo intervalo es exactamente own (HU-104, DEC-178): quien
// reprograma su turno puede moverlo a una franja que se cruza con su hora
// actual. La exclusión de PostgreSQL impide que dos citas del mismo profesional
// compartan intervalo, así que comparar el intervalo identifica una sola
// cita sin exponer su ID a este módulo. own nil no excluye nada.
func (s *AvailabilityService) computeAvailableStartsExcluding(
	ctx context.Context,
	businessID, professionalID string,
	durationMinutes int,
	own *availability.Interval,
) (starts []time.Time, timezone string, slotGridMinutes int, err error) {
	timezone, loc, err := s.businessLocation(ctx, businessID)
	if err != nil {
		return nil, "", 0, err
	}

	minAdvanceMinutes, maxAdvanceDays, slotGridMinutes, err := s.policy.BookingPolicy(ctx, businessID, professionalID)
	if err != nil {
		return nil, "", 0, apperr.Internal(fmt.Errorf("publicbooking: resolver política de reserva para disponibilidad: %w", err))
	}
	if maxAdvanceDays <= 0 || slotGridMinutes <= 0 {
		return nil, "", 0, apperr.Internal(fmt.Errorf("publicbooking: política de reserva con valores no positivos"))
	}

	now := s.clock.Now()
	latestStart := now.AddDate(0, 0, maxAdvanceDays)
	starts, err = s.startsWithin(ctx, businessID, professionalID, durationMinutes, slotGridMinutes, timezone, startsBounds{
		fromDate:      civilDateOnly(now.In(loc)),
		toDate:        civilDateOnly(latestStart.In(loc)),
		earliestStart: now.Add(time.Duration(minAdvanceMinutes) * time.Minute),
		latestStart:   latestStart,
		busyFrom:      now,
		busyTo:        latestStart,
	}, loc, own)
	if err != nil {
		return nil, "", 0, err
	}
	return starts, timezone, slotGridMinutes, nil
}

// startsBounds fija el alcance de un cálculo de inicios: las fechas civiles
// cuyas jornadas y bloqueos se consultan (ambas incluidas), los instantes
// límite de un inicio aceptable (ambos incluidos) y la ventana de citas que
// ocupan agenda. La reserva pública los deriva de su política (anticipación y
// ventana, RN-DIS-04); el turno manual, del tramo de fechas pedido (#717).
type startsBounds struct {
	fromDate, toDate           time.Time
	earliestStart, latestStart time.Time
	busyFrom, busyTo           time.Time
}

// businessLocation resuelve la zona IANA del negocio y su *time.Location.
func (s *AvailabilityService) businessLocation(ctx context.Context, businessID string) (string, *time.Location, error) {
	timezone, err := s.timezones.Timezone(ctx, businessID)
	if err != nil {
		return "", nil, apperr.Internal(fmt.Errorf("publicbooking: resolver zona horaria para disponibilidad: %w", err))
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return "", nil, apperr.Internal(fmt.Errorf("publicbooking: zona horaria irresoluble para disponibilidad: %w", err))
	}
	return timezone, loc, nil
}

// startsWithin es el núcleo único del cálculo de inicios: jornada efectiva
// menos bloqueos y citas que ocupan agenda, en la rejilla del tramo (DEC-135).
// La reserva pública, la confirmación, la reprogramación del cliente y el turno
// manual lo usan con distintos límites; ninguna otra copia debe existir.
func (s *AvailabilityService) startsWithin(
	ctx context.Context,
	businessID, professionalID string,
	durationMinutes, slotGridMinutes int,
	timezone string,
	bounds startsBounds,
	loc *time.Location,
	own *availability.Interval,
) ([]time.Time, error) {
	segments, err := s.resolveSegments(ctx, businessID, professionalID, bounds.fromDate, bounds.toDate, loc)
	if err != nil {
		return nil, err
	}

	busy, err := s.resolveBusyIntervals(ctx, businessID, professionalID, bounds.fromDate, bounds.toDate, timezone, bounds.busyFrom, bounds.busyTo)
	if err != nil {
		return nil, err
	}
	if own != nil {
		busy = withoutOwnAppointment(busy, *own)
	}

	return availability.GenerateStarts(segments, busy, availability.Policy{
		ServiceDuration: time.Duration(durationMinutes) * time.Minute,
		GridStep:        time.Duration(slotGridMinutes) * time.Minute,
		EarliestStart:   bounds.earliestStart,
		LatestStart:     bounds.latestStart,
	}), nil
}

// civilDateOnly trunca t a medianoche civil en su propia ubicación: la
// misma fecha civil que t.Format(civilDateLayout) representaría.
func civilDateOnly(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

// resolveSegments consulta EffectiveDayPort para cada fecha civil de
// [fromDate, toDate] (ambos límites inclusive) y convierte cada tramo
// (hora civil + duración) a un availability.Interval de instantes
// absolutos en loc. No duplica la precedencia excepción manual > festivo
// automático > horario semanal de B2: solo consume su resultado ya
// resuelto.
func (s *AvailabilityService) resolveSegments(ctx context.Context, businessID, professionalID string, fromDate, toDate time.Time, loc *time.Location) ([]availability.Interval, error) {
	var segments []availability.Interval
	for d := fromDate; !d.After(toDate); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format(civilDateLayout)
		isWorking, starts, durations, err := s.effectiveDay.ResolveEffectiveDay(ctx, businessID, professionalID, dateStr)
		if err != nil {
			return nil, apperr.Internal(fmt.Errorf("publicbooking: resolver jornada efectiva para disponibilidad: %w", err))
		}
		if !isWorking {
			continue
		}
		if len(durations) != len(starts) || len(starts) > EffectiveDaySegmentsLimit {
			return nil, apperr.Internal(fmt.Errorf("publicbooking: adaptador de jornada efectiva devolvió una forma inesperada para %s", dateStr))
		}
		for i, startsTime := range starts {
			segStart, err := time.ParseInLocation(civilDateTimeLayout, dateStr+" "+startsTime, loc)
			if err != nil {
				return nil, apperr.Internal(fmt.Errorf("publicbooking: tramo con hora civil inválida (%s %s): %w", dateStr, startsTime, err))
			}
			if durations[i] <= 0 {
				continue
			}
			segEnd := segStart.Add(time.Duration(durations[i]) * time.Minute)
			segments = append(segments, availability.Interval{Start: segStart, End: segEnd})
		}
	}
	return segments, nil
}

// resolveBusyIntervals combina las ocupaciones de BusyBlocksPort (bloqueos,
// RN-BLQ-01 a RN-BLQ-04) con las de AvailabilityRepository.ListOccupiedIntervals
// (citas que ocupan agenda, RN-CON-01/RN-CAN-04) dentro de
// [now, latestStart]: la ventana exacta que puede producir un candidato
// válido (CA-094-05).
func (s *AvailabilityService) resolveBusyIntervals(
	ctx context.Context,
	businessID, professionalID string,
	fromDate, toDate time.Time,
	timezone string,
	now, latestStart time.Time,
) ([]availability.Interval, error) {
	blockStarts, blockEnds, err := s.blocks.BusyIntervals(ctx, businessID, professionalID, fromDate.Format(civilDateLayout), toDate.Format(civilDateLayout), timezone)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("publicbooking: resolver bloqueos para disponibilidad: %w", err))
	}
	if len(blockStarts) != len(blockEnds) {
		return nil, apperr.Internal(fmt.Errorf("publicbooking: adaptador de bloqueos devolvió una forma inesperada"))
	}

	appointmentStarts, appointmentEnds, err := s.repo.ListOccupiedIntervals(ctx, businessID, professionalID, now, latestStart)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("publicbooking: resolver citas para disponibilidad: %w", err))
	}
	if len(appointmentStarts) != len(appointmentEnds) {
		return nil, apperr.Internal(fmt.Errorf("publicbooking: consulta de ocupación devolvió una forma inesperada"))
	}

	busy := make([]availability.Interval, 0, len(blockStarts)+len(appointmentStarts))
	for i := range blockStarts {
		busy = append(busy, availability.Interval{Start: blockStarts[i], End: blockEnds[i]})
	}
	for i := range appointmentStarts {
		busy = append(busy, availability.Interval{Start: appointmentStarts[i], End: appointmentEnds[i]})
	}
	return busy, nil
}

// withoutOwnAppointment quita de busy la ocupación idéntica a own. Solo se
// quita una: si un bloqueo coincide exactamente con el turno, sigue contando
// (el bloqueo existe aunque el turno se mueva).
func withoutOwnAppointment(busy []availability.Interval, own availability.Interval) []availability.Interval {
	out := make([]availability.Interval, 0, len(busy))
	removed := false
	for _, interval := range busy {
		if !removed && interval.Start.Equal(own.Start) && interval.End.Equal(own.End) {
			removed = true
			continue
		}
		out = append(out, interval)
	}
	return out
}

// OfferedRescheduleStarts implementa booking.RescheduleSlotsPort (HU-104,
// DEC-178): los inicios que la reserva pública ofrecería a ese profesional y esa
// duración, sin contar el propio turno como ocupado. No revisa la asignación
// servicio-profesional: el turno ya existe con su snapshot y solo cambia de hora.
func (s *AvailabilityService) OfferedRescheduleStarts(
	ctx context.Context,
	businessID, professionalID string,
	durationMinutes int,
	ownStartsAt, ownEndsAt time.Time,
) ([]time.Time, error) {
	if durationMinutes <= 0 {
		return nil, apperr.Internal(fmt.Errorf("publicbooking: duración no positiva al reprogramar"))
	}
	starts, _, _, err := s.computeAvailableStartsExcluding(ctx, businessID, professionalID, durationMinutes,
		&availability.Interval{Start: ownStartsAt, End: ownEndsAt})
	if err != nil {
		return nil, err
	}
	return starts, nil
}

// ManualStarts implementa booking.ManualSlotsPort (#717): los inicios libres
// para registrar un turno manual entre las fechas civiles fromDate y toDate
// (ambas incluidas, "AAAA-MM-DD" en la zona del negocio). Usa el mismo núcleo
// que la reserva pública (startsWithin) y la rejilla del profesional (DEC-169),
// pero no la anticipación mínima ni la ventana máxima: la cita manual está
// exenta de ambas (RN-DIS-04). Nunca ofrece un inicio en el pasado: el primero
// aceptable es «ahora» truncado al minuto, la precisión con la que la creación
// manual recibe la hora. booking ya verificó la asignación y el formato de las
// fechas; aquí solo se calcula.
//
// excludeStartsAt/excludeEndsAt, si no son cero, son el intervalo del turno que
// se reprograma (#776): sale de la ocupación con withoutOwnAppointment, igual que
// en OfferedRescheduleStarts (HU-104). booking ya verificó que sea un turno
// confirmado de este negocio, profesional y servicio, y pasa su duración.
func (s *AvailabilityService) ManualStarts(
	ctx context.Context,
	businessID, professionalID string,
	durationMinutes int,
	fromDate, toDate string,
	excludeStartsAt, excludeEndsAt time.Time,
) (starts []time.Time, timezone string, slotGridMinutes int, err error) {
	if durationMinutes <= 0 {
		return nil, "", 0, apperr.Internal(fmt.Errorf("publicbooking: duración no positiva para el turno manual"))
	}
	timezone, loc, err := s.businessLocation(ctx, businessID)
	if err != nil {
		return nil, "", 0, err
	}

	_, _, slotGridMinutes, err = s.policy.BookingPolicy(ctx, businessID, professionalID)
	if err != nil {
		return nil, "", 0, apperr.Internal(fmt.Errorf("publicbooking: resolver la rejilla para el turno manual: %w", err))
	}
	if slotGridMinutes <= 0 {
		return nil, "", 0, apperr.Internal(fmt.Errorf("publicbooking: rejilla no positiva para el turno manual"))
	}

	from, err := time.ParseInLocation(civilDateLayout, fromDate, loc)
	if err != nil {
		return nil, "", 0, apperr.Internal(fmt.Errorf("publicbooking: fecha inicial inválida para el turno manual: %w", err))
	}
	to, err := time.ParseInLocation(civilDateLayout, toDate, loc)
	if err != nil {
		return nil, "", 0, apperr.Internal(fmt.Errorf("publicbooking: fecha final inválida para el turno manual: %w", err))
	}

	// Medianoche civil del día siguiente a toDate, con time.Date (no +24 h)
	// para respetar días de 23 o 25 horas (RN-DIS-07). LatestStart es
	// inclusivo, así que el último inicio aceptable es un instante antes.
	rangeStart := civilDateOnly(from)
	rangeEnd := time.Date(to.Year(), to.Month(), to.Day()+1, 0, 0, 0, 0, loc)
	earliest := rangeStart
	if now := s.clock.Now().Truncate(time.Minute); now.After(earliest) {
		earliest = now
	}

	var own *availability.Interval
	if !excludeStartsAt.IsZero() && excludeEndsAt.After(excludeStartsAt) {
		own = &availability.Interval{Start: excludeStartsAt, End: excludeEndsAt}
	}

	starts, err = s.startsWithin(ctx, businessID, professionalID, durationMinutes, slotGridMinutes, timezone, startsBounds{
		fromDate:      rangeStart,
		toDate:        civilDateOnly(to),
		earliestStart: earliest,
		latestStart:   rangeEnd.Add(-time.Nanosecond),
		busyFrom:      earliest,
		busyTo:        rangeEnd.Add(time.Duration(durationMinutes) * time.Minute),
	}, loc, own)
	if err != nil {
		return nil, "", 0, err
	}
	return starts, timezone, slotGridMinutes, nil
}
