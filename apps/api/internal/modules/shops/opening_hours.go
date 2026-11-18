package shops

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"system-barbershop/internal/platform/apperr"
)

// MaxOpeningSegmentsPerDay es cuántos tramos admite un día del horario del
// local (HU-107, CA-107-02). Cuatro cubre la jornada partida más rara sin que
// el formulario se convierta en una agenda.
const MaxOpeningSegmentsPerDay = 4

// minutesPerDay es el cierre máximo: 24:00, «hasta medianoche».
const minutesPerDay = 24 * 60

// Weekday es el día ISO 8601 de la semana: 1 = lunes … 7 = domingo, igual que
// `working_hour.iso_weekday` y `barbershop_opening_hour.iso_weekday`.
type Weekday int

// weekdayNames son los nombres del contrato (`MONDAY` … `SUNDAY`), en orden ISO.
var weekdayNames = [...]string{"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"}

// ParseWeekday traduce el nombre del contrato al día ISO.
func ParseWeekday(name string) (Weekday, bool) {
	for i, n := range weekdayNames {
		if n == name {
			return Weekday(i + 1), true
		}
	}
	return 0, false
}

// String devuelve el nombre del contrato; "" para un día fuera de rango.
func (d Weekday) String() string {
	if d < 1 || d > 7 {
		return ""
	}
	return weekdayNames[d-1]
}

// ClockMinutes es una hora civil del día en minutos desde medianoche, de 0
// (00:00) a 1440 (24:00). Se interpreta con la zona horaria de la barbería.
type ClockMinutes int

// ParseClock lee `HH:MM` estricto: dos dígitos, dos puntos, dos dígitos, de
// 00:00 a 24:00. Rechaza segundos, signos y espacios.
func ParseClock(raw string) (ClockMinutes, bool) {
	if len(raw) != 5 || raw[2] != ':' {
		return 0, false
	}
	hh, mm := raw[:2], raw[3:]
	if strings.IndexFunc(hh+mm, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return 0, false
	}
	h, _ := strconv.Atoi(hh)
	m, _ := strconv.Atoi(mm)
	if m > 59 || h > 24 || (h == 24 && m != 0) {
		return 0, false
	}
	return ClockMinutes(h*60 + m), true
}

// String devuelve `HH:MM`; 1440 es `24:00`.
func (c ClockMinutes) String() string {
	return fmt.Sprintf("%02d:%02d", int(c)/60, int(c)%60)
}

// OpeningSegment es un tramo de apertura del local: `[Opens, Closes)` dentro
// del mismo día. Un horario que pasa de medianoche son dos tramos (DEC-182).
type OpeningSegment struct {
	Weekday Weekday
	Opens   ClockMinutes
	Closes  ClockMinutes
}

// OpeningHours es el horario de atención del local (HU-107, DEC-182). Un día
// sin tramos está cerrado; Segments va ordenado por día y apertura. Es
// informativo: no limita la disponibilidad de los barberos.
type OpeningHours struct {
	Segments         []OpeningSegment
	ClosedOnHolidays bool
}

// OpeningHoursRepository es el puerto de persistencia del horario del local.
type OpeningHoursRepository interface {
	// Get lee el horario de barbershopID en una transacción tenant-aware.
	// found=false cubre una barbería no visible en el tenant vigente.
	Get(ctx context.Context, barbershopID string) (hours OpeningHours, found bool, err error)
	// Replace sustituye la semana completa y closed_on_holidays en UNA
	// transacción: o queda el horario nuevo entero o el anterior. Sin versión de
	// concurrencia: es una preferencia del negocio y la última escritura gana,
	// como la anticipación del recordatorio (DEC-174).
	Replace(ctx context.Context, barbershopID string, hours OpeningHours) (stored OpeningHours, found bool, err error)
}

// OpeningHoursService lee y cambia el horario del local de la sesión. El
// negocio llega siempre de un auth.Principal: no hay forma de leer o cambiar
// el de otro (RN-TEN-01).
type OpeningHoursService struct {
	repo OpeningHoursRepository
}

// NewOpeningHoursService construye el servicio.
func NewOpeningHoursService(repo OpeningHoursRepository) *OpeningHoursService {
	return &OpeningHoursService{repo: repo}
}

// Get lee el horario vigente.
func (s *OpeningHoursService) Get(ctx context.Context, barbershopID string) (OpeningHours, error) {
	if err := ctx.Err(); err != nil {
		return OpeningHours{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de leer el horario del local: %w", err))
	}
	hours, found, err := s.repo.Get(ctx, barbershopID)
	if err != nil {
		return OpeningHours{}, apperr.Internal(fmt.Errorf("shops: leer horario del local: %w", err))
	}
	if !found {
		return OpeningHours{}, apperr.NotFound("negocio no encontrado")
	}
	return hours, nil
}

// Replace valida el horario completo y lo guarda. Cualquier tramo inválido
// rechaza todo con 422 sin tocar la base (CA-107-02).
func (s *OpeningHoursService) Replace(ctx context.Context, barbershopID string, hours OpeningHours) (OpeningHours, error) {
	if err := ctx.Err(); err != nil {
		return OpeningHours{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de guardar el horario del local: %w", err))
	}
	normalized, err := NormalizeOpeningHours(hours)
	if err != nil {
		return OpeningHours{}, err
	}
	stored, found, err := s.repo.Replace(ctx, barbershopID, normalized)
	if err != nil {
		return OpeningHours{}, apperr.Internal(fmt.Errorf("shops: guardar horario del local: %w", err))
	}
	if !found {
		return OpeningHours{}, apperr.NotFound("negocio no encontrado")
	}
	return stored, nil
}

// NormalizeOpeningHours ordena los tramos por día y apertura y valida que
// cada uno cierre después de abrir, que no se solapen dentro del día y que
// ningún día pase de MaxOpeningSegmentsPerDay. Dos tramos contiguos
// (12:00–14:00 y 14:00–18:00) no se solapan: los intervalos son semiabiertos
// (DEC-020).
func NormalizeOpeningHours(hours OpeningHours) (OpeningHours, error) {
	segments := append([]OpeningSegment(nil), hours.Segments...)
	for _, seg := range segments {
		if seg.Weekday < 1 || seg.Weekday > 7 {
			return OpeningHours{}, apperr.Validation("dayOfWeek debe ser un día de MONDAY a SUNDAY")
		}
		if seg.Opens < 0 || seg.Closes > minutesPerDay || seg.Closes <= seg.Opens {
			return OpeningHours{}, apperr.Validation(fmt.Sprintf(
				"%s: el cierre (%s) debe ser posterior a la apertura (%s)", seg.Weekday, seg.Closes, seg.Opens))
		}
	}
	sort.Slice(segments, func(i, j int) bool {
		if segments[i].Weekday != segments[j].Weekday {
			return segments[i].Weekday < segments[j].Weekday
		}
		return segments[i].Opens < segments[j].Opens
	})
	perDay := 0
	for i, seg := range segments {
		if i > 0 && segments[i-1].Weekday == seg.Weekday {
			perDay++
			prev := segments[i-1]
			if seg.Opens < prev.Closes {
				return OpeningHours{}, apperr.Validation(fmt.Sprintf(
					"%s: los tramos %s–%s y %s–%s se solapan", seg.Weekday, prev.Opens, prev.Closes, seg.Opens, seg.Closes))
			}
		} else {
			perDay = 1
		}
		if perDay > MaxOpeningSegmentsPerDay {
			return OpeningHours{}, apperr.Validation(fmt.Sprintf(
				"%s: un día admite como máximo %d tramos", seg.Weekday, MaxOpeningSegmentsPerDay))
		}
	}
	return OpeningHours{Segments: segments, ClosedOnHolidays: hours.ClosedOnHolidays}, nil
}
