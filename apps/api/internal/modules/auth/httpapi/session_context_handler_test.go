package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/auth/httpapi"
)

func newSessionContextHandler(t *testing.T, repo *spySessionRepo) *httpapi.SessionContextHandler {
	t.Helper()
	svc := auth.NewSessionService(repo, stubClock{now: time.Date(2026, 8, 13, 0, 0, 0, 0, time.UTC)})
	return httpapi.NewSessionContextHandler(svc)
}

// TestSessionContextHandler_Success_ReturnsMinimalPayload cubre DEC-060: el
// cuerpo trae exactamente business.id/business.name y expiresAt, nunca
// StaffUserID, correo ni nombre del profesional, y no fija Set-Cookie (a
// diferencia de login/logout, es una lectura, no una mutación).
func TestSessionContextHandler_Success_ReturnsMinimalPayload(t *testing.T) {
	repo := &spySessionRepo{businessName: "Barbería de prueba A"}
	h := newSessionContextHandler(t, repo)

	expiresAt := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	principal := auth.Principal{SessionID: "s-1", StaffUserID: "u-1", BusinessID: "shop-a", ExpiresAt: expiresAt}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/auth/session", nil)
	req = req.WithContext(auth.ContextWithPrincipal(req.Context(), principal))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Fatal("expected no Set-Cookie: this operation only reads, never emits or modifies the session cookie")
	}
	if repo.businessNameCalls != 1 {
		t.Fatalf("expected exactly one BusinessName call, got %d", repo.businessNameCalls)
	}

	var body httpapi.SessionContextResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if body.Business.ID != "shop-a" {
		t.Fatalf("expected business.id=%q, got %q", "shop-a", body.Business.ID)
	}
	if body.Business.Name != "Barbería de prueba A" {
		t.Fatalf("expected business.name=%q, got %q", "Barbería de prueba A", body.Business.Name)
	}
	if !body.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("expected expiresAt=%v, got %v", expiresAt, body.ExpiresAt)
	}

	// RN-DAT-02: el payload nunca incluye StaffUserID, correo ni nombre del
	// profesional. Como SessionContextResponse ya está tipado sin esos campos,
	// esta comprobación estructural (sobre el JSON crudo) es defensa en
	// profundidad contra una futura adición accidental de un campo con ese
	// nombre.
	raw := strings.ToLower(rec.Body.String())
	for _, forbidden := range []string{"staffuserid", "email", "correo"} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("RN-DAT-02: response body must never mention %q: %s", forbidden, raw)
		}
	}
}

// TestSessionContextHandler_MissingPrincipalInContext_ReturnsSafe500 cubre
// el mismo defecto defensivo de wiring que LogoutHandler contempla (nunca
// debería ocurrir en producción, CA-006-04 lo evita estructuralmente).
func TestSessionContextHandler_MissingPrincipalInContext_ReturnsSafe500(t *testing.T) {
	repo := &spySessionRepo{}
	h := newSessionContextHandler(t, repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/auth/session", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.businessNameCalls != 0 {
		t.Fatal("expected BusinessName to never be invoked without a principal in context")
	}
}

func TestSessionContextHandler_RepositoryFailure_ReturnsSafe500(t *testing.T) {
	repo := &spySessionRepo{businessNameErr: context.DeadlineExceeded}
	h := newSessionContextHandler(t, repo)

	principal := auth.Principal{SessionID: "s-1", StaffUserID: "u-1", BusinessID: "shop-a"}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/auth/session", nil)
	req = req.WithContext(auth.ContextWithPrincipal(req.Context(), principal))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
}
