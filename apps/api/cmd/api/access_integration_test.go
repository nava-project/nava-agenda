// Pruebas de integración de DEC-173 (issue #605): permisos reales del empleado
// restringido sobre el router de producción y PostgreSQL real, con
// database/testdata/dos_negocios.sql, hu005_credenciales_sesiones.sql y
// empleado_restringido_605.sql cargados.
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"nava-agenda/internal/modules/access"
)

const (
	accessShopE              = "605a0001-0000-4000-8000-000000000001"
	accessShopF              = "605a0001-0000-4000-8000-000000000002"
	accessUserEmpleado       = "605e0001-0000-4000-8000-000000000001"
	accessUserEmpresa        = "605e0001-0000-4000-8000-000000000002"
	accessUserSinProfesional = "605e0001-0000-4000-8000-000000000003"
	accessUserEmpleadoF      = "605e0001-0000-4000-8000-000000000004"
	accessProfessionalPropio = "605b0001-0000-4000-8000-000000000001"
	accessProfessionalOtro   = "605b0001-0000-4000-8000-000000000002"
	accessServiceE           = "605c0001-0000-4000-8000-000000000001"
	accessApptPropio         = "605f0001-0000-4000-8000-000000000001"
	accessApptOtro           = "605f0001-0000-4000-8000-000000000002"
)

func doPrivate(t *testing.T, handler http.Handler, method, path, rawToken string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, privatePrefix+path, reader)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "605-"+strings.ReplaceAll(path, "/", "-"))
	req.AddCookie(&http.Cookie{Name: cookieName, Value: rawToken})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func problemCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var p struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	return p.Code
}

// TestPrivateAccessPolicy_ClassifiesEveryPrivateRoute: toda ruta privada del
// router real está en la tabla de permisos y la tabla no clasifica rutas que
// ya no existen. Una ruta nueva sin clasificar hace fallar esta prueba.
func TestPrivateAccessPolicy_ClassifiesEveryPrivateRoute(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router, err := buildRouter(db, discardLogger(), testRouterConfig())
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}
	policy, err := access.NewPolicy(privateAccessPolicy)
	if err != nil {
		t.Fatalf("NewPolicy: %v", err)
	}

	registered := map[string]bool{}
	err = chi.Walk(router, func(method, pattern string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(pattern, privatePrefix+"/") {
			return nil
		}
		rel := strings.TrimPrefix(pattern, privatePrefix)
		registered[method+" "+rel] = true
		if !policy.Has(method, rel) {
			t.Errorf("DEC-173: %s %s no está en privateAccessPolicy (access_policy.go)", method, rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("chi.Walk: %v", err)
	}
	for _, e := range policy.Entries() {
		if !registered[e.Method+" "+e.Pattern] {
			t.Errorf("privateAccessPolicy clasifica %s %s, que el router no registra", e.Method, e.Pattern)
		}
	}
}

func TestAccess_HTTP_EmployeeOnlyReachesTheirOwnProfessional(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { db.Close() })
	router, err := buildRouter(db, discardLogger(), testRouterConfig())
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}
	employee := createSessionCookie(t, db, accessShopE, accessUserEmpleado, "access-empleado")

	cases := []struct {
		name, method, path string
		body               any
		wantStatus         int
		wantCode           string
	}{
		{"lee su perfil", http.MethodGet, "/professionals/" + accessProfessionalPropio, nil, http.StatusOK, ""},
		{"no lee el perfil de otro", http.MethodGet, "/professionals/" + accessProfessionalOtro, nil, http.StatusForbidden, "forbidden"},
		{"lee su jornada", http.MethodGet, "/professionals/" + accessProfessionalPropio + "/working-hours", nil, http.StatusOK, ""},
		{"no lee la jornada de otro", http.MethodGet, "/professionals/" + accessProfessionalOtro + "/working-hours", nil, http.StatusForbidden, "forbidden"},
		{"lee sus servicios", http.MethodGet, "/professionals/" + accessProfessionalPropio + "/services", nil, http.StatusOK, ""},
		{"no quita servicios a otro", http.MethodDelete, "/professionals/" + accessProfessionalOtro + "/services/" + accessServiceE, nil, http.StatusForbidden, "forbidden"},
		{"lee su agenda", http.MethodGet, "/professionals/" + accessProfessionalPropio + "/appointments/daily-agenda?date=2030-01-10", nil, http.StatusOK, ""},
		{"no lee la agenda de otro", http.MethodGet, "/professionals/" + accessProfessionalOtro + "/appointments/daily-agenda?date=2030-01-10", nil, http.StatusForbidden, "forbidden"},
		{"no fija la ventana de otro", http.MethodDelete, "/settings/booking-policy/professionals/" + accessProfessionalOtro, nil, http.StatusForbidden, "forbidden"},
		{"lee la marca", http.MethodGet, "/settings/brand", nil, http.StatusOK, ""},
		{"no cambia la marca", http.MethodPatch, "/settings/brand", map[string]any{"brandAccent": "ruby"}, http.StatusForbidden, "forbidden"},
		{"no cambia los datos del negocio", http.MethodPatch, "/settings/business", map[string]any{"name": "X"}, http.StatusForbidden, "forbidden"},
		{"no lee el código de acceso", http.MethodGet, "/settings/login-otp", nil, http.StatusForbidden, "forbidden"},
		{"lee el catálogo", http.MethodGet, "/services", nil, http.StatusOK, ""},
		{"no crea servicios", http.MethodPost, "/services", map[string]any{"name": "X"}, http.StatusForbidden, "forbidden"},
		{"no da de alta profesionales", http.MethodPost, "/professionals", map[string]any{"fullName": "X"}, http.StatusForbidden, "forbidden"},
		{"no cambia su vínculo", http.MethodPut, "/me/professional", map[string]any{"professionalId": accessProfessionalOtro}, http.StatusForbidden, "forbidden"},
		{"no se desvincula", http.MethodDelete, "/me/professional", nil, http.StatusForbidden, "forbidden"},
		{"no crea turnos a otro", http.MethodPost, "/appointments", map[string]any{"professionalId": accessProfessionalOtro}, http.StatusForbidden, "forbidden"},
		{"ve su turno", http.MethodGet, "/appointments/" + accessApptPropio, nil, http.StatusOK, ""},
		{"el turno de otro no existe para él", http.MethodGet, "/appointments/" + accessApptOtro, nil, http.StatusNotFound, "not-found"},
		{"no cancela el turno de otro", http.MethodPost, "/appointments/" + accessApptOtro + "/cancel", map[string]any{"reason": "x"}, http.StatusNotFound, "not-found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doPrivate(t, router, tc.method, tc.path, employee, tc.body)
			if rec.Code != tc.wantStatus {
				t.Fatalf("%s %s: status %d, want %d: %s", tc.method, tc.path, rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantCode != "" && problemCode(t, rec) != tc.wantCode {
				t.Fatalf("%s %s: code %q, want %q", tc.method, tc.path, problemCode(t, rec), tc.wantCode)
			}
		})
	}
}

func TestAccess_HTTP_EmployeeListsOnlyTheirOwnProfessional(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { db.Close() })
	router, err := buildRouter(db, discardLogger(), testRouterConfig())
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}

	ids := func(rec *httptest.ResponseRecorder) []string {
		var body struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v: %s", err, rec.Body.String())
		}
		out := []string{}
		for _, it := range body.Items {
			out = append(out, it.ID)
		}
		return out
	}

	employee := createSessionCookie(t, db, accessShopE, accessUserEmpleado, "access-list-empleado")
	for _, query := range []string{"", "?page=1&pageSize=20"} {
		rec := doPrivate(t, router, http.MethodGet, "/professionals"+query, employee, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /professionals%s: %d %s", query, rec.Code, rec.Body.String())
		}
		if got := ids(rec); len(got) != 1 || got[0] != accessProfessionalPropio {
			t.Fatalf("GET /professionals%s: el empleado debe ver solo su profesional, got %v", query, got)
		}
	}

	unlinked := createSessionCookie(t, db, accessShopE, accessUserSinProfesional, "access-list-sin-profesional")
	rec := doPrivate(t, router, http.MethodGet, "/professionals", unlinked, nil)
	if got := ids(rec); rec.Code != http.StatusOK || len(got) != 0 {
		t.Fatalf("sin vínculo la lista debe venir vacía: %d %v", rec.Code, got)
	}
	if rec := doPrivate(t, router, http.MethodGet, "/professionals/"+accessProfessionalPropio+"/working-hours", unlinked, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("sin vínculo, lo de un profesional responde 403: %d", rec.Code)
	}

	owner := createSessionCookie(t, db, accessShopE, accessUserEmpresa, "access-list-empresa")
	if got := ids(doPrivate(t, router, http.MethodGet, "/professionals", owner, nil)); len(got) != 2 {
		t.Fatalf("la cuenta empresa conserva la lista completa, got %v", got)
	}
	if rec := doPrivate(t, router, http.MethodGet, "/appointments/"+accessApptOtro, owner, nil); rec.Code != http.StatusOK {
		t.Fatalf("la cuenta empresa ve cualquier turno: %d %s", rec.Code, rec.Body.String())
	}
	if rec := doPrivate(t, router, http.MethodGet, "/professionals/"+accessProfessionalOtro+"/working-hours", owner, nil); rec.Code != http.StatusOK {
		t.Fatalf("la cuenta empresa ve la jornada de cualquier profesional: %d", rec.Code)
	}

	// RN-TEN-01: el empleado de otro negocio no alcanza nada de E.
	other := createSessionCookie(t, db, accessShopF, accessUserEmpleadoF, "access-list-otra")
	if rec := doPrivate(t, router, http.MethodGet, "/appointments/"+accessApptPropio, other, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("un turno de otro negocio es 404: %d", rec.Code)
	}
	for _, id := range ids(doPrivate(t, router, http.MethodGet, "/professionals", other, nil)) {
		if id == accessProfessionalPropio || id == accessProfessionalOtro {
			t.Fatalf("RN-TEN-01: la lista de F incluye un profesional de E")
		}
	}
}
