// Pruebas de integración de los alias de Odin (DEC-183, issue #661) contra el
// router REAL de producción (buildRouter) y PostgreSQL real. Las rutas
// /integrations/odin/barbershops/{slug}/… siguen respondiendo igual que las nuevas
// /integrations/odin/businesses/{slug}/… hasta que Odin confirme el cambio, y cada
// turno trae professionalName y, deprecado, barberName con el mismo valor.
// Requieren todas las migraciones aplicadas y database/testdata/hu105_acceso_codigo.sql.
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	bookingpostgres "nava-agenda/internal/modules/booking/postgres"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/idempotency"
)

const (
	odinAliasShop         = "01050001-0105-0105-0105-010500010001"
	odinAliasProfessional = "01050011-0105-0105-0105-010500110011"
	odinAliasService      = "01050012-0105-0105-0105-010500120012"
	odinAliasSlug         = "hu105-uno"
	odinAliasName         = "Barbero HU-105 Uno"
	// Secreto sintético de prueba: no corresponde a ningún despliegue.
	odinAliasToken = "token-de-prueba-odin-661-no-real-0123456789"
)

func newOdinAliasRouter(t *testing.T) (http.Handler, *database.DB) {
	t.Helper()
	db := setupTestDB(t)
	t.Cleanup(func() { db.Close() })
	cfg := testRouterConfig()
	cfg.OdinServiceToken = odinAliasToken
	router, err := buildRouter(db, discardLogger(), cfg)
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}
	return router, db
}

func odinAliasRandomDigits(t *testing.T, n int) string {
	t.Helper()
	var b strings.Builder
	for range n {
		d, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			t.Fatalf("rand.Int: %v", err)
		}
		b.WriteByte(byte('0' + d.Int64()))
	}
	return b.String()
}

// odinAliasBook crea un turno futuro confirmado para un teléfono nuevo en hu105-uno.
func odinAliasBook(t *testing.T, db *database.DB) string {
	t.Helper()
	phone := "+573" + odinAliasRandomDigits(t, 9)
	email := "odin661-" + odinAliasRandomDigits(t, 10) + "@example.test"
	days, err := rand.Int(rand.Reader, big.NewInt(3650))
	if err != nil {
		t.Fatalf("rand.Int: %v", err)
	}
	hours, err := rand.Int(rand.Reader, big.NewInt(20))
	if err != nil {
		t.Fatalf("rand.Int: %v", err)
	}
	// Fechas al azar desde 2031: el rol de la aplicación no borra turnos y las
	// corridas repetidas no deben chocar con la exclusión de solapamiento.
	starts := time.Date(2031, 1, 10, 8, 0, 0, 0, time.UTC).
		AddDate(0, 0, int(days.Int64())).Add(time.Duration(hours.Int64()) * time.Hour)
	repo := bookingpostgres.New(db, idempotency.NewSQLCoordinator())
	_, err = repo.CreateInternal(context.Background(), odinAliasShop, booking.CreateInternalInput{
		ProfessionalID: odinAliasProfessional, ServiceID: odinAliasService,
		AttendeeName: "Cliente de prueba 661", StartsAt: starts, EndsAt: starts.Add(30 * time.Minute),
		Origin: booking.OriginPublic,
		Service: booking.ServiceSnapshot{
			Name: "Corte de prueba HU-105", DurationMinutes: 30, PriceAmountCents: 2000000, Currency: "COP",
		},
		Customer: booking.CustomerInput{New: &booking.NewCustomerInput{
			FullName: "Cliente de prueba 661", Email: &email, Phone: &phone,
		}},
		Actor: booking.Actor{Type: booking.ActorTypeSystem},
	})
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	return phone
}

func odinAliasPost(router http.Handler, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+odinAliasToken)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

type odinAliasLookupBody struct {
	Appointments []map[string]any `json:"appointments"`
}

func TestOdinAlias_HTTP_LookupOldRouteAnswersLikeTheNewOne(t *testing.T) {
	router, db := newOdinAliasRouter(t)
	phone := odinAliasBook(t, db)
	body := `{"phone":"` + phone + `"}`

	var got [2]odinAliasLookupBody
	for i, prefix := range []string{"businesses", "barbershops"} {
		rec := odinAliasPost(router, "/api/v1/integrations/odin/"+prefix+"/"+odinAliasSlug+"/customer-appointments/lookup", body)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: esperaba 200, got %d: %s", prefix, rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got[i]); err != nil {
			t.Fatalf("%s: decode: %v", prefix, err)
		}
		if len(got[i].Appointments) != 1 {
			t.Fatalf("%s: esperaba un turno, got %s", prefix, rec.Body.String())
		}
		appt := got[i].Appointments[0]
		if appt["professionalName"] != odinAliasName || appt["barberName"] != odinAliasName {
			t.Fatalf("%s: el turno debe traer professionalName y barberName con el mismo valor: %s", prefix, rec.Body.String())
		}
		// La referencia es opaca y puede variar entre llamadas; el resto es idéntico.
		delete(appt, "appointmentRef")
	}
	a, _ := json.Marshal(got[0])
	b, _ := json.Marshal(got[1])
	if string(a) != string(b) {
		t.Fatalf("el alias debe responder igual que la ruta nueva:\nnueva: %s\nalias: %s", a, b)
	}
}

func TestOdinAlias_HTTP_ErrorsAndCredentialMatchTheNewRoute(t *testing.T) {
	router, _ := newOdinAliasRouter(t)
	cases := []struct {
		name, slug, suffix, body string
		auth                     bool
	}{
		{"slug inexistente", "no-existe-661", "customer-appointments/lookup", `{"phone":"+573001234567"}`, true},
		{"sin credencial", odinAliasSlug, "customer-appointments/lookup", `{"phone":"+573001234567"}`, false},
		{"reto sin WhatsApp configurado", odinAliasSlug, "customer-access/challenge",
			`{"phone":"+573001234567","appointmentRef":"referencia-que-no-existe"}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var codes [2]int
			var types [2]string
			for i, prefix := range []string{"businesses", "barbershops"} {
				req := httptest.NewRequest(http.MethodPost,
					"/api/v1/integrations/odin/"+prefix+"/"+tc.slug+"/"+tc.suffix, strings.NewReader(tc.body))
				req.Header.Set("Content-Type", "application/json")
				if tc.auth {
					req.Header.Set("Authorization", "Bearer "+odinAliasToken)
				}
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				var problem struct {
					Type string `json:"type"`
				}
				_ = json.Unmarshal(rec.Body.Bytes(), &problem)
				codes[i], types[i] = rec.Code, problem.Type
			}
			if codes[0] != codes[1] || types[0] != types[1] || codes[0] < 400 {
				t.Fatalf("el alias debe fallar igual que la ruta nueva: nueva %d %q, alias %d %q",
					codes[0], types[0], codes[1], types[1])
			}
		})
	}
}
