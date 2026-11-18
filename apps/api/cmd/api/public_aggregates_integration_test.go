// Pruebas de integración de los agregados públicos de solo lectura (DEC-162)
// contra el router REAL de producción (buildRouter) y PostgreSQL real, sin
// cookie de sesión. Requieren todas las migraciones aplicadas y
// database/testdata/dec162_agregados_publicos.sql cargado.
//
//	export TEST_DATABASE_URL="postgres://barberia_app:app_test@localhost:5432/barberia_test?sslmode=disable"
//	go test -race ./cmd/api/...
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	aggSlugUno = "barberia-dec162-uno"
	aggSlugDos = "barberia-dec162-dos"

	aggBarberUno1 = "01620011-0162-0162-0162-016200110011"
	aggBarberUno2 = "01620012-0162-0162-0162-016200120012"

	aggServiceS1       = "01620101-0162-0162-0162-016201010101"
	aggServiceS2       = "01620102-0162-0162-0162-016201020102"
	aggServiceInactive = "01620103-0162-0162-0162-016201030103"
	aggServiceDos      = "01620201-0162-0162-0162-016202010201"
)

type aggBarbersBody struct {
	Items []struct {
		ID         string   `json:"id"`
		FullName   string   `json:"fullName"`
		ServiceIDs []string `json:"serviceIds"`
	} `json:"items"`
}

type aggAvailabilityBody struct {
	Slots []struct {
		BarberID string    `json:"professionalId"`
		StartsAt time.Time `json:"startsAt"`
	} `json:"slots"`
	DurationMinutes int    `json:"durationMinutes"`
	Timezone        string `json:"timezone"`
	SlotGridMinutes int    `json:"slotGridMinutes"`
}

func newAggRouter(t *testing.T) http.Handler {
	t.Helper()
	db := setupTestDB(t)
	t.Cleanup(func() { db.Close() })
	router, err := buildRouter(db, discardLogger(), testRouterConfig())
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}
	return router
}

func aggGet(router http.Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/public/businesses/"+path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestPublicAggregates_HTTP_Barbers_ReturnsEligibleBarbersWithServiceIds(t *testing.T) {
	rec := aggGet(newAggRouter(t), aggSlugUno+"/professionals")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body aggBarbersBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Items) != 2 {
		t.Fatalf("esperaba 2 barberos elegibles, got %s", rec.Body.String())
	}
	if body.Items[0].ID != aggBarberUno1 || len(body.Items[0].ServiceIDs) != 2 ||
		body.Items[0].ServiceIDs[0] != aggServiceS1 || body.Items[0].ServiceIDs[1] != aggServiceS2 {
		t.Fatalf("Uno-1 inesperado: %+v", body.Items[0])
	}
	if body.Items[1].ID != aggBarberUno2 || len(body.Items[1].ServiceIDs) != 1 || body.Items[1].ServiceIDs[0] != aggServiceS2 {
		t.Fatalf("Uno-2 inesperado: %+v", body.Items[1])
	}
	// El servicio inactivo nunca aparece entre los serviceIds.
	if strings.Contains(rec.Body.String(), aggServiceInactive) {
		t.Fatalf("un servicio inactivo no debe aparecer: %s", rec.Body.String())
	}
}

func TestPublicAggregates_HTTP_Barbers_IsConsistentWithPerServiceEndpoint(t *testing.T) {
	router := newAggRouter(t)
	var agg aggBarbersBody
	if err := json.Unmarshal(aggGet(router, aggSlugUno+"/professionals").Body.Bytes(), &agg); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Para cada servicio activo, los barberos del endpoint por servicio son
	// exactamente los que el agregado lista con ese serviceId.
	for _, serviceID := range []string{aggServiceS1, aggServiceS2} {
		rec := aggGet(router, aggSlugUno+"/services/"+serviceID+"/professionals")
		var legacy struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &legacy); err != nil {
			t.Fatalf("decode legacy: %v", err)
		}
		want := map[string]bool{}
		for _, it := range legacy.Items {
			want[it.ID] = true
		}
		got := map[string]bool{}
		for _, b := range agg.Items {
			for _, id := range b.ServiceIDs {
				if id == serviceID {
					got[b.ID] = true
				}
			}
		}
		if len(want) != len(got) {
			t.Fatalf("servicio %s: endpoint por servicio %v, agregado %v", serviceID, want, got)
		}
		for id := range want {
			if !got[id] {
				t.Fatalf("servicio %s: falta el barbero %s en el agregado", serviceID, id)
			}
		}
	}
}

func TestPublicAggregates_HTTP_Barbers_TenantIsolation(t *testing.T) {
	rec := aggGet(newAggRouter(t), aggSlugDos+"/professionals")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body aggBarbersBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Items) != 1 || len(body.Items[0].ServiceIDs) != 1 || body.Items[0].ServiceIDs[0] != aggServiceDos {
		t.Fatalf("Dos solo debe ver lo suyo: %s", rec.Body.String())
	}
	for _, leaked := range []string{aggBarberUno1, aggBarberUno2, aggServiceS1, aggServiceS2} {
		if strings.Contains(rec.Body.String(), leaked) {
			t.Fatalf("se filtró %s de otra barbería: %s", leaked, rec.Body.String())
		}
	}
}

func TestPublicAggregates_HTTP_UnknownSlug_Returns404Problem(t *testing.T) {
	router := newAggRouter(t)
	for _, path := range []string{
		"barberia-que-no-existe/professionals",
		"barberia-que-no-existe/services/" + aggServiceS2 + "/availability",
	} {
		rec := aggGet(router, path)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: expected 404, got %d: %s", path, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
			t.Fatalf("%s: Content-Type = %q", path, ct)
		}
	}
}

func TestPublicAggregates_HTTP_ServiceAvailability_AggregatesAllEligibleBarbers(t *testing.T) {
	router := newAggRouter(t)
	before := time.Now().UTC()

	rec := aggGet(router, aggSlugUno+"/services/"+aggServiceS2+"/availability")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var agg aggAvailabilityBody
	if err := json.Unmarshal(rec.Body.Bytes(), &agg); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if agg.DurationMinutes != 45 || agg.Timezone != "America/Bogota" || agg.SlotGridMinutes != 30 {
		t.Fatalf("contexto inesperado: %+v", agg)
	}
	if len(agg.Slots) == 0 {
		t.Fatal("esperaba franjas (dos barberos con jornada los siete días)")
	}

	perBarber := map[string][]time.Time{}
	for i, s := range agg.Slots {
		if s.StartsAt.Before(before) {
			t.Fatalf("franja %d anterior a la solicitud: %v", i, s.StartsAt)
		}
		if i > 0 {
			prev := agg.Slots[i-1]
			if s.StartsAt.Before(prev.StartsAt) || (s.StartsAt.Equal(prev.StartsAt) && s.BarberID <= prev.BarberID) {
				t.Fatalf("orden (startsAt, professionalId) roto en índice %d: %+v / %+v", i, prev, s)
			}
		}
		perBarber[s.BarberID] = append(perBarber[s.BarberID], s.StartsAt)
	}
	if len(perBarber) != 2 || len(perBarber[aggBarberUno1]) == 0 || len(perBarber[aggBarberUno2]) == 0 {
		t.Fatalf("esperaba franjas de Uno-1 y Uno-2, got barberos %v", perBarber)
	}

	// No divergencia: las franjas de cada barbero son EXACTAMENTE las del
	// endpoint por barbero (que sigue intacto). Ambas lecturas se hacen con
	// instantes de reloj distintos; comparar sólo desde el inicio común evita
	// una falsa discrepancia si la ventana avanzó entre las dos llamadas.
	after := time.Now().UTC()
	for barberID, got := range perBarber {
		single := aggGet(router, aggSlugUno+"/services/"+aggServiceS2+"/professionals/"+barberID+"/availability")
		if single.Code != http.StatusOK {
			t.Fatalf("legacy %s: %d: %s", barberID, single.Code, single.Body.String())
		}
		var legacy availabilityResponseBody
		if err := json.Unmarshal(single.Body.Bytes(), &legacy); err != nil {
			t.Fatalf("decode legacy: %v", err)
		}
		var want []time.Time
		for _, s := range legacy.Slots {
			if !s.StartsAt.Before(after) {
				want = append(want, s.StartsAt)
			}
		}
		var have []time.Time
		for _, s := range got {
			if !s.Before(after) {
				have = append(have, s)
			}
		}
		if len(want) != len(have) {
			t.Fatalf("barbero %s: agregado %d franjas, endpoint por barbero %d", barberID, len(have), len(want))
		}
		for i := range want {
			if !want[i].Equal(have[i]) {
				t.Fatalf("barbero %s franja %d: %v != %v", barberID, i, have[i], want[i])
			}
		}
	}
}

func TestPublicAggregates_HTTP_ServiceAvailability_OneEligibleBarber(t *testing.T) {
	rec := aggGet(newAggRouter(t), aggSlugUno+"/services/"+aggServiceS1+"/availability")
	var agg aggAvailabilityBody
	if err := json.Unmarshal(rec.Body.Bytes(), &agg); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if rec.Code != http.StatusOK || agg.DurationMinutes != 30 || len(agg.Slots) == 0 {
		t.Fatalf("respuesta inesperada: %d %s", rec.Code, rec.Body.String())
	}
	for _, s := range agg.Slots {
		if s.BarberID != aggBarberUno1 {
			t.Fatalf("S1 solo lo hace Uno-1, got %s", s.BarberID)
		}
	}
}

// TestPublicAggregates_HTTP_ServiceAvailability_ForeignInactiveOrMalformedIsUniformEmpty
// cubre el criterio uniforme de CA-092-03: serviceId ajeno, inactivo,
// inexistente o malformado nunca produce un error distinto.
func TestPublicAggregates_HTTP_ServiceAvailability_ForeignInactiveOrMalformedIsUniformEmpty(t *testing.T) {
	router := newAggRouter(t)
	const empty = `{"slots":[],"durationMinutes":0,"timezone":"","slotGridMinutes":0}`
	for name, path := range map[string]string{
		"servicio de otra barbería": aggSlugUno + "/services/" + aggServiceDos + "/availability",
		"servicio inactivo":         aggSlugUno + "/services/" + aggServiceInactive + "/availability",
		"servicio sin barberos":     aggSlugUno + "/services/01620104-0162-0162-0162-016201040104/availability",
		"servicio inexistente":      aggSlugUno + "/services/00000000-0000-0000-0000-000000000000/availability",
		"sin forma de UUID":         aggSlugUno + "/services/no-es-uuid/availability",
		"servicio de Uno via Dos":   aggSlugDos + "/services/" + aggServiceS2 + "/availability",
	} {
		t.Run(name, func(t *testing.T) {
			rec := aggGet(router, path)
			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}
			if got := strings.TrimSpace(rec.Body.String()); got != empty {
				t.Fatalf("body = %s, want %s", got, empty)
			}
		})
	}
}

// Las rutas existentes siguen vivas y sin cambios de contrato tras añadir los
// agregados (compatibilidad total, DEC-162).
func TestPublicAggregates_HTTP_ExistingEndpointsKeepWorking(t *testing.T) {
	router := newAggRouter(t)
	for _, path := range []string{
		aggSlugUno,
		aggSlugUno + "/services",
		aggSlugUno + "/services/" + aggServiceS2 + "/professionals",
		aggSlugUno + "/services/" + aggServiceS2 + "/professionals/" + aggBarberUno1 + "/availability",
		aggSlugUno + "/professionals/" + aggBarberUno1 + "/photo", // 404 uniforme: sin fotografía
	} {
		rec := aggGet(router, path)
		want := http.StatusOK
		if strings.HasSuffix(path, "/photo") {
			want = http.StatusNotFound
		}
		if rec.Code != want {
			t.Fatalf("%s: expected %d, got %d: %s", path, want, rec.Code, rec.Body.String())
		}
	}
}
