package schedule_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/schedule"
	"nava-agenda/internal/platform/apperr"
)

// Edición y retiro de series, bloqueos y excepciones (HU-041, HU-042): el caso
// de uso valida la forma antes de tocar la base, valida una división
// this_and_following contra la serie original y traduce el resultado del
// repositorio sin confundir «no existe» con «choca» (CP-NF07).

func updateSeries(svc *schedule.Service, scope, split string) (schedule.TimeBlockSeries, error) {
	return svc.UpdateSeries(context.Background(), "shop-1", validProfessionalID, validSeriesID, scope,
		schedule.BlockTypeLunch, "13:00", 60, "2026-01-01", nil, nil, split)
}

func TestUpdateSeries_Whole_TranslatesRepositoryOutcomes(t *testing.T) {
	for _, tc := range []struct {
		name    string
		found   bool
		repoErr error
		want    apperr.Kind
	}{
		{"la serie ya no existe", false, nil, apperr.KindNotFound},
		{"fallo del repositorio", false, errRepoDown, apperr.KindInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{updateSeriesWholeFn: func(context.Context, string, string, string, schedule.UpdateSeriesInput) (schedule.UpdateSeriesResult, error) {
				return schedule.UpdateSeriesResult{Found: tc.found}, tc.repoErr
			}}
			_, err := updateSeries(schedule.NewService(repo, fakeProfessionalPort{}), schedule.UpdateScopeWhole, "")
			mustBeKind(t, err, tc.want)
		})
	}

	var got schedule.UpdateSeriesInput
	repo := &fakeRepository{updateSeriesWholeFn: func(_ context.Context, _, _, _ string, input schedule.UpdateSeriesInput) (schedule.UpdateSeriesResult, error) {
		got = input
		return schedule.UpdateSeriesResult{Found: true, Series: schedule.TimeBlockSeries{ID: validSeriesID}}, nil
	}}
	series, err := updateSeries(schedule.NewService(repo, fakeProfessionalPort{}), schedule.UpdateScopeWhole, "")
	if err != nil || series.ID != validSeriesID {
		t.Fatalf("UpdateSeries whole = %+v, %v", series, err)
	}
	if got.BlockType != schedule.BlockTypeLunch || got.StartsTime != "13:00" || got.DurationMinutes != 60 || got.EffectiveFrom != "2026-01-01" {
		t.Fatalf("entrada validada inesperada: %+v", got)
	}
}

func TestUpdateSeries_InvalidShape_RejectedBeforeTheRepository(t *testing.T) {
	repo := &fakeRepository{updateSeriesWholeFn: func(context.Context, string, string, string, schedule.UpdateSeriesInput) (schedule.UpdateSeriesResult, error) {
		t.Fatal("el repositorio no debe llamarse con una forma inválida")
		return schedule.UpdateSeriesResult{}, nil
	}}
	svc := schedule.NewService(repo, fakeProfessionalPort{})
	ctx := context.Background()
	until := "2025-12-31"
	badUntil := "31/12/2026"
	for name, call := range map[string]func() error{
		"tipo inválido": func() error {
			_, err := svc.UpdateSeries(ctx, "shop-1", validProfessionalID, validSeriesID, schedule.UpdateScopeWhole, "siesta", "13:00", 60, "2026-01-01", nil, nil, "")
			return err
		},
		"hora inválida": func() error {
			_, err := svc.UpdateSeries(ctx, "shop-1", validProfessionalID, validSeriesID, schedule.UpdateScopeWhole, schedule.BlockTypeLunch, "1pm", 60, "2026-01-01", nil, nil, "")
			return err
		},
		"duración cero": func() error {
			_, err := svc.UpdateSeries(ctx, "shop-1", validProfessionalID, validSeriesID, schedule.UpdateScopeWhole, schedule.BlockTypeLunch, "13:00", 0, "2026-01-01", nil, nil, "")
			return err
		},
		"inicio ilegible": func() error {
			_, err := svc.UpdateSeries(ctx, "shop-1", validProfessionalID, validSeriesID, schedule.UpdateScopeWhole, schedule.BlockTypeLunch, "13:00", 60, "enero", nil, nil, "")
			return err
		},
		"fin ilegible": func() error {
			_, err := svc.UpdateSeries(ctx, "shop-1", validProfessionalID, validSeriesID, schedule.UpdateScopeWhole, schedule.BlockTypeLunch, "13:00", 60, "2026-01-01", &badUntil, nil, "")
			return err
		},
		"fin antes del inicio": func() error {
			_, err := svc.UpdateSeries(ctx, "shop-1", validProfessionalID, validSeriesID, schedule.UpdateScopeWhole, schedule.BlockTypeLunch, "13:00", 60, "2026-01-01", &until, nil, "")
			return err
		},
	} {
		t.Run(name, func(t *testing.T) { mustBeValidation(t, call()) })
	}
	_, err := svc.UpdateSeries(ctx, "shop-1", validProfessionalID, "no-uuid", schedule.UpdateScopeWhole, schedule.BlockTypeLunch, "13:00", 60, "2026-01-01", nil, nil, "")
	mustBeNotFound(t, err)
}

func TestUpdateSeries_ThisAndFollowing_ValidatesAgainstTheOriginalSeries(t *testing.T) {
	monday := 1
	weekly := schedule.TimeBlockSeries{ID: validSeriesID, RecurrenceKind: schedule.RecurrenceKindWeekly, ISOWeekday: &monday, EffectiveFrom: "2026-01-01"}
	deleted := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	until := "2026-03-31"

	for _, tc := range []struct {
		name     string
		existing schedule.TimeBlockSeries
		found    bool
		getErr   error
		split    string
		want     apperr.Kind
	}{
		{"la serie no existe", schedule.TimeBlockSeries{}, false, nil, "2026-02-02", apperr.KindNotFound},
		{"la serie está retirada", schedule.TimeBlockSeries{ID: validSeriesID, RecurrenceKind: schedule.RecurrenceKindWeekly, EffectiveFrom: "2026-01-01", DeletedAt: &deleted}, true, nil, "2026-02-02", apperr.KindNotFound},
		{"una lista de fechas no se divide", schedule.TimeBlockSeries{ID: validSeriesID, RecurrenceKind: schedule.RecurrenceKindDateList, EffectiveFrom: "2026-01-01"}, true, nil, "2026-02-02", apperr.KindValidation},
		{"fecha de división ilegible", weekly, true, nil, "febrero", apperr.KindValidation},
		{"división en el primer día", weekly, true, nil, "2026-01-01", apperr.KindValidation},
		{"división después del fin", schedule.TimeBlockSeries{ID: validSeriesID, RecurrenceKind: schedule.RecurrenceKindWeekly, EffectiveFrom: "2026-01-01", EffectiveUntil: &until}, true, nil, "2026-04-06", apperr.KindValidation},
		{"fallo al leer la serie", schedule.TimeBlockSeries{}, false, errRepoDown, "2026-02-02", apperr.KindInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{
				getSeriesFn: func(context.Context, string, string, string) (schedule.TimeBlockSeries, bool, error) {
					return tc.existing, tc.found, tc.getErr
				},
				splitSeriesFromFn: func(context.Context, string, string, string, string, schedule.UpdateSeriesInput) (schedule.UpdateSeriesResult, error) {
					t.Fatal("no debe dividirse una serie que no pasó la validación")
					return schedule.UpdateSeriesResult{}, nil
				},
			}
			_, err := updateSeries(schedule.NewService(repo, fakeProfessionalPort{}), schedule.UpdateScopeThisAndFollowing, tc.split)
			mustBeKind(t, err, tc.want)
		})
	}

	var gotSplit string
	repo := &fakeRepository{
		getSeriesFn: func(context.Context, string, string, string) (schedule.TimeBlockSeries, bool, error) {
			return weekly, true, nil
		},
		splitSeriesFromFn: func(_ context.Context, _, _, _, date string, _ schedule.UpdateSeriesInput) (schedule.UpdateSeriesResult, error) {
			gotSplit = date
			return schedule.UpdateSeriesResult{Found: true, Series: schedule.TimeBlockSeries{ID: "nueva"}}, nil
		},
	}
	got, err := updateSeries(schedule.NewService(repo, fakeProfessionalPort{}), schedule.UpdateScopeThisAndFollowing, "2026-02-02")
	if err != nil || got.ID != "nueva" || gotSplit != "2026-02-02" {
		t.Fatalf("división = %+v en %q, %v", got, gotSplit, err)
	}

	for _, tc := range []struct {
		name  string
		found bool
		err   error
		want  apperr.Kind
	}{{"la serie desapareció al dividir", false, nil, apperr.KindNotFound}, {"fallo al dividir", false, errRepoDown, apperr.KindInternal}} {
		repo.splitSeriesFromFn = func(context.Context, string, string, string, string, schedule.UpdateSeriesInput) (schedule.UpdateSeriesResult, error) {
			return schedule.UpdateSeriesResult{Found: tc.found}, tc.err
		}
		_, err := updateSeries(schedule.NewService(repo, fakeProfessionalPort{}), schedule.UpdateScopeThisAndFollowing, "2026-02-02")
		mustBeKind(t, err, tc.want)
	}
}

func TestDeleteBlock_TranslatesRepositoryOutcomes(t *testing.T) {
	ctx := context.Background()
	var gotActor string
	repo := &fakeRepository{deleteBlockFn: func(_ context.Context, _, _, _, actorID string) (bool, error) {
		gotActor = actorID
		return true, nil
	}}
	if err := schedule.NewService(repo, fakeProfessionalPort{}).DeleteBlock(ctx, "shop-1", validProfessionalID, validBlockID, "staff-1"); err != nil || gotActor != "staff-1" {
		t.Fatalf("DeleteBlock: %v (actor %q)", err, gotActor)
	}
	mustBeNotFound(t, schedule.NewService(repo, fakeProfessionalPort{}).DeleteBlock(ctx, "shop-1", validProfessionalID, "no-uuid", "staff-1"))
	missing := &fakeRepository{deleteBlockFn: func(context.Context, string, string, string, string) (bool, error) { return false, nil }}
	mustBeNotFound(t, schedule.NewService(missing, fakeProfessionalPort{}).DeleteBlock(ctx, "shop-1", validProfessionalID, validBlockID, "staff-1"))
	failing := &fakeRepository{deleteBlockFn: func(context.Context, string, string, string, string) (bool, error) { return false, errRepoDown }}
	mustBeKind(t, schedule.NewService(failing, fakeProfessionalPort{}).DeleteBlock(ctx, "shop-1", validProfessionalID, validBlockID, "staff-1"), apperr.KindInternal)
}

func TestUpdateAndDeleteException_TranslateRepositoryOutcomes(t *testing.T) {
	ctx := context.Background()
	segments := []schedule.CreateExceptionSegmentInput{{StartsTime: "09:00", DurationMinutes: 240}}
	update := func(result schedule.UpdateExceptionResult, err error) error {
		repo := &fakeRepository{updateExceptionFn: func(context.Context, string, string, string, schedule.UpdateExceptionInput) (schedule.UpdateExceptionResult, error) {
			return result, err
		}}
		_, gotErr := schedule.NewService(repo, fakeProfessionalPort{}).UpdateException(ctx, "shop-1", validProfessionalID, validExceptionID, "2026-12-24", false, nil, segments)
		return gotErr
	}
	if err := update(schedule.UpdateExceptionResult{Found: true, Exception: schedule.ScheduleException{ID: validExceptionID}}, nil); err != nil {
		t.Fatalf("UpdateException: %v", err)
	}
	// El conflicto gana sobre «no encontrado»: solo ocurre sobre una excepción propia.
	mustBeConflict(t, update(schedule.UpdateExceptionResult{Found: false, Conflict: true}, nil))
	mustBeNotFound(t, update(schedule.UpdateExceptionResult{}, nil))
	mustBeKind(t, update(schedule.UpdateExceptionResult{}, errRepoDown), apperr.KindInternal)

	_, err := schedule.NewService(&fakeRepository{}, fakeProfessionalPort{}).UpdateException(ctx, "shop-1", validProfessionalID, "no-uuid", "2026-12-24", true, nil, nil)
	mustBeNotFound(t, err)

	del := func(found bool, err error) error {
		repo := &fakeRepository{deleteExceptionFn: func(context.Context, string, string, string) (bool, error) { return found, err }}
		return schedule.NewService(repo, fakeProfessionalPort{}).DeleteException(ctx, "shop-1", validProfessionalID, validExceptionID)
	}
	if err := del(true, nil); err != nil {
		t.Fatalf("DeleteException: %v", err)
	}
	mustBeNotFound(t, del(false, nil))
	mustBeKind(t, del(false, errRepoDown), apperr.KindInternal)
	mustBeNotFound(t, schedule.NewService(&fakeRepository{}, fakeProfessionalPort{}).DeleteException(ctx, "shop-1", validProfessionalID, "no-uuid"))
}

func TestEffectiveBlocks_FailuresAreInternalOrNotFound(t *testing.T) {
	ctx := context.Background()
	ok := func(context.Context, string, string, time.Time, time.Time) ([]schedule.TimeBlock, error) {
		return nil, nil
	}
	noSeries := func(context.Context, string, string, string, string) ([]schedule.TimeBlockSeries, error) {
		return nil, nil
	}

	for _, tc := range []struct {
		name   string
		prof   fakeProfessionalPort
		manual func(context.Context, string, string, time.Time, time.Time) ([]schedule.TimeBlock, error)
		series func(context.Context, string, string, string, string) ([]schedule.TimeBlockSeries, error)
		want   apperr.Kind
	}{
		{"profesional inexistente", fakeProfessionalPort{exists: false}, ok, noSeries, apperr.KindNotFound},
		{"fallo al verificar el profesional", fakeProfessionalPort{err: errRepoDown}, ok, noSeries, apperr.KindInternal},
		{"fallo al leer bloqueos puntuales", fakeProfessionalPort{exists: true}, func(context.Context, string, string, time.Time, time.Time) ([]schedule.TimeBlock, error) {
			return nil, errRepoDown
		}, noSeries, apperr.KindInternal},
		{"fallo al leer series", fakeProfessionalPort{exists: true}, ok, func(context.Context, string, string, string, string) ([]schedule.TimeBlockSeries, error) {
			return nil, errRepoDown
		}, apperr.KindInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{listEffectiveManualBlocksFn: tc.manual, listActiveSeriesForProjectionFn: tc.series}
			_, err := schedule.NewService(repo, tc.prof).EffectiveBlocks(ctx, "shop-1", validProfessionalID, "2026-09-14", "2026-09-20")
			mustBeKind(t, err, tc.want)
		})
	}

	svc := schedule.NewService(&fakeRepository{}, fakeProfessionalPort{exists: true})
	_, err := svc.EffectiveBlocks(ctx, "shop-1", "no-uuid", "2026-09-14", "2026-09-20")
	mustBeNotFound(t, err)
	_, err = svc.EffectiveBlocks(ctx, "shop-1", validProfessionalID, "14-09-2026", "2026-09-20")
	mustBeValidation(t, err)
	_, err = svc.EffectiveBlocks(ctx, "shop-1", validProfessionalID, "2026-09-14", "20-09-2026")
	mustBeValidation(t, err)
}
