package shops_test

import (
	"context"
	"errors"
	"testing"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/apperr"
)

type fakeOpeningHoursRepo struct {
	hours    shops.OpeningHours
	replaces int
}

func (f *fakeOpeningHoursRepo) Get(context.Context, string) (shops.OpeningHours, bool, error) {
	return f.hours, true, nil
}

func (f *fakeOpeningHoursRepo) Replace(_ context.Context, _ string, hours shops.OpeningHours) (shops.OpeningHours, bool, error) {
	f.replaces++
	f.hours = hours
	return hours, true, nil
}

func seg(day shops.Weekday, opens, closes string) shops.OpeningSegment {
	o, ok := shops.ParseClock(opens)
	c, ok2 := shops.ParseClock(closes)
	if !ok || !ok2 {
		panic("hora de prueba mal escrita: " + opens + "–" + closes)
	}
	return shops.OpeningSegment{Weekday: day, Opens: o, Closes: c}
}

func TestParseClock_IsStrictHHMMUpToMidnight(t *testing.T) {
	for raw, want := range map[string]shops.ClockMinutes{"00:00": 0, "09:30": 570, "23:59": 1439, "24:00": 1440} {
		got, ok := shops.ParseClock(raw)
		if !ok || got != want {
			t.Errorf("%q: got %d ok=%v, want %d", raw, got, ok, want)
		}
		if got.String() != raw {
			t.Errorf("%q no vuelve igual: %q", raw, got.String())
		}
	}
	for _, bad := range []string{"", "9:00", "09:00:00", "24:01", "25:00", "12:60", "-1:00", " 9:00", "ab:cd", "0900"} {
		if _, ok := shops.ParseClock(bad); ok {
			t.Errorf("%q no debe aceptarse", bad)
		}
	}
}

func TestParseWeekday_UsesTheContractNames(t *testing.T) {
	if d, ok := shops.ParseWeekday("MONDAY"); !ok || d != 1 {
		t.Fatalf("MONDAY: %d %v", d, ok)
	}
	if d, ok := shops.ParseWeekday("SUNDAY"); !ok || d != 7 || d.String() != "SUNDAY" {
		t.Fatalf("SUNDAY: %d %v", d, ok)
	}
	for _, bad := range []string{"monday", "LUNES", "", "MON"} {
		if _, ok := shops.ParseWeekday(bad); ok {
			t.Errorf("%q no debe aceptarse", bad)
		}
	}
}

func TestNormalizeOpeningHours_SortsAndAcceptsSplitAndMidnightDays(t *testing.T) {
	got, err := shops.NormalizeOpeningHours(shops.OpeningHours{
		Segments: []shops.OpeningSegment{
			seg(6, "00:00", "02:00"),
			seg(1, "14:00", "19:00"),
			seg(5, "20:00", "24:00"),
			seg(1, "09:00", "14:00"), // contiguo al de la tarde: no se solapa
		},
		ClosedOnHolidays: true,
	})
	if err != nil {
		t.Fatalf("un horario válido no debe rechazarse: %v", err)
	}
	want := []shops.OpeningSegment{seg(1, "09:00", "14:00"), seg(1, "14:00", "19:00"), seg(5, "20:00", "24:00"), seg(6, "00:00", "02:00")}
	for i := range want {
		if got.Segments[i] != want[i] {
			t.Fatalf("orden: got %+v, want %+v", got.Segments, want)
		}
	}
	if !got.ClosedOnHolidays {
		t.Fatal("closedOnHolidays se pierde al normalizar")
	}
}

func TestNormalizeOpeningHours_RejectsInvalidSegments(t *testing.T) {
	cases := map[string][]shops.OpeningSegment{
		"cierre igual a la apertura":  {seg(1, "09:00", "09:00")},
		"cierre antes de la apertura": {seg(1, "19:00", "09:00")},
		"día fuera de rango":          {{Weekday: 8, Opens: 540, Closes: 600}},
		"solape parcial":              {seg(2, "09:00", "13:00"), seg(2, "12:00", "18:00")},
		"misma apertura":              {seg(2, "09:00", "13:00"), seg(2, "09:00", "10:00")},
		"cinco tramos en un día": {
			seg(3, "06:00", "07:00"), seg(3, "08:00", "09:00"), seg(3, "10:00", "11:00"),
			seg(3, "12:00", "13:00"), seg(3, "14:00", "15:00"),
		},
	}
	for name, segments := range cases {
		_, err := shops.NormalizeOpeningHours(shops.OpeningHours{Segments: segments})
		var appErr *apperr.Error
		if !errors.As(err, &appErr) || appErr.Kind != apperr.KindValidation {
			t.Errorf("%s: debe ser un error de validación, got %v", name, err)
		}
	}
}

func TestNormalizeOpeningHours_FourSegmentsADayAreFine(t *testing.T) {
	_, err := shops.NormalizeOpeningHours(shops.OpeningHours{Segments: []shops.OpeningSegment{
		seg(3, "06:00", "07:00"), seg(3, "08:00", "09:00"), seg(3, "10:00", "11:00"), seg(3, "12:00", "13:00"),
		seg(4, "06:00", "07:00"),
	}})
	if err != nil {
		t.Fatalf("cuatro tramos en un día son el máximo admitido: %v", err)
	}
}

func TestOpeningHoursService_RejectsWithoutTouchingTheStore(t *testing.T) {
	repo := &fakeOpeningHoursRepo{}
	_, err := shops.NewOpeningHoursService(repo).Replace(context.Background(), "shop", shops.OpeningHours{
		Segments: []shops.OpeningSegment{seg(1, "10:00", "09:00")},
	})
	if err == nil || repo.replaces != 0 {
		t.Fatalf("un horario inválido no llega al repositorio (err=%v, replaces=%d)", err, repo.replaces)
	}
}

func TestOpeningHoursService_StoresTheNormalizedWeek(t *testing.T) {
	repo := &fakeOpeningHoursRepo{}
	got, err := shops.NewOpeningHoursService(repo).Replace(context.Background(), "shop", shops.OpeningHours{
		Segments: []shops.OpeningSegment{seg(2, "14:00", "18:00"), seg(2, "08:00", "12:00")},
	})
	if err != nil || repo.replaces != 1 || got.Segments[0].Opens != 480 {
		t.Fatalf("got=%+v replaces=%d err=%v", got, repo.replaces, err)
	}
}
