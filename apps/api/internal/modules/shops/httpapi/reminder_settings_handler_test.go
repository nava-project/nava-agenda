package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/modules/shops/httpapi"
)

type fakeReminderSettingsRepository struct {
	lead      shops.ReminderLeadMinutes
	gotShopID string
	updates   []shops.ReminderLeadMinutes
}

func (f *fakeReminderSettingsRepository) Get(_ context.Context, shopID string) (shops.ReminderLeadMinutes, bool, error) {
	f.gotShopID = shopID
	return f.lead, true, nil
}

func (f *fakeReminderSettingsRepository) Update(_ context.Context, shopID string, lead shops.ReminderLeadMinutes) (shops.ReminderLeadMinutes, bool, error) {
	f.gotShopID = shopID
	f.updates = append(f.updates, lead)
	f.lead = lead
	return lead, true, nil
}

const reminderSettingsTarget = "/api/v1/private/settings/reminders"

func TestGetReminderSettingsHandler_ReturnsTheLeadAndTheFixedOptions(t *testing.T) {
	repo := &fakeReminderSettingsRepository{lead: 30}
	h := httpapi.NewGetReminderSettingsHandler(shops.NewReminderSettingsService(repo))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestWithPrincipal(http.MethodGet, reminderSettingsTarget, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("esperaba 200, obtuvo %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		LeadMinutes int   `json:"leadMinutes"`
		LeadOptions []int `json:"leadOptions"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.LeadMinutes != 30 || len(body.LeadOptions) != 6 || body.LeadOptions[0] != 10 || body.LeadOptions[5] != 60 {
		t.Fatalf("respuesta inesperada: %+v", body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("esperaba no-store, obtuvo %q", rec.Header().Get("Cache-Control"))
	}
	if repo.gotShopID != testShopID {
		t.Fatalf("el negocio sale de la sesión: esperaba %q, obtuvo %q", testShopID, repo.gotShopID)
	}
}

func TestUpdateReminderSettingsHandler_ValidatesTheBody(t *testing.T) {
	cases := map[string]struct {
		body string
		want int
	}{
		"válido":            {`{"leadMinutes":20}`, http.StatusOK},
		"fuera de lista":    {`{"leadMinutes":45}`, http.StatusUnprocessableEntity},
		"más de 60":         {`{"leadMinutes":90}`, http.StatusUnprocessableEntity},
		"sin valor":         {`{}`, http.StatusUnprocessableEntity},
		"campo desconocido": {`{"leadMinutes":20,"channel":"email"}`, http.StatusBadRequest},
		"no es JSON":        {`20`, http.StatusBadRequest},
	}
	for name, tc := range cases {
		repo := &fakeReminderSettingsRepository{lead: 30}
		h := httpapi.NewUpdateReminderSettingsHandler(shops.NewReminderSettingsService(repo))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, requestWithPrincipal(http.MethodPatch, reminderSettingsTarget, []byte(tc.body)))
		if rec.Code != tc.want {
			t.Errorf("%s: esperaba %d, obtuvo %d: %s", name, tc.want, rec.Code, rec.Body.String())
		}
		if tc.want != http.StatusOK && len(repo.updates) != 0 {
			t.Errorf("%s: un cuerpo rechazado no llega al repositorio", name)
		}
	}
}
