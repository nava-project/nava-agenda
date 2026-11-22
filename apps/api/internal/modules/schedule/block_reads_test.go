package schedule_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"nava-agenda/internal/modules/schedule"
	"nava-agenda/internal/platform/apperr"
)

// Lecturas y subrecursos de bloqueos, series y excepciones (HU-041, HU-042):
// el caso de uso rechaza ids malformados sin tocar el repositorio, traduce
// «no encontrado» y conflictos del repositorio a errores del contrato y nunca
// disfraza un fallo de infraestructura de rechazo de negocio (CP-NF07).

const validBlockID = "1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0"

var errRepoDown = errors.New("conexión perdida")

func mustBeKind(t *testing.T, err error, want apperr.Kind) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != want {
		t.Fatalf("expected %v, got %v", want, err)
	}
}

func TestListBlocks_ClampsLimitAndPassesThroughThePage(t *testing.T) {
	for _, tc := range []struct{ in, want int }{{0, schedule.DefaultListLimit}, {-3, schedule.DefaultListLimit}, {10000, schedule.MaxListLimit}} {
		var gotLimit int
		var gotDeleted bool
		repo := &fakeRepository{listBlocksFn: func(_ context.Context, _, _ string, cursor *schedule.BlockCursor, limit int, includeDeleted bool) (schedule.BlockListResult, error) {
			if cursor != nil {
				t.Fatal("sin cursor no debe decodificarse ninguno")
			}
			gotLimit, gotDeleted = limit, includeDeleted
			return schedule.BlockListResult{Items: []schedule.TimeBlock{{ID: "b-1"}}, NextCursor: "next"}, nil
		}}
		got, err := schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListBlocks(context.Background(), "shop-1", validProfessionalID, "", tc.in, true)
		if err != nil {
			t.Fatalf("ListBlocks(limit=%d): %v", tc.in, err)
		}
		if gotLimit != tc.want || !gotDeleted || len(got.Items) != 1 || got.NextCursor != "next" {
			t.Fatalf("limit %d → %d (want %d), includeDeleted=%v, result %+v", tc.in, gotLimit, tc.want, gotDeleted, got)
		}
	}
}

func TestListBlocks_RejectionsNeverReachTheRepository(t *testing.T) {
	repo := &fakeRepository{listBlocksFn: func(context.Context, string, string, *schedule.BlockCursor, int, bool) (schedule.BlockListResult, error) {
		t.Fatal("el repositorio no debe llamarse")
		return schedule.BlockListResult{}, nil
	}}
	ctx := context.Background()
	_, err := schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListBlocks(ctx, "shop-1", "no-uuid", "", 10, false)
	mustBeNotFound(t, err)
	_, err = schedule.NewService(repo, fakeProfessionalPort{exists: false}).ListBlocks(ctx, "shop-1", validProfessionalID, "", 10, false)
	mustBeNotFound(t, err)
	_, err = schedule.NewService(repo, fakeProfessionalPort{err: errRepoDown}).ListBlocks(ctx, "shop-1", validProfessionalID, "", 10, false)
	mustBeKind(t, err, apperr.KindInternal)
	if _, err = schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListBlocks(ctx, "shop-1", validProfessionalID, "cursor-roto", 10, false); err == nil {
		t.Fatal("un cursor ilegible debe rechazarse")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListBlocks(cancelled, "shop-1", validProfessionalID, "", 10, false)
	mustBeKind(t, err, apperr.KindInternal)
}

func TestListBlocks_RepositoryFailure_IsInternal(t *testing.T) {
	repo := &fakeRepository{listBlocksFn: func(context.Context, string, string, *schedule.BlockCursor, int, bool) (schedule.BlockListResult, error) {
		return schedule.BlockListResult{}, errRepoDown
	}}
	_, err := schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListBlocks(context.Background(), "shop-1", validProfessionalID, "", 10, false)
	mustBeKind(t, err, apperr.KindInternal)
}

func TestGetBlock_FoundNotFoundAndFailures(t *testing.T) {
	ctx := context.Background()
	block := schedule.TimeBlock{ID: validBlockID, BlockType: "lunch"}
	for _, tc := range []struct {
		name    string
		blockID string
		found   bool
		repoErr error
		want    apperr.Kind
	}{
		{"id malformado", "no-uuid", false, nil, apperr.KindNotFound},
		{"no existe o es de otro negocio", validBlockID, false, nil, apperr.KindNotFound},
		{"fallo del repositorio", validBlockID, false, errRepoDown, apperr.KindInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{getBlockFn: func(context.Context, string, string, string) (schedule.TimeBlock, bool, error) {
				return schedule.TimeBlock{}, tc.found, tc.repoErr
			}}
			_, err := schedule.NewService(repo, fakeProfessionalPort{}).GetBlock(ctx, "shop-1", validProfessionalID, tc.blockID)
			mustBeKind(t, err, tc.want)
		})
	}
	repo := &fakeRepository{getBlockFn: func(context.Context, string, string, string) (schedule.TimeBlock, bool, error) {
		return block, true, nil
	}}
	got, err := schedule.NewService(repo, fakeProfessionalPort{}).GetBlock(ctx, "shop-1", validProfessionalID, validBlockID)
	if err != nil || got.ID != validBlockID {
		t.Fatalf("GetBlock = %+v, %v", got, err)
	}
}

func TestListSeries_ClampsLimitAndRejectsUnknownProfessional(t *testing.T) {
	ctx := context.Background()
	var gotLimit int
	repo := &fakeRepository{listSeriesFn: func(_ context.Context, _, _ string, _ *schedule.SeriesCursor, limit int, _ bool) (schedule.SeriesListResult, error) {
		gotLimit = limit
		return schedule.SeriesListResult{Items: []schedule.TimeBlockSeries{{ID: validSeriesID}}}, nil
	}}
	got, err := schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListSeries(ctx, "shop-1", validProfessionalID, "", 0, false)
	if err != nil || gotLimit != schedule.DefaultListLimit || len(got.Items) != 1 {
		t.Fatalf("ListSeries = %+v (limit %d), %v", got, gotLimit, err)
	}
	_, err = schedule.NewService(repo, fakeProfessionalPort{exists: false}).ListSeries(ctx, "shop-1", validProfessionalID, "", 10, false)
	mustBeNotFound(t, err)
	_, err = schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListSeries(ctx, "shop-1", "no-uuid", "", 10, false)
	mustBeNotFound(t, err)
	_, err = schedule.NewService(repo, fakeProfessionalPort{err: errRepoDown}).ListSeries(ctx, "shop-1", validProfessionalID, "", 10, false)
	mustBeKind(t, err, apperr.KindInternal)
	if _, err = schedule.NewService(repo, fakeProfessionalPort{exists: true}).ListSeries(ctx, "shop-1", validProfessionalID, "cursor-roto", 10, false); err == nil {
		t.Fatal("un cursor ilegible debe rechazarse")
	}

	failing := &fakeRepository{listSeriesFn: func(context.Context, string, string, *schedule.SeriesCursor, int, bool) (schedule.SeriesListResult, error) {
		return schedule.SeriesListResult{}, errRepoDown
	}}
	_, err = schedule.NewService(failing, fakeProfessionalPort{exists: true}).ListSeries(ctx, "shop-1", validProfessionalID, "", 10, false)
	mustBeKind(t, err, apperr.KindInternal)
}

func TestGetAndDeleteSeries_TranslateRepositoryOutcomes(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name     string
		seriesID string
		found    bool
		repoErr  error
		want     apperr.Kind
	}{
		{"id malformado", "no-uuid", true, nil, apperr.KindNotFound},
		{"no existe", validSeriesID, false, nil, apperr.KindNotFound},
		{"fallo del repositorio", validSeriesID, false, errRepoDown, apperr.KindInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{
				getSeriesFn: func(context.Context, string, string, string) (schedule.TimeBlockSeries, bool, error) {
					return schedule.TimeBlockSeries{}, tc.found, tc.repoErr
				},
				deleteSeriesFn: func(context.Context, string, string, string) (bool, error) { return tc.found, tc.repoErr },
			}
			svc := schedule.NewService(repo, fakeProfessionalPort{})
			_, err := svc.GetSeries(ctx, "shop-1", validProfessionalID, tc.seriesID)
			mustBeKind(t, err, tc.want)
			mustBeKind(t, svc.DeleteSeries(ctx, "shop-1", validProfessionalID, tc.seriesID), tc.want)
		})
	}

	repo := &fakeRepository{
		getSeriesFn: func(context.Context, string, string, string) (schedule.TimeBlockSeries, bool, error) {
			return schedule.TimeBlockSeries{ID: validSeriesID}, true, nil
		},
		deleteSeriesFn: func(context.Context, string, string, string) (bool, error) { return true, nil },
	}
	svc := schedule.NewService(repo, fakeProfessionalPort{})
	if got, err := svc.GetSeries(ctx, "shop-1", validProfessionalID, validSeriesID); err != nil || got.ID != validSeriesID {
		t.Fatalf("GetSeries = %+v, %v", got, err)
	}
	if err := svc.DeleteSeries(ctx, "shop-1", validProfessionalID, validSeriesID); err != nil {
		t.Fatalf("DeleteSeries: %v", err)
	}
}

func TestRemoveSeriesDate_ValidatesTheDateAndTranslatesNotFound(t *testing.T) {
	ctx := context.Background()
	var gotDate string
	repo := &fakeRepository{removeSeriesDateFn: func(_ context.Context, _, _, _, date string) (bool, error) {
		gotDate = date
		return date == "2026-07-20", nil
	}}
	svc := schedule.NewService(repo, fakeProfessionalPort{})
	if err := svc.RemoveSeriesDate(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-20"); err != nil || gotDate != "2026-07-20" {
		t.Fatalf("RemoveSeriesDate: %v (fecha %q)", err, gotDate)
	}
	mustBeNotFound(t, svc.RemoveSeriesDate(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-21"))
	mustBeNotFound(t, svc.RemoveSeriesDate(ctx, "shop-1", validProfessionalID, "no-uuid", "2026-07-20"))
	mustBeValidation(t, svc.RemoveSeriesDate(ctx, "shop-1", validProfessionalID, validSeriesID, "20/07/2026"))

	failing := &fakeRepository{removeSeriesDateFn: func(context.Context, string, string, string, string) (bool, error) { return false, errRepoDown }}
	mustBeKind(t, schedule.NewService(failing, fakeProfessionalPort{}).RemoveSeriesDate(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-20"), apperr.KindInternal)
}

func TestAddSeriesException_DistinguishesMissingSeriesFromDuplicate(t *testing.T) {
	ctx := context.Background()
	reason := "  viaje  "
	for _, tc := range []struct {
		name            string
		found, conflict bool
		repoErr         error
		want            apperr.Kind
	}{
		{"serie inexistente", false, false, nil, apperr.KindNotFound},
		{"ya había excepción ese día", true, true, nil, apperr.KindConflict},
		{"fallo del repositorio", false, false, errRepoDown, apperr.KindInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{addSeriesExceptionFn: func(context.Context, string, string, string, string, *string) (bool, bool, error) {
				return tc.found, tc.conflict, tc.repoErr
			}}
			err := schedule.NewService(repo, fakeProfessionalPort{}).AddSeriesException(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-20", &reason)
			mustBeKind(t, err, tc.want)
		})
	}

	var gotReason *string
	repo := &fakeRepository{addSeriesExceptionFn: func(_ context.Context, _, _, _, _ string, r *string) (bool, bool, error) {
		gotReason = r
		return true, false, nil
	}}
	svc := schedule.NewService(repo, fakeProfessionalPort{})
	if err := svc.AddSeriesException(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-20", &reason); err != nil {
		t.Fatalf("AddSeriesException: %v", err)
	}
	if gotReason == nil || *gotReason != "viaje" {
		t.Fatalf("el motivo debe llegar recortado, llegó %v", gotReason)
	}
	mustBeNotFound(t, svc.AddSeriesException(ctx, "shop-1", "no-uuid", validSeriesID, "2026-07-20", nil))
	mustBeValidation(t, svc.AddSeriesException(ctx, "shop-1", validProfessionalID, validSeriesID, "mañana", nil))
}

func TestRemoveSeriesException_TranslatesNotFoundAndFailures(t *testing.T) {
	ctx := context.Background()
	restored := &fakeRepository{removeSeriesExceptionFn: func(context.Context, string, string, string, string) (bool, error) { return true, nil }}
	if err := schedule.NewService(restored, fakeProfessionalPort{}).RemoveSeriesException(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-20"); err != nil {
		t.Fatalf("restaurar la instancia: %v", err)
	}
	missing := &fakeRepository{removeSeriesExceptionFn: func(context.Context, string, string, string, string) (bool, error) { return false, nil }}
	mustBeNotFound(t, schedule.NewService(missing, fakeProfessionalPort{}).RemoveSeriesException(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-20"))
	failing := &fakeRepository{removeSeriesExceptionFn: func(context.Context, string, string, string, string) (bool, error) { return false, errRepoDown }}
	mustBeKind(t, schedule.NewService(failing, fakeProfessionalPort{}).RemoveSeriesException(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-07-20"), apperr.KindInternal)
	mustBeNotFound(t, schedule.NewService(missing, fakeProfessionalPort{}).RemoveSeriesException(ctx, "shop-1", validProfessionalID, "no-uuid", "2026-07-20"))
	mustBeValidation(t, schedule.NewService(missing, fakeProfessionalPort{}).RemoveSeriesException(ctx, "shop-1", validProfessionalID, validSeriesID, "2026-13-40"))
}

func TestListAndGetExceptions_TranslateRepositoryOutcomes(t *testing.T) {
	ctx := context.Background()
	var gotLimit int
	repo := &fakeRepository{
		listExceptionsFn: func(_ context.Context, _, _ string, _ *schedule.ExceptionCursor, limit int) (schedule.ExceptionListResult, error) {
			gotLimit = limit
			return schedule.ExceptionListResult{Items: []schedule.ScheduleException{{ID: validExceptionID}}}, nil
		},
		getExceptionFn: func(_ context.Context, _, _, id string) (schedule.ScheduleException, bool, error) {
			return schedule.ScheduleException{ID: id}, id == validExceptionID, nil
		},
	}
	svc := schedule.NewService(repo, fakeProfessionalPort{exists: true})
	for _, tc := range []struct{ in, want int }{{0, schedule.DefaultListLimit}, {10000, schedule.MaxListLimit}, {schedule.MaxListLimit, schedule.MaxListLimit}} {
		if _, err := svc.ListExceptions(ctx, "shop-1", validProfessionalID, "", tc.in); err != nil || gotLimit != tc.want {
			t.Fatalf("ListExceptions(limit=%d) → %d, %v; want %d", tc.in, gotLimit, err, tc.want)
		}
	}
	if _, err := svc.ListExceptions(ctx, "shop-1", validProfessionalID, "cursor-roto", 10); err == nil {
		t.Fatal("un cursor ilegible debe rechazarse")
	}
	_, err := svc.ListExceptions(ctx, "shop-1", "no-uuid", "", 10)
	mustBeNotFound(t, err)
	_, err = schedule.NewService(repo, fakeProfessionalPort{exists: false}).ListExceptions(ctx, "shop-1", validProfessionalID, "", 10)
	mustBeNotFound(t, err)
	_, err = schedule.NewService(repo, fakeProfessionalPort{err: errRepoDown}).ListExceptions(ctx, "shop-1", validProfessionalID, "", 10)
	mustBeKind(t, err, apperr.KindInternal)

	if got, err := svc.GetException(ctx, "shop-1", validProfessionalID, validExceptionID); err != nil || got.ID != validExceptionID {
		t.Fatalf("GetException = %+v, %v", got, err)
	}
	_, err = svc.GetException(ctx, "shop-1", validProfessionalID, "no-uuid")
	mustBeNotFound(t, err)
	_, err = svc.GetException(ctx, "shop-1", validProfessionalID, "8b2c3d4e-5f60-4172-8394-a5b6c7d8e9f1")
	mustBeNotFound(t, err)

	failing := &fakeRepository{
		listExceptionsFn: func(context.Context, string, string, *schedule.ExceptionCursor, int) (schedule.ExceptionListResult, error) {
			return schedule.ExceptionListResult{}, errRepoDown
		},
		getExceptionFn: func(context.Context, string, string, string) (schedule.ScheduleException, bool, error) {
			return schedule.ScheduleException{}, false, errRepoDown
		},
	}
	fsvc := schedule.NewService(failing, fakeProfessionalPort{exists: true})
	_, err = fsvc.ListExceptions(ctx, "shop-1", validProfessionalID, "", 10)
	mustBeKind(t, err, apperr.KindInternal)
	_, err = fsvc.GetException(ctx, "shop-1", validProfessionalID, validExceptionID)
	mustBeKind(t, err, apperr.KindInternal)
}

// blockProjectionRepo devuelve un bloqueo puntual y una serie semanal de los
// lunes 15:00–16:00 para las proyecciones de disponibilidad (HU-094, HU-061).
func blockProjectionRepo(t *testing.T, manual []schedule.TimeBlock, weekly []schedule.WorkingHour) *fakeRepository {
	t.Helper()
	monday := 1
	repo := newResolveRepo(t, nil, false, weekly)
	repo.listEffectiveManualBlocksFn = func(context.Context, string, string, time.Time, time.Time) ([]schedule.TimeBlock, error) {
		return manual, nil
	}
	repo.listActiveSeriesForProjectionFn = func(context.Context, string, string, string, string) ([]schedule.TimeBlockSeries, error) {
		return []schedule.TimeBlockSeries{{
			ID: validSeriesID, RecurrenceKind: schedule.RecurrenceKindWeekly, ISOWeekday: &monday,
			StartsTime: "15:00", DurationMinutes: 60, EffectiveFrom: "2026-01-01",
		}}, nil
	}
	return repo
}

func TestAvailabilityLookup_ResolveEffectiveDay_FlattensSegments(t *testing.T) {
	weekly := []schedule.WorkingHour{{StartsTime: "09:00", DurationMinutes: 180}, {StartsTime: "13:00", DurationMinutes: 300}}
	lookup := schedule.NewAvailabilityLookup(schedule.NewService(newResolveRepo(t, nil, false, weekly), fakeProfessionalPort{}))

	working, starts, durations, err := lookup.ResolveEffectiveDay(context.Background(), "shop-1", validProfessionalID, "2026-09-14")
	if err != nil {
		t.Fatalf("ResolveEffectiveDay: %v", err)
	}
	if !working || len(starts) != 2 || starts[0] != "09:00" || starts[1] != "13:00" || durations[0] != 180 || durations[1] != 300 {
		t.Fatalf("got working=%v starts=%v durations=%v", working, starts, durations)
	}
	if _, _, _, err := lookup.ResolveEffectiveDay(context.Background(), "shop-1", validProfessionalID, "14/09/2026"); err == nil {
		t.Fatal("una fecha ilegible debe rechazarse")
	}
}

func TestAvailabilityLookup_BusyIntervals_ConvertsSeriesToTheShopTimezone(t *testing.T) {
	bogota, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	manual := schedule.TimeBlock{ID: validBlockID, StartsAt: time.Date(2026, 9, 14, 12, 0, 0, 0, bogota), EndsAt: time.Date(2026, 9, 14, 13, 0, 0, 0, bogota)}
	repo := blockProjectionRepo(t, []schedule.TimeBlock{manual}, nil)
	lookup := schedule.NewAvailabilityLookup(schedule.NewService(repo, fakeProfessionalPort{exists: true}))

	starts, ends, err := lookup.BusyIntervals(context.Background(), "shop-1", validProfessionalID, "2026-09-14", "2026-09-14", "America/Bogota")
	if err != nil {
		t.Fatalf("BusyIntervals: %v", err)
	}
	if len(starts) != 2 || len(ends) != 2 {
		t.Fatalf("esperaba el bloqueo puntual y la ocurrencia del lunes, got %v–%v", starts, ends)
	}
	wantSeries := time.Date(2026, 9, 14, 15, 0, 0, 0, bogota)
	if !starts[0].Equal(manual.StartsAt) || !starts[1].Equal(wantSeries) || !ends[1].Equal(wantSeries.Add(time.Hour)) {
		t.Fatalf("intervalos inesperados: %v – %v", starts, ends)
	}
	if _, _, err := lookup.BusyIntervals(context.Background(), "shop-1", validProfessionalID, "2026-09-14", "2026-09-14", "Zona/Inexistente"); err == nil {
		t.Fatal("una zona inexistente debe rechazarse")
	}
	if _, _, err := lookup.BusyIntervals(context.Background(), "shop-1", validProfessionalID, "2026-09-15", "2026-09-14", "America/Bogota"); err == nil {
		t.Fatal("un rango invertido debe rechazarse")
	}
}

func TestManualBookingBlocks_HasActiveBlock_SemiOpenAgainstManualAndSeries(t *testing.T) {
	bogota, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	at := func(hour, minute int) time.Time { return time.Date(2026, 9, 14, hour, minute, 0, 0, bogota) }
	manual := schedule.TimeBlock{ID: validBlockID, StartsAt: at(12, 0), EndsAt: at(13, 0)}
	adapter := schedule.NewManualBookingBlocks(schedule.NewService(blockProjectionRepo(t, []schedule.TimeBlock{manual}, nil), fakeProfessionalPort{exists: true}))

	for _, tc := range []struct {
		name       string
		start, end time.Time
		want       bool
	}{
		{"cruza el bloqueo puntual", at(12, 30), at(13, 0), true},
		{"contiguo al bloqueo puntual", at(13, 0), at(13, 30), false},
		{"cae en la ocurrencia semanal", at(15, 30), at(16, 0), true},
		{"termina justo cuando empieza la serie", at(14, 30), at(15, 0), false},
		{"libre", at(10, 0), at(10, 30), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := adapter.HasActiveBlock(context.Background(), "shop-1", validProfessionalID, tc.start, tc.end, "America/Bogota")
			if err != nil {
				t.Fatalf("HasActiveBlock: %v", err)
			}
			if got != tc.want {
				t.Fatalf("HasActiveBlock = %v, want %v", got, tc.want)
			}
		})
	}
	if _, err := adapter.HasActiveBlock(context.Background(), "shop-1", validProfessionalID, at(10, 0), at(10, 30), "Zona/Inexistente"); err == nil {
		t.Fatal("una zona inexistente debe rechazarse")
	}
}
