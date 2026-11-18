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

type fakeOpeningHoursRepository struct {
	hours     shops.OpeningHours
	gotShopID string
	replaces  []shops.OpeningHours
}

func (f *fakeOpeningHoursRepository) Get(_ context.Context, shopID string) (shops.OpeningHours, bool, error) {
	f.gotShopID = shopID
	return f.hours, true, nil
}

func (f *fakeOpeningHoursRepository) Replace(_ context.Context, shopID string, hours shops.OpeningHours) (shops.OpeningHours, bool, error) {
	f.gotShopID = shopID
	f.replaces = append(f.replaces, hours)
	f.hours = hours
	return hours, true, nil
}

const openingHoursTarget = "/api/v1/private/settings/opening-hours"

func TestGetOpeningHoursHandler_ReturnsAnEmptyListNotNull(t *testing.T) {
	repo := &fakeOpeningHoursRepository{}
	rec := httptest.NewRecorder()
	httpapi.NewGetOpeningHoursHandler(shops.NewOpeningHoursService(repo)).
		ServeHTTP(rec, requestWithPrincipal(http.MethodGet, openingHoursTarget, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("esperaba 200, obtuvo %d: %s", rec.Code, rec.Body.String())
	}
	var raw map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if list, ok := raw["openingHours"].([]any); !ok || len(list) != 0 {
		t.Fatalf("sin horario, openingHours debe ser []: %v", raw["openingHours"])
	}
	if raw["closedOnHolidays"] != false || raw["maxSegmentsPerDay"] != float64(4) {
		t.Fatalf("respuesta inesperada: %v", raw)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("esperaba no-store, obtuvo %q", rec.Header().Get("Cache-Control"))
	}
	if repo.gotShopID != testShopID {
		t.Fatalf("el negocio sale de la sesión: esperaba %q, obtuvo %q", testShopID, repo.gotShopID)
	}
}

func TestReplaceOpeningHoursHandler_StoresTheWeekSortedAndEchoesIt(t *testing.T) {
	repo := &fakeOpeningHoursRepository{}
	body := `{"openingHours":[
		{"dayOfWeek":"SATURDAY","opens":"00:00","closes":"02:00"},
		{"dayOfWeek":"FRIDAY","opens":"20:00","closes":"24:00"},
		{"dayOfWeek":"MONDAY","opens":"09:00","closes":"19:00"}],
		"closedOnHolidays":true}`
	rec := httptest.NewRecorder()
	httpapi.NewReplaceOpeningHoursHandler(shops.NewOpeningHoursService(repo)).
		ServeHTTP(rec, requestWithPrincipal(http.MethodPut, openingHoursTarget, []byte(body)))

	if rec.Code != http.StatusOK {
		t.Fatalf("esperaba 200, obtuvo %d: %s", rec.Code, rec.Body.String())
	}
	var got httpapi.OpeningHoursSettingsResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []httpapi.OpeningSegmentDTO{
		{DayOfWeek: "MONDAY", Opens: "09:00", Closes: "19:00"},
		{DayOfWeek: "FRIDAY", Opens: "20:00", Closes: "24:00"},
		{DayOfWeek: "SATURDAY", Opens: "00:00", Closes: "02:00"},
	}
	if len(got.OpeningHours) != 3 || !got.ClosedOnHolidays {
		t.Fatalf("respuesta: %+v", got)
	}
	for i := range want {
		if got.OpeningHours[i] != want[i] {
			t.Fatalf("orden y forma: got %+v want %+v", got.OpeningHours, want)
		}
	}
	if repo.gotShopID != testShopID || len(repo.replaces) != 1 {
		t.Fatalf("una sola escritura, en el negocio de la sesión: shop=%q replaces=%d", repo.gotShopID, len(repo.replaces))
	}
}

func TestReplaceOpeningHoursHandler_ValidatesTheBody(t *testing.T) {
	cases := map[string]struct {
		body string
		want int
	}{
		"semana vacía":        {`{"openingHours":[],"closedOnHolidays":false}`, http.StatusOK},
		"sin festivos":        {`{"openingHours":[]}`, http.StatusUnprocessableEntity},
		"sin tramos":          {`{"closedOnHolidays":true}`, http.StatusUnprocessableEntity},
		"día en minúsculas":   {`{"openingHours":[{"dayOfWeek":"monday","opens":"09:00","closes":"10:00"}],"closedOnHolidays":false}`, http.StatusUnprocessableEntity},
		"hora sin cero":       {`{"openingHours":[{"dayOfWeek":"MONDAY","opens":"9:00","closes":"10:00"}],"closedOnHolidays":false}`, http.StatusUnprocessableEntity},
		"con segundos":        {`{"openingHours":[{"dayOfWeek":"MONDAY","opens":"09:00:00","closes":"10:00"}],"closedOnHolidays":false}`, http.StatusUnprocessableEntity},
		"cierre antes":        {`{"openingHours":[{"dayOfWeek":"MONDAY","opens":"19:00","closes":"09:00"}],"closedOnHolidays":false}`, http.StatusUnprocessableEntity},
		"solape":              {`{"openingHours":[{"dayOfWeek":"MONDAY","opens":"09:00","closes":"13:00"},{"dayOfWeek":"MONDAY","opens":"12:00","closes":"18:00"}],"closedOnHolidays":false}`, http.StatusUnprocessableEntity},
		"campo desconocido":   {`{"openingHours":[],"closedOnHolidays":false,"timezone":"UTC"}`, http.StatusBadRequest},
		"tramo con de más":    {`{"openingHours":[{"dayOfWeek":"MONDAY","opens":"09:00","closes":"10:00","note":"x"}],"closedOnHolidays":false}`, http.StatusBadRequest},
		"no es JSON":          {`[]`, http.StatusBadRequest},
		"dos objetos JSON":    {`{"openingHours":[],"closedOnHolidays":false}{}`, http.StatusBadRequest},
		"festivos no es bool": {`{"openingHours":[],"closedOnHolidays":"sí"}`, http.StatusBadRequest},
	}
	for name, tc := range cases {
		repo := &fakeOpeningHoursRepository{}
		rec := httptest.NewRecorder()
		httpapi.NewReplaceOpeningHoursHandler(shops.NewOpeningHoursService(repo)).
			ServeHTTP(rec, requestWithPrincipal(http.MethodPut, openingHoursTarget, []byte(tc.body)))
		if rec.Code != tc.want {
			t.Errorf("%s: esperaba %d, obtuvo %d: %s", name, tc.want, rec.Code, rec.Body.String())
		}
		if tc.want != http.StatusOK && len(repo.replaces) != 0 {
			t.Errorf("%s: un cuerpo rechazado no llega al repositorio", name)
		}
	}
}
