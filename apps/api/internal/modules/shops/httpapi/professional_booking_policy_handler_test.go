package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/modules/shops/httpapi"
	"nava-agenda/internal/platform/httpserver"
)

const handlerPolicyProfessionalID = "d1690000-0000-4000-8000-000000000001"

// fakeProfessionalPolicyRepo es un doble en memoria del repositorio de DEC-169:
// estas pruebas cubren el adaptador HTTP (decodificación cerrada, principal,
// parámetro de ruta, códigos), no PostgreSQL.
type fakeProfessionalPolicyRepo struct {
	own        map[string]shops.ProfessionalBookingPolicy
	lastShopID string
}

func (f *fakeProfessionalPolicyRepo) List(_ context.Context, shopID string) ([]shops.ProfessionalBookingPolicy, error) {
	f.lastShopID = shopID
	out := []shops.ProfessionalBookingPolicy{}
	for _, p := range f.own {
		out = append(out, p)
	}
	return out, nil
}

func (f *fakeProfessionalPolicyRepo) Get(_ context.Context, _, professionalID string) (shops.ProfessionalBookingPolicy, bool, error) {
	p, ok := f.own[professionalID]
	return p, ok, nil
}

func (f *fakeProfessionalPolicyRepo) Upsert(_ context.Context, shopID, professionalID string, in shops.ProfessionalBookingPolicyInput) (shops.ProfessionalBookingPolicy, bool, error) {
	f.lastShopID = shopID
	if professionalID != handlerPolicyProfessionalID {
		return shops.ProfessionalBookingPolicy{}, false, nil
	}
	p := shops.ProfessionalBookingPolicy{ProfessionalID: professionalID, MinAdvanceMinutes: in.MinAdvanceMinutes, MaxAdvanceDays: in.MaxAdvanceDays, SlotGridMinutes: in.SlotGridMinutes}
	f.own[professionalID] = p
	return p, true, nil
}

func (f *fakeProfessionalPolicyRepo) Delete(_ context.Context, _, professionalID string) error {
	delete(f.own, professionalID)
	return nil
}

func newProfessionalPolicyHandler() (*httpapi.ProfessionalBookingPolicyHandler, *fakeProfessionalPolicyRepo) {
	repo := &fakeProfessionalPolicyRepo{own: map[string]shops.ProfessionalBookingPolicy{}}
	shared := shops.NewBookingPolicyService(&fakeBookingPolicyRepository{getFound: true})
	return httpapi.NewProfessionalBookingPolicyHandler(shops.NewProfessionalBookingPolicyService(repo, shared)), repo
}

func TestProfessionalBookingPolicyHandler_PutThenList(t *testing.T) {
	h, repo := newProfessionalPolicyHandler()

	req := httpserver.RequestWithURLParam(requestWithPrincipal(http.MethodPut,
		"/api/v1/private/settings/booking-policy/professionals/"+handlerPolicyProfessionalID,
		[]byte(`{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40}`)), "professionalId", handlerPolicyProfessionalID)
	rec := httptest.NewRecorder()
	h.Put(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var put map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &put)
	if put["professionalId"] != handlerPolicyProfessionalID || put["slotGridMinutes"] != float64(40) || len(put) != 4 {
		t.Fatalf("PUT: cuerpo inesperado: %v", put)
	}
	if repo.lastShopID != testShopID {
		t.Fatalf("el tenant debe salir del principal, got %q", repo.lastShopID)
	}

	rec = httptest.NewRecorder()
	h.List(rec, requestWithPrincipal(http.MethodGet, "/api/v1/private/settings/booking-policy/professionals", nil))
	var list struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if rec.Code != http.StatusOK || len(list.Items) != 1 || list.Items[0]["professionalId"] != handlerPolicyProfessionalID {
		t.Fatalf("GET: expected the saved policy, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestProfessionalBookingPolicyHandler_ListEmpty_ReturnsEmptyArray(t *testing.T) {
	h, _ := newProfessionalPolicyHandler()
	rec := httptest.NewRecorder()
	h.List(rec, requestWithPrincipal(http.MethodGet, "/api/v1/private/settings/booking-policy/professionals", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"items\":[]}\n" {
		t.Fatalf("expected {\"items\":[]}, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestProfessionalBookingPolicyHandler_PutRejections(t *testing.T) {
	cases := []struct {
		name, professionalID, body string
		want                       int
	}{
		{"campo desconocido", handlerPolicyProfessionalID, `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40,"businessId":"x"}`, http.StatusBadRequest},
		{"JSON roto", handlerPolicyProfessionalID, `{`, http.StatusBadRequest},
		{"fuera de rango", handlerPolicyProfessionalID, `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":61}`, http.StatusUnprocessableEntity},
		{"profesional inexistente", "d1690000-0000-4000-8000-0000000000ff", `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40}`, http.StatusNotFound},
		{"profesional mal formado", "nope", `{"minAdvanceMinutes":30,"maxAdvanceDays":7,"slotGridMinutes":40}`, http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, _ := newProfessionalPolicyHandler()
			req := httpserver.RequestWithURLParam(requestWithPrincipal(http.MethodPut,
				"/api/v1/private/settings/booking-policy/professionals/"+tc.professionalID, []byte(tc.body)), "professionalId", tc.professionalID)
			rec := httptest.NewRecorder()
			h.Put(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("expected %d, got %d: %s", tc.want, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestProfessionalBookingPolicyHandler_Delete_Returns204Idempotent(t *testing.T) {
	h, repo := newProfessionalPolicyHandler()
	repo.own[handlerPolicyProfessionalID] = shops.ProfessionalBookingPolicy{ProfessionalID: handlerPolicyProfessionalID}
	for i := 0; i < 2; i++ {
		req := httpserver.RequestWithURLParam(requestWithPrincipal(http.MethodDelete,
			"/api/v1/private/settings/booking-policy/professionals/"+handlerPolicyProfessionalID, nil), "professionalId", handlerPolicyProfessionalID)
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
