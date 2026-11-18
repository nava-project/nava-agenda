package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/modules/staff/httpapi"
	"nava-agenda/internal/platform/httpserver"
	"nava-agenda/internal/platform/idempotency"
)

// fakeRepository es un doble en memoria de staff.Repository: estas pruebas
// verifican el adaptador HTTP en aislamiento (decodificación, forma
// cerrada, extracción del principal, headers, traducción de errores), no
// PostgreSQL real (esa cobertura vive en
// internal/modules/staff/postgres/repository_test.go).
type fakeRepository struct {
	listPageFn func(context.Context, string, int, int) (staff.PageResult, error)
	listFn     func(businessID string, cursor *staff.Cursor, limit int) (staff.ListResult, error)
	getFn      func(businessID, professionalID string) (staff.Professional, bool, error)
	createFn   func(businessID, fullName string, description *string, key idempotency.Key, fp idempotency.Fingerprint) (staff.CreateResult, error)
	updateFn   func(businessID, professionalID, fullName string, description staff.DescriptionPatch) (staff.UpdateResult, error)

	putPhotoFn    func(businessID, professionalID string, photo staff.Photo) (staff.PhotoResult, error)
	getPhotoFn    func(businessID, professionalID string) (staff.StoredPhoto, bool, error)
	deletePhotoFn func(businessID, professionalID string) (bool, error)

	getLinkedFn func(businessID, staffUserID string) (staff.Professional, bool, error)
	linkFn      func(businessID, staffUserID, professionalID string) (staff.LinkResult, error)
	unlinkFn    func(businessID, staffUserID string) (string, error)
}

func (f *fakeRepository) List(_ context.Context, businessID string, cursor *staff.Cursor, limit int) (staff.ListResult, error) {
	return f.listFn(businessID, cursor, limit)
}

func (f *fakeRepository) Get(_ context.Context, businessID, professionalID string) (staff.Professional, bool, error) {
	return f.getFn(businessID, professionalID)
}

func (f *fakeRepository) Create(_ context.Context, businessID, fullName string, description *string, key idempotency.Key, fp idempotency.Fingerprint) (staff.CreateResult, error) {
	return f.createFn(businessID, fullName, description, key, fp)
}

func (f *fakeRepository) Update(_ context.Context, businessID, professionalID, fullName string, description staff.DescriptionPatch) (staff.UpdateResult, error) {
	return f.updateFn(businessID, professionalID, fullName, description)
}

func (f *fakeRepository) PutPhoto(_ context.Context, businessID, professionalID string, photo staff.Photo) (staff.PhotoResult, error) {
	return f.putPhotoFn(businessID, professionalID, photo)
}

func (f *fakeRepository) GetPhoto(_ context.Context, businessID, professionalID string) (staff.StoredPhoto, bool, error) {
	return f.getPhotoFn(businessID, professionalID)
}

func (f *fakeRepository) DeletePhoto(_ context.Context, businessID, professionalID string) (bool, error) {
	return f.deletePhotoFn(businessID, professionalID)
}

func (f *fakeRepository) GetLinked(_ context.Context, businessID, staffUserID string) (staff.Professional, bool, error) {
	return f.getLinkedFn(businessID, staffUserID)
}

func (f *fakeRepository) Link(_ context.Context, businessID, staffUserID, professionalID string) (staff.LinkResult, error) {
	return f.linkFn(businessID, staffUserID, professionalID)
}

func (f *fakeRepository) Unlink(_ context.Context, businessID, staffUserID string) (string, error) {
	return f.unlinkFn(businessID, staffUserID)
}

var _ staff.Repository = (*fakeRepository)(nil)

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

func requestWithProfessionalID(method, target string, body []byte, professionalID string) *http.Request {
	r := requestWithPrincipal(method, target, body)
	return httpserver.RequestWithURLParam(r, "professionalId", professionalID)
}

func decodeProblem(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var problem map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decode problem body: %v (%s)", err, rec.Body.String())
	}
	return problem
}

// --- List -------------------------------------------------------------

func TestListProfessionalsHandler_Success_ReturnsItemsAndCursor(t *testing.T) {
	now := time.Now().UTC()
	repo := &fakeRepository{listFn: func(businessID string, cursor *staff.Cursor, limit int) (staff.ListResult, error) {
		if businessID != testShopID {
			t.Fatalf("expected shop %q, got %q", testShopID, businessID)
		}
		if limit != staff.DefaultListLimit {
			t.Fatalf("expected default limit, got %d", limit)
		}
		if cursor != nil {
			t.Fatalf("expected nil cursor, got %+v", cursor)
		}
		return staff.ListResult{
			Items: []staff.Professional{
				{ID: "b-1", FullName: "Carlos", CreatedAt: now, UpdatedAt: now},
			},
			NextCursor: "opaque-cursor",
		}, nil
	}}
	h := httpapi.NewListProfessionalsHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodGet, "/api/v1/private/professionals", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body httpapi.ProfessionalListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Items) != 1 || body.Items[0].ID != "b-1" {
		t.Fatalf("unexpected items: %+v", body.Items)
	}
	if body.NextCursor == nil || *body.NextCursor != "opaque-cursor" {
		t.Fatalf("expected nextCursor to round-trip, got %v", body.NextCursor)
	}
}

func TestListProfessionalsHandler_NoNextPage_ReturnsExplicitNull(t *testing.T) {
	repo := &fakeRepository{listFn: func(string, *staff.Cursor, int) (staff.ListResult, error) {
		return staff.ListResult{Items: []staff.Professional{}, NextCursor: ""}, nil
	}}
	h := httpapi.NewListProfessionalsHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodGet, "/api/v1/private/professionals", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !strings.Contains(rec.Body.String(), `"nextCursor":null`) {
		t.Fatalf("expected explicit null nextCursor in body, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"items":[]`) {
		t.Fatalf("expected an explicit empty array for items, got %s", rec.Body.String())
	}
}

func TestListProfessionalsHandler_ForwardsCursorAndLimitFromQuery(t *testing.T) {
	repo := &fakeRepository{listFn: func(_ string, cursor *staff.Cursor, limit int) (staff.ListResult, error) {
		if limit != 5 {
			t.Fatalf("expected limit=5, got %d", limit)
		}
		if cursor == nil {
			t.Fatal("expected a decoded cursor")
		}
		return staff.ListResult{}, nil
	}}
	h := httpapi.NewListProfessionalsHandler(staff.NewService(repo))

	token := staff.EncodeCursor(staff.Cursor{CreatedAt: time.Now(), ID: "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"})
	req := requestWithPrincipal(http.MethodGet, "/api/v1/private/professionals?cursor="+token+"&limit=5", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestListProfessionalsHandler_InvalidLimit_Returns400(t *testing.T) {
	repo := &fakeRepository{listFn: func(string, *staff.Cursor, int) (staff.ListResult, error) {
		t.Fatal("repository must not be called for an invalid limit")
		return staff.ListResult{}, nil
	}}
	h := httpapi.NewListProfessionalsHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodGet, "/api/v1/private/professionals?limit=not-a-number", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestListProfessionalsHandler_InvalidCursor_Returns400(t *testing.T) {
	repo := &fakeRepository{listFn: func(string, *staff.Cursor, int) (staff.ListResult, error) {
		t.Fatal("repository must not be called for an invalid cursor")
		return staff.ListResult{}, nil
	}}
	h := httpapi.NewListProfessionalsHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodGet, "/api/v1/private/professionals?cursor=not-a-valid-cursor-token%21%21%21", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// --- Get ----------------------------------------------------------------

func TestGetProfessionalHandler_Found_ReturnsProfessional(t *testing.T) {
	now := time.Now().UTC()
	repo := &fakeRepository{getFn: func(businessID, professionalID string) (staff.Professional, bool, error) {
		if businessID != testShopID || professionalID != "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4" {
			t.Fatalf("unexpected args: %s %s", businessID, professionalID)
		}
		return staff.Professional{ID: professionalID, FullName: "Carlos", CreatedAt: now, UpdatedAt: now}, true, nil
	}}
	h := httpapi.NewGetProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodGet, "/api/v1/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4", nil, "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProfessionalHandler_NotFound_Returns404(t *testing.T) {
	repo := &fakeRepository{getFn: func(string, string) (staff.Professional, bool, error) {
		return staff.Professional{}, false, nil
	}}
	h := httpapi.NewGetProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodGet, "/api/v1/private/professionals/99999999-9999-4999-8999-999999999999", nil, "99999999-9999-4999-8999-999999999999")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	problem := decodeProblem(t, rec)
	if problem["code"] != "not-found" {
		t.Fatalf("expected code=not-found, got %v", problem["code"])
	}
}

func TestGetProfessionalHandler_OtherTenantsID_SameNotFoundAsNonexistent(t *testing.T) {
	// CA-021-05: el handler nunca puede distinguir "no existe" de "es de
	// otro negocio" porque el servicio ya colapsó ambos en el mismo
	// resultado found=false; esta prueba confirma que el handler no
	// introduce una distinción nueva encima de eso.
	repo := &fakeRepository{getFn: func(string, string) (staff.Professional, bool, error) {
		return staff.Professional{}, false, nil
	}}
	h := httpapi.NewGetProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodGet, "/api/v1/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4", nil, "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// --- Create ---------------------------------------------------------------

func TestCreateProfessionalHandler_MissingIdempotencyKey_Returns400(t *testing.T) {
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		t.Fatal("repository must not be called without an idempotency key")
		return staff.CreateResult{}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Carlos"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateProfessionalHandler_UnknownField_Returns400(t *testing.T) {
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		t.Fatal("repository must not be called for an unknown field")
		return staff.CreateResult{}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Carlos","active":true}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateProfessionalHandler_ValidationError_Returns422WithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		t.Fatal("repository must not be called for an invalid name")
		return staff.CreateResult{}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":""}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateProfessionalHandler_Proceed_Returns201WithLocationAndBody(t *testing.T) {
	now := time.Now().UTC()
	stored := idempotency.StoredResponse{
		Status:      201,
		ContentType: "application/json",
		Body:        `{"id":"8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4","fullName":"Carlos","createdAt":"` + now.Format(time.RFC3339Nano) + `","updatedAt":"` + now.Format(time.RFC3339Nano) + `"}`,
	}
	repo := &fakeRepository{createFn: func(businessID, fullName string, _ *string, key idempotency.Key, fp idempotency.Fingerprint) (staff.CreateResult, error) {
		if businessID != testShopID {
			t.Fatalf("unexpected shop: %s", businessID)
		}
		if fullName != "Carlos" {
			t.Fatalf("unexpected fullName: %s", fullName)
		}
		if key != "key-1" {
			t.Fatalf("unexpected key: %s", key)
		}
		return staff.CreateResult{
			Decision:     idempotency.Decision{Outcome: idempotency.OutcomeProceed},
			Professional: staff.Professional{ID: "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4", FullName: "Carlos", CreatedAt: now, UpdatedAt: now},
			Response:     stored,
		}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Carlos"}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4" {
		t.Fatalf("unexpected Location header: %q", loc)
	}
	if rec.Body.String() != stored.Body {
		t.Fatalf("expected the exact stored body, got %s", rec.Body.String())
	}
}

func TestCreateProfessionalHandler_Replay_ReturnsSameStatusAndBodyWithLocation(t *testing.T) {
	stored := idempotency.StoredResponse{
		Status:      201,
		ContentType: "application/json",
		Body:        `{"id":"8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4","fullName":"Carlos","createdAt":"2026-08-23T15:04:05Z","updatedAt":"2026-08-23T15:04:05Z"}`,
	}
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		return staff.CreateResult{
			Decision: idempotency.Decision{Outcome: idempotency.OutcomeReplay, Response: stored},
			Response: stored,
		}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Carlos"}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected the same original 201 on replay, got %d", rec.Code)
	}
	if rec.Body.String() != stored.Body {
		t.Fatalf("expected the exact original body on replay, got %s", rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4" {
		t.Fatalf("expected Location to be reconstructed on replay too, got %q", loc)
	}
}

func TestCreateProfessionalHandler_ConflictFingerprint_Returns409(t *testing.T) {
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		return staff.CreateResult{Decision: idempotency.Decision{Outcome: idempotency.OutcomeConflictFingerprint}}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Carlos"}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	problem := decodeProblem(t, rec)
	if problem["code"] != "idempotency-conflict" {
		t.Fatalf("expected code=idempotency-conflict, got %v", problem["code"])
	}
}

func TestCreateProfessionalHandler_Locked_Returns409(t *testing.T) {
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		return staff.CreateResult{Decision: idempotency.Decision{Outcome: idempotency.OutcomeLocked}}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Carlos"}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	problem := decodeProblem(t, rec)
	if problem["code"] != "idempotency-locked" {
		t.Fatalf("expected code=idempotency-locked, got %v", problem["code"])
	}
}

func TestCreateProfessionalHandler_ThroughFullRouter_NeverLogsFullNameOrBody(t *testing.T) {
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		return staff.CreateResult{
			Decision:     idempotency.Decision{Outcome: idempotency.OutcomeProceed},
			Professional: staff.Professional{ID: "b-1", FullName: "Nombre Sensible No Debe Aparecer"},
			Response:     idempotency.StoredResponse{Status: 201, ContentType: "application/json", Body: `{"id":"b-1"}`},
		}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Nombre Sensible No Debe Aparecer"}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// El handler en sí no registra nada (RequestLogger es responsabilidad
	// del middleware, probado aparte); esta prueba solo confirma que la
	// única superficie donde el nombre podría filtrarse por accidente (el
	// propio Location) nunca lo incluye.
	if strings.Contains(rec.Header().Get("Location"), "Sensible") {
		t.Fatal("Location header must never contain the professional's name")
	}
}

// --- Rename ---------------------------------------------------------------

func TestUpdateProfessionalHandler_Success_Returns200(t *testing.T) {
	now := time.Now().UTC()
	repo := &fakeRepository{updateFn: func(businessID, professionalID, fullName string, _ staff.DescriptionPatch) (staff.UpdateResult, error) {
		if fullName != "Nuevo Nombre" {
			t.Fatalf("unexpected fullName: %s", fullName)
		}
		return staff.UpdateResult{Found: true, Professional: staff.Professional{ID: professionalID, FullName: fullName, CreatedAt: now, UpdatedAt: now}}, nil
	}}
	h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4",
		[]byte(`{"fullName":"Nuevo Nombre"}`), "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProfessionalHandler_UnknownField_Returns400(t *testing.T) {
	repo := &fakeRepository{updateFn: func(string, string, string, staff.DescriptionPatch) (staff.UpdateResult, error) {
		t.Fatal("repository must not be called for an unknown field")
		return staff.UpdateResult{}, nil
	}}
	h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4",
		[]byte(`{"fullName":"X","active":false}`), "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProfessionalHandler_EmptyObject_Returns422(t *testing.T) {
	repo := &fakeRepository{updateFn: func(string, string, string, staff.DescriptionPatch) (staff.UpdateResult, error) {
		t.Fatal("repository must not be called for an empty object")
		return staff.UpdateResult{}, nil
	}}
	h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4",
		[]byte(`{}`), "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for an empty object (fullName required), got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProfessionalHandler_NotFound_Returns404(t *testing.T) {
	repo := &fakeRepository{updateFn: func(string, string, string, staff.DescriptionPatch) (staff.UpdateResult, error) {
		return staff.UpdateResult{Found: false}, nil
	}}
	h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/99999999-9999-4999-8999-999999999999",
		[]byte(`{"fullName":"X"}`), "99999999-9999-4999-8999-999999999999")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProfessionalHandler_ValidationError_Returns422(t *testing.T) {
	repo := &fakeRepository{updateFn: func(string, string, string, staff.DescriptionPatch) (staff.UpdateResult, error) {
		t.Fatal("repository must not be called for an invalid name")
		return staff.UpdateResult{}, nil
	}}
	h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

	req := requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4",
		[]byte(`{"fullName":"   "}`), "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
}

// --- Wiring defensivo -------------------------------------------------

func TestHandlers_MissingPrincipal_Returns500Safely(t *testing.T) {
	// Solo puede ocurrir si la ruta se montó fuera del subrouter protegido
	// por SessionMiddleware (CA-006-04 lo evita estructuralmente); esta
	// prueba confirma que, si ocurriera, la respuesta sigue siendo un
	// Problem uniforme y no un panic ni una fuga.
	repo := &fakeRepository{}
	h := httpapi.NewListProfessionalsHandler(staff.NewService(repo))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/professionals", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func (f *fakeRepository) ListPage(ctx context.Context, shop string, page, size int) (staff.PageResult, error) {
	if f.listPageFn != nil {
		return f.listPageFn(ctx, shop, page, size)
	}
	return staff.PageResult{}, nil
}

// --- Descripción del profesional (DEC-127) -------------------------------------

func TestCreateProfessionalHandler_Description_ReachesRepository(t *testing.T) {
	now := time.Now().UTC()
	var got *string
	repo := &fakeRepository{createFn: func(_, _ string, description *string, _ idempotency.Key, _ idempotency.Fingerprint) (staff.CreateResult, error) {
		got = description
		stored := idempotency.StoredResponse{Status: 201, ContentType: "application/json", Body: `{"id":"8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"}`}
		return staff.CreateResult{
			Decision:     idempotency.Decision{Outcome: idempotency.OutcomeProceed},
			Professional: staff.Professional{ID: "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4", FullName: "Carlos", CreatedAt: now, UpdatedAt: now},
			Response:     stored,
		}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(`{"fullName":"Carlos","description":"  Fade y barba  "}`))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if got == nil || *got != "Fade y barba" {
		t.Fatalf("expected the trimmed description in the repository call, got %v", got)
	}
}

func TestCreateProfessionalHandler_DescriptionTooLong_Returns422(t *testing.T) {
	repo := &fakeRepository{createFn: func(string, string, *string, idempotency.Key, idempotency.Fingerprint) (staff.CreateResult, error) {
		t.Fatal("repository must not be called for an invalid description")
		return staff.CreateResult{}, nil
	}}
	h := httpapi.NewCreateProfessionalHandler(staff.NewService(repo))

	body := `{"fullName":"Carlos","description":"` + strings.Repeat("a", staff.DescriptionMaxLength+1) + `"}`
	req := requestWithPrincipal(http.MethodPost, "/api/v1/private/professionals", []byte(body))
	req.Header.Set(httpserver.IdempotencyKeyHeader, "key-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
}

// El PATCH distingue ausente (conserva), null/vacío (quita) y texto (escribe).
func TestUpdateProfessionalHandler_Description_AbsentNullEmptyAndText(t *testing.T) {
	const id = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"
	cases := map[string]struct {
		body      string
		wantSet   bool
		wantValue string // "" = nil
	}{
		"ausente": {`{"fullName":"Carlos"}`, false, ""},
		"null":    {`{"fullName":"Carlos","description":null}`, true, ""},
		"vacía":   {`{"fullName":"Carlos","description":""}`, true, ""},
		"texto":   {`{"fullName":"Carlos","description":"Navaja"}`, true, "Navaja"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			var got staff.DescriptionPatch
			repo := &fakeRepository{updateFn: func(_, professionalID, fullName string, description staff.DescriptionPatch) (staff.UpdateResult, error) {
				got = description
				now := time.Now().UTC()
				return staff.UpdateResult{Found: true, Professional: staff.Professional{ID: professionalID, FullName: fullName, CreatedAt: now, UpdatedAt: now}}, nil
			}}
			h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/"+id, []byte(tc.body), id))

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}
			if got.Set != tc.wantSet {
				t.Fatalf("Set: want %v, got %v", tc.wantSet, got.Set)
			}
			switch {
			case tc.wantValue == "" && got.Value != nil:
				t.Fatalf("expected a nil value, got %q", *got.Value)
			case tc.wantValue != "" && (got.Value == nil || *got.Value != tc.wantValue):
				t.Fatalf("expected %q, got %v", tc.wantValue, got.Value)
			}
		})
	}
}

func TestUpdateProfessionalHandler_DescriptionOfWrongType_Returns400(t *testing.T) {
	repo := &fakeRepository{updateFn: func(string, string, string, staff.DescriptionPatch) (staff.UpdateResult, error) {
		t.Fatal("repository must not be called for a malformed body")
		return staff.UpdateResult{}, nil
	}}
	h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

	const id = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/"+id, []byte(`{"fullName":"Carlos","description":42}`), id))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProfessionalHandler_Response_CarriesDescription(t *testing.T) {
	const id = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"
	description := "Navaja clásica"
	now := time.Now().UTC()
	repo := &fakeRepository{updateFn: func(_, professionalID, fullName string, _ staff.DescriptionPatch) (staff.UpdateResult, error) {
		return staff.UpdateResult{Found: true, Professional: staff.Professional{ID: professionalID, FullName: fullName, CreatedAt: now, UpdatedAt: now, Description: &description}}, nil
	}}
	h := httpapi.NewUpdateProfessionalHandler(staff.NewService(repo))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestWithProfessionalID(http.MethodPatch, "/api/v1/private/professionals/"+id, []byte(`{"fullName":"Carlos","description":"Navaja clásica"}`), id))

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["description"] != description {
		t.Fatalf("expected the response to carry the description, got %v", body["description"])
	}
}
