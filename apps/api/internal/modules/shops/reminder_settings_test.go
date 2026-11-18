package shops_test

import (
	"context"
	"errors"
	"testing"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/apperr"
)

type fakeReminderRepo struct {
	lead    shops.ReminderLeadMinutes
	updates int
}

func (f *fakeReminderRepo) Get(context.Context, string) (shops.ReminderLeadMinutes, bool, error) {
	return f.lead, true, nil
}

func (f *fakeReminderRepo) Update(_ context.Context, _ string, lead shops.ReminderLeadMinutes) (shops.ReminderLeadMinutes, bool, error) {
	f.updates++
	f.lead = lead
	return lead, true, nil
}

func TestReminderLeadMinutes_OnlyTensUpToSixty(t *testing.T) {
	for _, ok := range []int{10, 20, 30, 40, 50, 60} {
		if !shops.ReminderLeadMinutes(ok).Valid() {
			t.Errorf("%d debe ser válido", ok)
		}
	}
	for _, bad := range []int{0, 5, 15, 25, 61, 70, 90, -10} {
		if shops.ReminderLeadMinutes(bad).Valid() {
			t.Errorf("%d no debe ser válido", bad)
		}
	}
}

func TestReminderSettingsService_RejectsAnInvalidLeadWithoutTouchingTheStore(t *testing.T) {
	repo := &fakeReminderRepo{lead: 30}
	_, err := shops.NewReminderSettingsService(repo).Update(context.Background(), "shop", 45)
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Kind != apperr.KindValidation {
		t.Fatalf("45 debe ser un error de validación, got %v", err)
	}
	if repo.updates != 0 {
		t.Fatal("un valor inválido no llega al repositorio")
	}
}

func TestReminderSettingsService_StoresAValidLead(t *testing.T) {
	repo := &fakeReminderRepo{lead: 30}
	got, err := shops.NewReminderSettingsService(repo).Update(context.Background(), "shop", 20)
	if err != nil || got != 20 || repo.lead != 20 {
		t.Fatalf("got=%d lead=%d err=%v", got, repo.lead, err)
	}
}
