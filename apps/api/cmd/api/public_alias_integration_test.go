// Pruebas de integración de los alias públicos que Odin todavía lee (DEC-183,
// issue #661) contra el router REAL de producción (buildRouter) y PostgreSQL
// real, sin sesión. Las rutas /public/barbershops/{slug}/… deben responder lo
// mismo que /public/businesses/{slug}/…, y cada hueco del agregado de
// disponibilidad trae barberId con el mismo valor que professionalId. Usan el
// fixture de DEC-162 (database/testdata/dec162_agregados_publicos.sql).
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func publicAliasGet(router http.Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/public/"+path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// sameJSON compara dos cuerpos JSON sin depender del orden de claves.
func sameJSON(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatalf("decode: %v: %s", err, a)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatalf("decode: %v: %s", err, b)
	}
	xa, _ := json.Marshal(x)
	ya, _ := json.Marshal(y)
	return string(xa) == string(ya)
}

func TestPublicAlias_HTTP_OldRoutesAnswerLikeTheNewOnes(t *testing.T) {
	router := newAggRouter(t)
	slug := aggSlugUno
	cases := []struct{ name, newPath, oldPath string }{
		{"perfil", "businesses/" + slug, "barbershops/" + slug},
		{"servicios", "businesses/" + slug + "/services", "barbershops/" + slug + "/services"},
		{"reseñas", "businesses/" + slug + "/reviews", "barbershops/" + slug + "/reviews"},
		{"profesionales con servicios", "businesses/" + slug + "/professionals", "barbershops/" + slug + "/barbers"},
		{"profesionales de un servicio",
			"businesses/" + slug + "/services/" + aggServiceS2 + "/professionals",
			"barbershops/" + slug + "/services/" + aggServiceS2 + "/barbers"},
		{"disponibilidad del servicio",
			"businesses/" + slug + "/services/" + aggServiceS2 + "/availability",
			"barbershops/" + slug + "/services/" + aggServiceS2 + "/availability"},
		{"disponibilidad por profesional",
			"businesses/" + slug + "/services/" + aggServiceS2 + "/professionals/" + aggProfessionalUno1 + "/availability",
			"barbershops/" + slug + "/services/" + aggServiceS2 + "/barbers/" + aggProfessionalUno1 + "/availability"},
		{"slug inexistente", "businesses/no-existe-661", "barbershops/no-existe-661"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Las franjas dependen del reloj: si un borde de rejilla cae entre las
			// dos llamadas, se repite una vez antes de declarar la diferencia.
			for attempt := 0; ; attempt++ {
				fresh := publicAliasGet(router, tc.newPath)
				old := publicAliasGet(router, tc.oldPath)
				if fresh.Code != old.Code {
					t.Fatalf("estado distinto: nueva %d, alias %d: %s", fresh.Code, old.Code, old.Body.String())
				}
				if fresh.Code == http.StatusNotFound || sameJSON(t, fresh.Body.Bytes(), old.Body.Bytes()) {
					if tc.name != "slug inexistente" && fresh.Code != http.StatusOK {
						t.Fatalf("esperaba 200, got %d: %s", fresh.Code, fresh.Body.String())
					}
					return
				}
				if attempt == 1 {
					t.Fatalf("el alias debe responder igual que la ruta nueva:\nnueva: %s\nalias: %s",
						fresh.Body.String(), old.Body.String())
				}
			}
		})
	}
}

func TestPublicAlias_HTTP_ServiceAvailabilitySlotsCarryBarberIdEqualToProfessionalId(t *testing.T) {
	router := newAggRouter(t)
	for _, prefix := range []string{"businesses/", "barbershops/"} {
		rec := publicAliasGet(router, prefix+aggSlugUno+"/services/"+aggServiceS2+"/availability")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: esperaba 200, got %d: %s", prefix, rec.Code, rec.Body.String())
		}
		var body struct {
			Slots []map[string]any `json:"slots"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(body.Slots) == 0 {
			t.Fatalf("%s: esperaba franjas: %s", prefix, rec.Body.String())
		}
		for i, slot := range body.Slots {
			id, ok := slot["professionalId"].(string)
			if !ok || id == "" || slot["barberId"] != id {
				t.Fatalf("%s: franja %d debe traer barberId igual a professionalId: %v", prefix, i, slot)
			}
		}
	}
}
