package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"system-barbershop/internal/modules/shops"
	"system-barbershop/internal/modules/shops/httpapi"
	"system-barbershop/internal/platform/httpserver"
)

const handlerPolicyBarberID = "d1690000-0000-4000-8000-000000000001"

// fakeBarberPolicyRepo es un doble en memoria del repositorio de DEC-169:
// estas pruebas cubren el adaptador HTTP (decodificación cerrada, principal,
// parámetro de ruta, códigos), no PostgreSQL.
type fakeBarberPolicyRepo struct {
	own        map[string]shops.BarberBookingPolicy
	lastShopID string
}

func (f *fakeBarberPolicyRepo) List(_ context.Context, shopID string) ([]shops.BarberBookingPolicy, error) {
	f.lastShopID = shopID
	out := []shops.BarberBookingPolicy{}
	for _, p := range f.own {
		out = append(out, p)
	}
	return out, nil
}

func (f *fakeBarberPolicyRepo) Get(_ context.Context, _, barberID string) (shops.BarberBookingPolicy, bool, error) {
	p, ok := f.own[barberID]
	return p, ok, nil
}

func (f *fakeBarberPolicyRepo) Upsert(_ context.Context, shopID, barberID string, in shops.BarberBookingPolicyInput) (shops.BarberBookingPolicy, bool, error) {
	f.lastShopID = shopID
	if barberID != handlerPolicyBarberID {
		return shops.BarberBookingPolicy{}, false, nil
	}
	p := shops.BarberBookingPolicy{BarberID: barberID, MinAdvanceMinutes: in.MinAdvanceMinutes, MaxAdvanceDays: in.MaxAdvanceDays, SlotGridMinutes: in.SlotGridMinutes}
	f.own[barberID] = p
	return p, true, nil
}

func (f *fakeBarberPolicyRepo) Delete(_ context.Context, _, barberID string) error {
	delete(f.own, barberID)
	return nil
}

func newBarberPolicyHandler() (*httpapi.BarberBookingPolicyHandler, *fakeBarberPolicyRepo) {
	repo := &fakeBarberPolicyRepo{own: map[string]shops.BarberBookingPolicy{}}
	shared := shops.NewBookingPolicyService(&fakeBookingPolicyRepository{getFound: true})
	return httpapi.NewBarberBookingPolicyHandler(shops.NewBarberBookingPolicyService(repo, shared)), repo
}

func TestBarberBookingPolicyHandler_PutThenList(t *testing.T) {
	h, repo := newBarberPolicyHandler()

	req := httpserver.RequestWithURLParam(requestWithPrincipal(http.MethodPut,
		"/api/v1/private/settings/booking-policy/barbers/"+handlerPolicyBarberID,
		[]byte(`{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40}`)), "barberId", handlerPolicyBarberID)
	rec := httptest.NewRecorder()
	h.Put(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var put map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &put)
	if put["barberId"] != handlerPolicyBarberID || put["slotGridMinutes"] != float64(40) || len(put) != 4 {
		t.Fatalf("PUT: cuerpo inesperado: %v", put)
	}
	if repo.lastShopID != testShopID {
		t.Fatalf("el tenant debe salir del principal, got %q", repo.lastShopID)
	}

	rec = httptest.NewRecorder()
	h.List(rec, requestWithPrincipal(http.MethodGet, "/api/v1/private/settings/booking-policy/barbers", nil))
	var list struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if rec.Code != http.StatusOK || len(list.Items) != 1 || list.Items[0]["barberId"] != handlerPolicyBarberID {
		t.Fatalf("GET: expected the saved policy, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestBarberBookingPolicyHandler_ListEmpty_ReturnsEmptyArray(t *testing.T) {
	h, _ := newBarberPolicyHandler()
	rec := httptest.NewRecorder()
	h.List(rec, requestWithPrincipal(http.MethodGet, "/api/v1/private/settings/booking-policy/barbers", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"items\":[]}\n" {
		t.Fatalf("expected {\"items\":[]}, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestBarberBookingPolicyHandler_PutRejections(t *testing.T) {
	cases := []struct {
		name, barberID, body string
		want                 int
	}{
		{"campo desconocido", handlerPolicyBarberID, `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40,"barbershopId":"x"}`, http.StatusBadRequest},
		{"JSON roto", handlerPolicyBarberID, `{`, http.StatusBadRequest},
		{"fuera de rango", handlerPolicyBarberID, `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":61}`, http.StatusUnprocessableEntity},
		{"barbero inexistente", "d1690000-0000-4000-8000-0000000000ff", `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40}`, http.StatusNotFound},
		{"barbero mal formado", "nope", `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40}`, http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, _ := newBarberPolicyHandler()
			req := httpserver.RequestWithURLParam(requestWithPrincipal(http.MethodPut,
				"/api/v1/private/settings/booking-policy/barbers/"+tc.barberID, []byte(tc.body)), "barberId", tc.barberID)
			rec := httptest.NewRecorder()
			h.Put(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("expected %d, got %d: %s", tc.want, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestBarberBookingPolicyHandler_Delete_Returns204Idempotent(t *testing.T) {
	h, repo := newBarberPolicyHandler()
	repo.own[handlerPolicyBarberID] = shops.BarberBookingPolicy{BarberID: handlerPolicyBarberID}
	for i := 0; i < 2; i++ {
		req := httpserver.RequestWithURLParam(requestWithPrincipal(http.MethodDelete,
			"/api/v1/private/settings/booking-policy/barbers/"+handlerPolicyBarberID, nil), "barberId", handlerPolicyBarberID)
		rec := httptest.NewRecorder()
		h.Delete(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("intento %d: expected 204, got %d", i+1, rec.Code)
		}
	}
	if len(repo.own) != 0 {
		t.Fatal("DELETE debe dejar al barbero heredando")
	}
}
