package booking_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
)

// fakeAgendaProfessionalPort es un doble de booking.ProfessionalPort para probar
// AgendaService en aislamiento, sin PostgreSQL real (esa cobertura vive en
// postgres/agenda_repository_test.go).
type fakeAgendaProfessionalPort struct {
	exists bool
	err    error
}

func (f fakeAgendaProfessionalPort) Exists(context.Context, string, string) (bool, error) {
	return f.exists, f.err
}

// fakeClock es un doble de clock.Clock que siempre devuelve el mismo
// instante fijo, para que "hoy" sea determinista en las pruebas.
type fakeClock struct {
	now time.Time
}

func (f fakeClock) Now() time.Time { return f.now }

// fakeAgendaRepository es un doble de booking.Repository que solo implementa
// ListDailyAgenda: las demás operaciones nunca deben llamarse desde
// AgendaService.
type fakeAgendaRepository struct {
	fakeManualRepository

	lastBusinessID     string
	lastProfessionalID string
	lastRangeStart     time.Time
	lastRangeEnd       time.Time
	entries            []booking.DailyAgendaEntry
	err                error
}

func (f *fakeAgendaRepository) ListDailyAgenda(
	_ context.Context, businessID, professionalID string, rangeStart, rangeEnd time.Time,
) ([]booking.DailyAgendaEntry, error) {
	f.lastBusinessID = businessID
	f.lastProfessionalID = professionalID
	f.lastRangeStart = rangeStart
	f.lastRangeEnd = rangeEnd
	if f.err != nil {
		return nil, f.err
	}
	return f.entries, nil
}

const validAgendaProfessionalID = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"

func TestListDailyAgenda_EmptyDate_DefaultsToTodayInBusinessZone(t *testing.T) {
	// El reloj marca 2026-08-29T02:30:00Z: "hoy" en UTC sería el 29, pero en
	// America/Bogota (UTC-5) todavía es el 28 (RN-DIS-07: nunca la zona del
	// servidor o del dispositivo).
	clk := fakeClock{now: time.Date(2026, 8, 29, 2, 30, 0, 0, time.UTC)}
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "America/Bogota"}, clk)

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "")
	if err != nil {
		t.Fatalf("err inesperado: %v", err)
	}

	loc := mustLoadLocation(t, "America/Bogota")
	wantStart := time.Date(2026, 8, 28, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 8, 29, 0, 0, 0, 0, loc)
	if !repo.lastRangeStart.Equal(wantStart) {
		t.Fatalf("rangeStart = %v, want %v", repo.lastRangeStart, wantStart)
	}
	if !repo.lastRangeEnd.Equal(wantEnd) {
		t.Fatalf("rangeEnd = %v, want %v", repo.lastRangeEnd, wantEnd)
	}
}

func TestListDailyAgenda_ExplicitDate_ComputesCivilRangeInBusinessZone(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "America/Bogota"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "2026-09-03")
	if err != nil {
		t.Fatalf("err inesperado: %v", err)
	}

	loc := mustLoadLocation(t, "America/Bogota")
	wantStart := time.Date(2026, 9, 3, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 9, 4, 0, 0, 0, 0, loc)
	if !repo.lastRangeStart.Equal(wantStart) || !repo.lastRangeEnd.Equal(wantEnd) {
		t.Fatalf("rango = [%v, %v), want [%v, %v)", repo.lastRangeStart, repo.lastRangeEnd, wantStart, wantEnd)
	}
}

// TestListDailyAgenda_DSTSpringForward_DayRangeIsNotFixed24Hours verifica
// que el rango civil se calcula con time.Date en la zona, nunca sumando 24h
// fijas: el 8 de marzo de 2026, America/New_York adelanta el reloj (día
// local de 23 horas), así que rangeEnd - rangeStart debe ser 23h, no 24h.
func TestListDailyAgenda_DSTSpringForward_DayRangeIsNotFixed24Hours(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "America/New_York"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "2026-03-08")
	if err != nil {
		t.Fatalf("err inesperado: %v", err)
	}

	got := repo.lastRangeEnd.Sub(repo.lastRangeStart)
	if got != 23*time.Hour {
		t.Fatalf("duración del día local = %v, want 23h (cambio de horario de verano)", got)
	}
}

func TestListDailyAgenda_InvalidDateFormat_RejectsAsInvalid(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "America/Bogota"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "2026/09/03")
	assertKind(t, err, apperr.KindInvalid)
	if repo.lastProfessionalID != "" {
		t.Fatalf("no debió tocar el repositorio con una fecha inválida")
	}
}

func TestListDailyAgenda_DateWithTimeSuffix_RejectsAsInvalid(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "America/Bogota"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "2026-09-03T00:00:00")
	assertKind(t, err, apperr.KindInvalid)
}

func TestListDailyAgenda_MalformedProfessionalID_RejectsWithoutTouchingPorts(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{err: errUnexpectedCall(t)}, fakeTimezonePort{err: errUnexpectedCall(t)}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", "not-a-uuid", "")
	assertKind(t, err, apperr.KindNotFound)
}

func TestListDailyAgenda_ProfessionalDoesNotExist_ReturnsNotFound(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: false}, fakeTimezonePort{timezone: "America/Bogota"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "")
	assertKind(t, err, apperr.KindNotFound)
	if repo.lastProfessionalID != "" {
		t.Fatalf("no debió tocar el repositorio con un profesional inexistente")
	}
}

func TestListDailyAgenda_ProfessionalPortError_ReturnsInternal(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{err: errors.New("boom")}, fakeTimezonePort{timezone: "America/Bogota"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "")
	assertKind(t, err, apperr.KindInternal)
}

func TestListDailyAgenda_TimezonePortError_Propagates(t *testing.T) {
	repo := &fakeAgendaRepository{}
	wantErr := apperr.Internal(errors.New("shops: fallo simulado"))
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{err: wantErr}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "")
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
}

func TestListDailyAgenda_UnresolvableTimezone_ReturnsInternal(t *testing.T) {
	repo := &fakeAgendaRepository{}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "Not/AZone"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "")
	assertKind(t, err, apperr.KindInternal)
}

func TestListDailyAgenda_RepositoryError_ReturnsInternal(t *testing.T) {
	repo := &fakeAgendaRepository{err: errors.New("boom")}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "America/Bogota"}, fakeClock{now: time.Now()})

	_, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "")
	assertKind(t, err, apperr.KindInternal)
}

func TestListDailyAgenda_ValidRequest_ReturnsRepositoryEntriesInOrder(t *testing.T) {
	want := []booking.DailyAgendaEntry{
		{ID: "appt-1", AttendeeName: "Carlos"},
		{ID: "appt-2", AttendeeName: "Ana"},
	}
	repo := &fakeAgendaRepository{entries: want}
	svc := booking.NewAgendaService(repo, fakeAgendaProfessionalPort{exists: true}, fakeTimezonePort{timezone: "America/Bogota"}, fakeClock{now: time.Now()})

	got, err := svc.ListDailyAgenda(context.Background(), "shop-1", validAgendaProfessionalID, "2026-08-28")
	if err != nil {
		t.Fatalf("err inesperado: %v", err)
	}
	if len(got) != 2 || got[0].ID != "appt-1" || got[1].ID != "appt-2" {
		t.Fatalf("entries = %+v, want %+v", got, want)
	}
	if repo.lastBusinessID != "shop-1" || repo.lastProfessionalID != validAgendaProfessionalID {
		t.Fatalf("repo llamado con tenant/profesional inesperados: %q/%q", repo.lastBusinessID, repo.lastProfessionalID)
	}
}
