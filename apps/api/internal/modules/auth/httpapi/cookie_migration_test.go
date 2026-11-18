package httpapi_test

// Cambio de nombre de la cookie de sesión (DEC-183, #662): barberia_session ->
// nava_agenda_session sin cerrar las sesiones abiertas. El API lee la nueva y, si
// falta, la vieja; al iniciar o renovar escribe la nueva y borra la vieja; al
// cerrar sesión borra ambas.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/auth/httpapi"
)

func cookiesByName(rec *httptest.ResponseRecorder) map[string]*http.Cookie {
	out := map[string]*http.Cookie{}
	for _, c := range rec.Result().Cookies() {
		out[c.Name] = c
	}
	return out
}

func assertDeleted(t *testing.T, c *http.Cookie, name string) {
	t.Helper()
	if c == nil {
		t.Fatalf("expected a Set-Cookie deleting %q", name)
	}
	if c.Value != "" || (c.MaxAge != -1 && c.MaxAge != 0) {
		t.Fatalf("expected %q to be deleted (empty value, MaxAge<=0), got value-empty=%v MaxAge=%d", name, c.Value == "", c.MaxAge)
	}
	if c.Path != httpapi.CookiePath || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("the deletion of %q must use the original attributes, got %+v", name, c)
	}
}

func TestCookieNames_NewAndLegacy(t *testing.T) {
	if httpapi.CookieName != "nava_agenda_session" || httpapi.LegacyCookieName != "barberia_session" {
		t.Fatalf("unexpected cookie names %q / %q", httpapi.CookieName, httpapi.LegacyCookieName)
	}
	if cfg := httpapi.DefaultCookieConfig(); cfg.Name != httpapi.CookieName || cfg.LegacyName != httpapi.LegacyCookieName {
		t.Fatalf("the default config must read both names, got %+v", cfg)
	}
}

// Una sesión abierta antes del despliegue solo trae la cookie vieja: se acepta,
// se reemite con el nombre nuevo (mismo token, Expires renovado) y se borra la vieja.
func TestSessionMiddleware_LegacyCookieOnly_IsAcceptedAndMigrated(t *testing.T) {
	renewed := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	principal := auth.Principal{SessionID: "s-1", StaffUserID: "u-1", BusinessID: "shop-1", ExpiresAt: renewed}
	repo := &spySessionRepo{resolveShop: "shop-1", resolveFound: true, renewValid: true, renewPrincipal: principal}
	mw := newSessionMiddleware(t, repo)
	var called bool
	const token = "un-token-con-forma-valida-1234"

	rec := doPrivateRequest(t, mw, protectedHandler(&called), &http.Cookie{Name: httpapi.LegacyCookieName, Value: token})

	if !called || rec.Code != http.StatusOK {
		t.Fatalf("a session carried by the legacy cookie must stay open, got called=%v code=%d", called, rec.Code)
	}
	if repo.renewCalls != 1 {
		t.Fatalf("expected the legacy token to be validated once, got %d", repo.renewCalls)
	}
	got := cookiesByName(rec)
	fresh := got[httpapi.CookieName]
	if fresh == nil || fresh.Value != token || !fresh.Expires.Equal(renewed) {
		t.Fatalf("expected the same token under %q with Expires=%v, got %+v", httpapi.CookieName, renewed, fresh)
	}
	assertDeleted(t, got[httpapi.LegacyCookieName], httpapi.LegacyCookieName)
}

// Con la cookie nueva manda la nueva aunque llegue también la vieja (que se borra);
// sin la vieja, la respuesta no menciona el nombre anterior.
func TestSessionMiddleware_NewCookieWins_AndOnlyDeletesTheLegacyWhenPresent(t *testing.T) {
	principal := auth.Principal{SessionID: "s-1", StaffUserID: "u-1", BusinessID: "shop-1"}
	repo := &spySessionRepo{resolveShop: "shop-1", resolveFound: true, renewValid: true, renewPrincipal: principal}
	mw := newSessionMiddleware(t, repo)
	var called bool

	req := httptest.NewRequest(http.MethodGet, "/api/v1/private/anything", nil)
	req.AddCookie(&http.Cookie{Name: httpapi.CookieName, Value: "token-nuevo-1234"})
	req.AddCookie(&http.Cookie{Name: httpapi.LegacyCookieName, Value: "token-viejo-1234"})
	rec := httptest.NewRecorder()
	mw.RequireSession(protectedHandler(&called)).ServeHTTP(rec, req)

	got := cookiesByName(rec)
	if got[httpapi.CookieName] == nil || got[httpapi.CookieName].Value != "token-nuevo-1234" {
		t.Fatalf("the new cookie must win over the legacy one, got %+v", got[httpapi.CookieName])
	}
	assertDeleted(t, got[httpapi.LegacyCookieName], httpapi.LegacyCookieName)

	rec = doPrivateRequest(t, mw, protectedHandler(&called), &http.Cookie{Name: httpapi.CookieName, Value: "token-nuevo-1234"})
	if strings.Contains(strings.Join(rec.Result().Header.Values("Set-Cookie"), "\n"), httpapi.LegacyCookieName) {
		t.Fatal("without the legacy cookie the response must not touch it")
	}
}

// Iniciar sesión con la cookie vieja aún en el navegador deja solo la nueva.
func TestLoginHandler_Success_WritesTheNewCookieAndDeletesTheLegacyOne(t *testing.T) {
	repo := stubRepository{
		shop: "11111111-1111-1111-1111-111111111111", found: true,
		cred: auth.Credential{Found: true, StaffUserID: "u-1", PasswordHash: "h"},
	}
	h := newHandler(t, repo, true)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/public/auth/login",
		strings.NewReader(`{"email":"duena.a@ejemplo.test","password":"correcta"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: httpapi.LegacyCookieName, Value: "token-viejo-1234"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got := cookiesByName(rec)
	if got[httpapi.CookieName] == nil || got[httpapi.CookieName].Value != "token-de-prueba-http" {
		t.Fatalf("expected the new session under %q, got %+v", httpapi.CookieName, got[httpapi.CookieName])
	}
	assertDeleted(t, got[httpapi.LegacyCookieName], httpapi.LegacyCookieName)
}

// Cerrar sesión borra las dos, traiga la solicitud la que traiga.
func TestLogoutHandler_Success_DeletesBothCookieNames(t *testing.T) {
	repo := &spySessionRepo{}
	h := newLogoutHandler(t, repo)

	principal := auth.Principal{SessionID: "s-1", StaffUserID: "u-1", BusinessID: "shop-a"}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/private/auth/logout", nil)
	req = req.WithContext(auth.ContextWithPrincipal(req.Context(), principal))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	got := cookiesByName(rec)
	if len(got) != 2 {
		t.Fatalf("expected exactly the two session cookie names to be deleted, got %d", len(got))
	}
	assertDeleted(t, got[httpapi.CookieName], httpapi.CookieName)
	assertDeleted(t, got[httpapi.LegacyCookieName], httpapi.LegacyCookieName)
}
