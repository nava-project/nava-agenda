package publicbooking_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
)

var bogota = func() *time.Location {
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		panic(err)
	}
	return loc
}()

// Lunes partido, martes corrido, viernes hasta medianoche.
var week = []publicbooking.OpeningSegment{
	{Weekday: 1, Opens: 9 * 60, Closes: 12 * 60},
	{Weekday: 1, Opens: 14 * 60, Closes: 19 * 60},
	{Weekday: 2, Opens: 9 * 60, Closes: 19 * 60},
	{Weekday: 5, Opens: 20 * 60, Closes: 24 * 60},
}

func cartagena(date time.Time) (string, bool) {
	if date.Month() == time.November && date.Day() == 16 && date.Year() == 2026 {
		return "Independencia de Cartagena", true
	}
	return "", false
}

func TestTodayOpening_NilWithoutAWeek(t *testing.T) {
	if got := publicbooking.TodayOpening(nil, true, time.Now(), bogota, cartagena); got != nil {
		t.Fatalf("sin horario no se sabe: debe ser nil, got %+v", got)
	}
}

// CA-107-05: la fecha es la civil del local, no la del servidor. A las 23:30
// del martes en Bogotá ya es miércoles en UTC.
func TestTodayOpening_UsesTheShopsCivilDate(t *testing.T) {
	now := time.Date(2026, 11, 18, 4, 30, 0, 0, time.UTC) // martes 17, 23:30 en Bogotá
	got := publicbooking.TodayOpening(week, false, now, bogota, nil)
	if got == nil || got.Date.Format(time.DateOnly) != "2026-11-17" || got.Weekday != 2 {
		t.Fatalf("debe ser el martes 17: %+v", got)
	}
	if len(got.Hours) != 1 || got.Hours[0].Opens != 9*60 || got.Holiday != nil {
		t.Fatalf("tramos del martes: %+v", got)
	}
}

func TestTodayOpening_ADayWithoutSegmentsIsClosed(t *testing.T) {
	now := time.Date(2026, 11, 22, 15, 0, 0, 0, bogota) // domingo
	got := publicbooking.TodayOpening(week, false, now, bogota, nil)
	if got == nil || got.Weekday != 7 || got.Hours == nil || len(got.Hours) != 0 {
		t.Fatalf("domingo sin tramos: hours vacío y no nil, got %+v", got)
	}
}

func TestTodayOpening_HolidayClosesOnlyWhenTheShopSaysSo(t *testing.T) {
	now := time.Date(2026, 11, 16, 10, 0, 0, 0, bogota) // lunes festivo
	closed := publicbooking.TodayOpening(week, true, now, bogota, cartagena)
	if closed.Holiday == nil || *closed.Holiday != "Independencia de Cartagena" || len(closed.Hours) != 0 {
		t.Fatalf("festivo con el local cerrado en festivos: %+v", closed)
	}
	open := publicbooking.TodayOpening(week, false, now, bogota, cartagena)
	if open.Holiday == nil || len(open.Hours) != 2 {
		t.Fatalf("festivo con el local abierto: nombre y los dos tramos del lunes, got %+v", open)
	}
}

func TestResolveBusiness_FillsTodayWithTheInjectedCalendar(t *testing.T) {
	repo := &fakeRepository{found: true, profile: publicbooking.BusinessProfile{
		Name: "Barbería Ejemplo", Timezone: "America/Bogota", OpeningHours: week, ClosedOnHolidays: true,
	}}
	now := func() time.Time { return time.Date(2026, 11, 16, 10, 0, 0, 0, bogota) }
	got, err := publicbooking.NewService(repo).WithOpeningCalendar(now, cartagena).
		ResolveBusiness(context.Background(), "barberia-ejemplo")
	if err != nil {
		t.Fatalf("ResolveBusiness: %v", err)
	}
	if got.Today == nil || got.Today.Holiday == nil || len(got.Today.Hours) != 0 {
		t.Fatalf("hoy es festivo y el local cierra: %+v", got.Today)
	}
}
