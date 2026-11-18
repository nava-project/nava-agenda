// Pruebas HTTP de los dos agregados de solo lectura (DEC-162):
// GET /public/businesses/{slug}/professionals y
// GET /public/businesses/{slug}/services/{serviceId}/availability. Invocan
// los handlers reales con dobles solo en los puertos del núcleo; la
// consulta SQL y el aislamiento de tenant se prueban con PostgreSQL real en
// publicbooking/postgres y en cmd/api.
package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/modules/publicbooking/httpapi"
	"nava-agenda/internal/platform/httpserver"
)

const (
	aggProfessionalAID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	aggProfessionalBID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
)

func requestProfessionalsAggregate(slug string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/public/businesses/"+slug+"/professionals", nil)
	return httpserver.RequestWithURLParam(req, "slug", slug)
}

func TestListPublicProfessionalsWithServicesHandler_Success_ReturnsIdFullNameAndServiceIds(t *testing.T) {
	repo := &fakeRepository{
		withServicesFound: true,
		withServicesResult: publicbooking.PublicProfessionalServicesListResult{Items: []publicbooking.PublicProfessionalServices{
			{ID: aggProfessionalAID, FullName: "Ana Gómez", ServiceIDs: []string{validServiceID, "22222222-2222-2222-2222-222222222222"}},
			{ID: aggProfessionalBID, FullName: "Luis Rojas", ServiceIDs: []string{validServiceID}},
		}},
	}
	h := httpapi.NewListPublicProfessionalsWithServicesHandler(publicbooking.NewService(repo))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestProfessionalsAggregate("barberia-ejemplo"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	// Forma exacta: solo id, fullName y serviceIds por elemento (nada de
	// descripción, fotografía, reseñas ni identificadores de tenant).
	var raw struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(raw.Items) != 2 {
		t.Fatalf("expected 2 items, got %v", raw.Items)
	}
	for _, item := range raw.Items {
		if len(item) != 3 {
			t.Fatalf("cada elemento debe tener exactamente id, fullName y serviceIds: %v", item)
		}
	}
	var body httpapi.PublicProfessionalServicesListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Items[0].ID != aggProfessionalAID || body.Items[0].FullName != "Ana Gómez" || len(body.Items[0].ServiceIDs) != 2 {
		t.Fatalf("unexpected first item: %+v", body.Items[0])
	}
	if len(repo.calls) != 1 || repo.calls[0] != "barberia-ejemplo" {
		t.Fatalf("expected a single repository call with the path slug, got %v", repo.calls)
	}
	if strings.Contains(strings.ToLower(rec.Body.String()), "business") {
		t.Fatalf("la respuesta nunca menciona un identificador de tenant: %s", rec.Body.String())
	}
}

func TestListPublicProfessionalsWithServicesHandler_Empty_ReturnsEmptyArrayNotNull(t *testing.T) {
	h := httpapi.NewListPublicProfessionalsWithServicesHandler(publicbooking.NewService(&fakeRepository{withServicesFound: true}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestProfessionalsAggregate("barberia-ejemplo"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"items":[]}` {
		t.Fatalf("body = %s, want {\"items\":[]}", got)
	}
}

func TestListPublicProfessionalsWithServicesHandler_NilServiceIDs_NeverSerializesNull(t *testing.T) {
	repo := &fakeRepository{
		withServicesFound: true,
		withServicesResult: publicbooking.PublicProfessionalServicesListResult{Items: []publicbooking.PublicProfessionalServices{
			{ID: aggProfessionalAID, FullName: "Ana Gómez"},
		}},
	}
	rec := httptest.NewRecorder()
	httpapi.NewListPublicProfessionalsWithServicesHandler(publicbooking.NewService(repo)).ServeHTTP(rec, requestProfessionalsAggregate("barberia-ejemplo"))
	if !strings.Contains(rec.Body.String(), `"serviceIds":[]`) {
		t.Fatalf("serviceIds debe ser un arreglo, nunca null: %s", rec.Body.String())
	}
}

func TestListPublicProfessionalsWithServicesHandler_UnknownOrMalformedSlug_ReturnsUniform404(t *testing.T) {
	for _, slug := range []string{"no-existe", strings.Repeat("a", publicbooking.MaxSlugLength+1)} {
		repo := &fakeRepository{withServicesFound: false}
		rec := httptest.NewRecorder()
		httpapi.NewListPublicProfessionalsWithServicesHandler(publicbooking.NewService(repo)).ServeHTTP(rec, requestProfessionalsAggregate(slug))

		if rec.Code != http.StatusNotFound {
			t.Fatalf("slug %q: expected 404, got %d: %s", slug, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
			t.Fatalf("Content-Type = %q", ct)
		}
		if !strings.Contains(rec.Body.String(), "no existe un negocio público con ese enlace") {
			t.Fatalf("debe ser el 404 uniforme de HU-090: %s", rec.Body.String())
		}
	}
}

func TestListPublicProfessionalsWithServicesHandler_RepositoryError_ReturnsSafe500(t *testing.T) {
	repo := &fakeRepository{withServicesErr: errors.New("boom")}
	rec := httptest.NewRecorder()
	httpapi.NewListPublicProfessionalsWithServicesHandler(publicbooking.NewService(repo)).ServeHTTP(rec, requestProfessionalsAggregate("barberia-ejemplo"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Fatalf("CA-003-02: la causa interna no debe llegar al cuerpo: %s", rec.Body.String())
	}
}

// aggAvailabilityRepo entrega profesionales elegibles fijos al agregado de
// disponibilidad.
type aggAvailabilityRepo struct {
	*confirmFakeAvailabilityRepository
	professionalIDs []string
	err             error
}

func (f *aggAvailabilityRepo) ListServiceProfessionalIDs(context.Context, string, string) ([]string, error) {
	return f.professionalIDs, f.err
}

func newServiceAvailabilityHandler(repo *aggAvailabilityRepo) *httpapi.ListPublicServiceAvailabilityHandler {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	svc := publicbooking.NewAvailabilityService(
		repo, confirmFakeEffectiveDay{}, confirmFakeBusyBlocks{}, confirmFakeBookingPolicy{},
		confirmFakeServiceAssignment{}, confirmFakeAvailabilityTimezone{}, confirmFakeClock{now: now},
	)
	return httpapi.NewListPublicServiceAvailabilityHandler(svc)
}

func requestServiceAvailability(slug, serviceID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/public/businesses/"+slug+"/services/"+serviceID+"/availability", nil)
	req = httpserver.RequestWithURLParam(req, "slug", slug)
	return httpserver.RequestWithURLParam(req, "serviceId", serviceID)
}

func TestListPublicServiceAvailabilityHandler_Success_ReturnsProfessionalSlotsOrdered(t *testing.T) {
	repo := &aggAvailabilityRepo{
		confirmFakeAvailabilityRepository: &confirmFakeAvailabilityRepository{businessID: "shop-1", found: true},
		professionalIDs:                   []string{aggProfessionalBID, aggProfessionalAID},
	}
	rec := httptest.NewRecorder()
	newServiceAvailabilityHandler(repo).ServeHTTP(rec, requestServiceAvailability("barberia-ejemplo", validServiceID))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body httpapi.ServiceAvailabilityResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DurationMinutes != 30 || body.Timezone != "America/Bogota" || body.SlotGridMinutes != 30 {
		t.Fatalf("contexto inesperado: %+v", body)
	}
	if len(body.Slots) == 0 || len(body.Slots)%2 != 0 {
		t.Fatalf("esperaba franjas de los dos profesionales, got %d", len(body.Slots))
	}
	for i := 0; i < len(body.Slots); i += 2 {
		a, b := body.Slots[i], body.Slots[i+1]
		if !a.StartsAt.Equal(b.StartsAt) || a.ProfessionalID != aggProfessionalAID || b.ProfessionalID != aggProfessionalBID {
			t.Fatalf("par %d fuera de orden (startsAt, professionalId): %+v %+v", i/2, a, b)
		}
		if i > 0 && !a.StartsAt.After(body.Slots[i-1].StartsAt) {
			t.Fatalf("startsAt no crece en el par %d", i/2)
		}
	}
	// Forma exacta de cada franja: solo professionalId y startsAt.
	var raw struct {
		Slots []map[string]any `json:"slots"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := raw.Slots[0]["professionalId"]; len(raw.Slots[0]) != 2 || !ok {
		t.Fatalf("cada franja debe tener solo professionalId y startsAt: %v", raw.Slots[0])
	}
}

func TestListPublicServiceAvailabilityHandler_NoEligibleProfessionals_ReturnsUniformEmpty(t *testing.T) {
	repo := &aggAvailabilityRepo{confirmFakeAvailabilityRepository: &confirmFakeAvailabilityRepository{businessID: "shop-1", found: true}}
	for _, serviceID := range []string{validServiceID, "no-es-un-uuid"} {
		rec := httptest.NewRecorder()
		newServiceAvailabilityHandler(repo).ServeHTTP(rec, requestServiceAvailability("barberia-ejemplo", serviceID))

		if rec.Code != http.StatusOK {
			t.Fatalf("serviceId %q: expected 200, got %d: %s", serviceID, rec.Code, rec.Body.String())
		}
		want := `{"slots":[],"durationMinutes":0,"timezone":"","slotGridMinutes":0}`
		if got := strings.TrimSpace(rec.Body.String()); got != want {
			t.Fatalf("serviceId %q: body = %s, want %s", serviceID, got, want)
		}
	}
}

func TestListPublicServiceAvailabilityHandler_UnknownSlug_ReturnsUniform404(t *testing.T) {
	repo := &aggAvailabilityRepo{confirmFakeAvailabilityRepository: &confirmFakeAvailabilityRepository{found: false}}
	rec := httptest.NewRecorder()
	newServiceAvailabilityHandler(repo).ServeHTTP(rec, requestServiceAvailability("no-existe", validServiceID))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q", ct)
	}
}

func TestListPublicServiceAvailabilityHandler_RepositoryError_ReturnsSafe500(t *testing.T) {
	repo := &aggAvailabilityRepo{
		confirmFakeAvailabilityRepository: &confirmFakeAvailabilityRepository{businessID: "shop-1", found: true},
		err:                               errors.New("boom"),
	}
	rec := httptest.NewRecorder()
	newServiceAvailabilityHandler(repo).ServeHTTP(rec, requestServiceAvailability("barberia-ejemplo", validServiceID))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Fatalf("CA-003-02: la causa interna no debe llegar al cuerpo: %s", rec.Body.String())
	}
}
