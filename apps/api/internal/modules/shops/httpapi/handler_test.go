package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/modules/shops/httpapi"
)

type updateCall struct {
	businessID string
	input      shops.UpdateInput
}

// fakeRepository es un doble en memoria de shops.Repository: estas pruebas
// verifican el adaptador HTTP en aislamiento (decodificación, forma cerrada,
// extracción del principal, traducción de errores), no PostgreSQL real
// (esa cobertura vive en internal/modules/shops/postgres/repository_test.go).
type fakeRepository struct {
	getBusiness shops.Business
	getFound    bool
	getErr      error
	getCalls    []string

	updateResult shops.UpdateResult
	updateErr    error
	updateCalls  []updateCall
}

func (f *fakeRepository) Get(_ context.Context, businessID string) (shops.Business, bool, error) {
	f.getCalls = append(f.getCalls, businessID)
	return f.getBusiness, f.getFound, f.getErr
}

func (f *fakeRepository) Update(_ context.Context, businessID string, input shops.UpdateInput) (shops.UpdateResult, error) {
	f.updateCalls = append(f.updateCalls, updateCall{businessID, input})
	return f.updateResult, f.updateErr
}

var _ shops.Repository = (*fakeRepository)(nil)

const testShopID = "11111111-1111-1111-1111-111111111111"

func requestWithPrincipal(method, target string, body []byte) *http.Request {
	var req *http.Request
	if body == nil {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, bytes.NewReader(body))
	}
	principal := auth.Principal{SessionID: "s-1", StaffUserID: "u-1", BusinessID: testShopID}
	return req.WithContext(auth.ContextWithPrincipal(req.Context(), principal))
}

// --- GET ------------------------------------------------------------------

func TestGetBusinessSettingsHandler_Success_ReturnsFourAuthorizedFields(t *testing.T) {
	email := "contacto@ejemplo.test"
	repo := &fakeRepository{
		getFound: true,
		getBusiness: shops.Business{
			Name: "Barbería Ejemplo", Timezone: "America/Bogota", ContactEmail: &email,
		},
	}
	h := httpapi.NewGetBusinessSettingsHandler(shops.NewService(repo))

	req := requestWithPrincipal(http.MethodGet, "/api/v1/private/settings/business", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body httpapi.BusinessSettingsResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if body.Name != "Barbería Ejemplo" || body.Timezone != "America/Bogota" {
		t.Fatalf("unexpected response: %+v", body)
	}
	if body.ContactEmail == nil || *body.ContactEmail != email {
		t.Fatalf("expected contactEmail=%q, got %v", email, body.ContactEmail)
	}
	if body.ContactPhone != nil {
		t.Fatalf("expected contactPhone=null, got %q", *body.ContactPhone)
	}
	// CA-020-07: el cuerpo nunca menciona un campo fuera de los cuatro
	// autorizados (public_slug, logo, businessId, etc.).
	raw := strings.ToLower(rec.Body.String())
	for _, forbidden := range []string{"publicslug", "logo", "businessid"} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("CA-020-07: response body must never mention %q: %s", forbidden, raw)
		}
	}
}

func TestGetBusinessSettingsHandler_MissingPrincipalInContext_ReturnsSafe500(t *testing.T) {
	repo := &fakeRepository{}
	h := httpapi.NewGetBusinessSettingsHandler(shops.NewService(repo))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/settings/business", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.getCalls) != 0 {
		t.Fatal("expected Repository.Get to never be invoked without a principal in context")
	}
}

// --- PATCH ------------------------------------------------------------------

func TestUpdateBusinessSettingsHandler_Success_ReturnsSavedRepresentation(t *testing.T) {
	saved := shops.Business{Name: "Barbería Nueva", Timezone: "America/Bogota"}
	repo := &fakeRepository{updateResult: shops.UpdateResult{Business: saved, TimezoneValid: true, Found: true}}
	h := httpapi.NewUpdateBusinessSettingsHandler(shops.NewService(repo))

	body := []byte(`{"name":"Barbería Nueva","timezone":"America/Bogota","contactEmail":"","contactPhone":""}`)
	req := requestWithPrincipal(http.MethodPatch, "/api/v1/private/settings/business", body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.updateCalls) != 1 {
		t.Fatalf("expected exactly one Update call, got %d", len(repo.updateCalls))
	}
	if repo.updateCalls[0].businessID != testShopID {
		t.Fatalf("expected businessID=%q from the principal, got %q", testShopID, repo.updateCalls[0].businessID)
	}
}

func TestUpdateBusinessSettingsHandler_UnknownField_ReturnsInvalidRequest(t *testing.T) {
	repo := &fakeRepository{}
	h := httpapi.NewUpdateBusinessSettingsHandler(shops.NewService(repo))

	body := []byte(`{"name":"x","timezone":"America/Bogota","contactEmail":"","contactPhone":"","businessId":"22222222-2222-2222-2222-222222222222"}`)
	req := requestWithPrincipal(http.MethodPatch, "/api/v1/private/settings/business", body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// CA-020-05: businessId nunca se acepta como campo del cuerpo; un
	// intento de enviarlo se rechaza como forma inválida, la misma respuesta
	// que cualquier otro campo desconocido, y jamás se invoca el servicio.
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.updateCalls) != 0 {
		t.Fatal("expected Repository.Update to never be called for a request with an unknown field")
	}
}

func TestUpdateBusinessSettingsHandler_MalformedJSON_ReturnsInvalidRequest(t *testing.T) {
	repo := &fakeRepository{}
	h := httpapi.NewUpdateBusinessSettingsHandler(shops.NewService(repo))

	req := requestWithPrincipal(http.MethodPatch, "/api/v1/private/settings/business", []byte(`{not-json`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateBusinessSettingsHandler_ValidationError_ReturnsUnprocessableEntity(t *testing.T) {
	repo := &fakeRepository{}
	h := httpapi.NewUpdateBusinessSettingsHandler(shops.NewService(repo))

	body := []byte(`{"name":"","timezone":"America/Bogota","contactEmail":"","contactPhone":""}`)
	req := requestWithPrincipal(http.MethodPatch, "/api/v1/private/settings/business", body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.updateCalls) != 0 {
		t.Fatal("expected Repository.Update to never be called for an empty name")
	}
}

func TestUpdateBusinessSettingsHandler_InvalidTimezone_ReturnsUnprocessableEntityWithoutPartialWrite(t *testing.T) {
	repo := &fakeRepository{updateResult: shops.UpdateResult{TimezoneValid: false}}
	h := httpapi.NewUpdateBusinessSettingsHandler(shops.NewService(repo))

	body := []byte(`{"name":"Barbería Ejemplo","timezone":"COT","contactEmail":"","contactPhone":""}`)
	req := requestWithPrincipal(http.MethodPatch, "/api/v1/private/settings/business", body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateBusinessSettingsHandler_MissingPrincipalInContext_ReturnsSafe500(t *testing.T) {
	repo := &fakeRepository{}
	h := httpapi.NewUpdateBusinessSettingsHandler(shops.NewService(repo))

	body := []byte(`{"name":"x","timezone":"America/Bogota","contactEmail":"","contactPhone":""}`)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/private/settings/business", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.updateCalls) != 0 {
		t.Fatal("expected Repository.Update to never be invoked without a principal in context")
	}
}
