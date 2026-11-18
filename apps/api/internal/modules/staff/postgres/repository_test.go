// Package postgres_test (pruebas de integración, HU-021) requiere
// PostgreSQL REAL con las diez migraciones aplicadas (incluida
// 20260823130000_create_barber.sql) y database/testdata/dos_negocios.sql +
// database/testdata/hu021_profesionales.sql cargados. Conéctate como
// agenda_app (docs/03-desarrollo/estrategia-pruebas.md §2 prohíbe mocks
// para RLS/idempotencia/atomicidad).
//
//	export TEST_DATABASE_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable"
//	go test -race ./internal/modules/staff/postgres/...
package postgres_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"nava-agenda/internal/modules/staff"
	staffpostgres "nava-agenda/internal/modules/staff/postgres"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/config"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/idempotency"
)

const (
	testDatabaseURL = "postgres://agenda_app@localhost:5432/barberia_test?sslmode=disable"

	// shopC/shopD son los dos negocios dedicados de
	// testdata/hu021_profesionales.sql: aisladas de dos_negocios.sql para que un
	// conteo exacto de profesionales en una página no dependa de lo que otras
	// suites (settings, auth) hagan sobre shopA/shopB.
	shopC = database.BusinessID("33333333-3333-3333-3333-333333333333")
	shopD = database.BusinessID("44444444-4444-4444-4444-444444444444")
)

func setupTestDB(t *testing.T) *database.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = testDatabaseURL
	}
	cfg := config.Config{
		Environment:              "test",
		DatabaseMaxConns:         10,
		DatabaseMinConns:         2,
		DatabaseMaxConnLifetime:  time.Hour,
		DatabaseMaxConnIdleTime:  30 * time.Minute,
		DatabaseConnectTimeout:   5 * time.Second,
		DatabaseStatementTimeout: 10 * time.Second,
	}
	db, err := database.NewDB(config.DatabaseDSN(url), cfg)
	if err != nil {
		t.Fatalf("database.NewDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newRepository(db *database.DB) *staffpostgres.Repository {
	return staffpostgres.New(db, idempotency.NewSQLCoordinator())
}

// uniqueSuffix evita colisiones entre ejecuciones repetidas de la suite
// contra el mismo PostgreSQL persistente (agenda_app no puede DELETE,
// CA-021-07/DEC-047, así que las filas de una corrida anterior siguen ahí):
// cada prueba usa nombres/claves con un sufijo aleatorio propio.
func uniqueSuffix(t *testing.T) string {
	t.Helper()
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	return hex.EncodeToString(buf)
}

func createProfessional(t *testing.T, repo *staffpostgres.Repository, shop database.BusinessID, fullName string) staff.Professional {
	t.Helper()
	key := idempotency.Key("fixture-" + uniqueSuffix(t))
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"`+fullName+`"}`))
	result, err := repo.Create(context.Background(), string(shop), fullName, nil, key, fp)
	if err != nil {
		t.Fatalf("createProfessional: %v", err)
	}
	if result.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("createProfessional: expected OutcomeProceed, got %s", result.Decision.Outcome)
	}
	return result.Professional
}

// --- List: orden estable, paginación contigua sin duplicados/omisiones --

// TestList_TraversingUntilExhausted_TerminatesWithoutNextCursor recorre
// TODA la colección actual de shopD (que puede tener filas de corridas
// anteriores de esta suite: agenda_app no puede DELETE, CA-021-07/
// DEC-047, así que esta prueba nunca asume un tamaño exacto ni un
// negocio vacía) con limit=1, y confirma que el recorrido SIEMPRE termina
// con NextCursor="" en algún momento, sin duplicados ni omisiones respecto
// de una lectura de control con un límite grande.
func TestList_TraversingUntilExhausted_TerminatesWithoutNextCursor(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	marker := createProfessional(t, repo, shopD, "Marcador de recorrido "+suffix)

	seen := map[string]bool{}
	var cursor *staff.Cursor
	pages := 0
	for {
		pages++
		if pages > 100000 {
			t.Fatal("too many pages; possible infinite loop (NextCursor never became empty)")
		}
		page, err := repo.List(context.Background(), string(shopD), cursor, 1)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatalf("item %s seen twice while paging", item.ID)
			}
			seen[item.ID] = true
		}
		if page.NextCursor == "" {
			break
		}
		decoded, err := staff.DecodeCursor(page.NextCursor)
		if err != nil {
			t.Fatalf("DecodeCursor: %v", err)
		}
		cursor = &decoded
	}

	if !seen[marker.ID] {
		t.Fatalf("expected the just-created marker professional %s to appear while exhausting the collection", marker.ID)
	}
}

func TestList_FourProfessionalsInATeamShop_ReturnedAsFourDistinctResources(t *testing.T) {
	// CA-021-02: un negocio con un profesional y luego tres más registrados
	// produce cuatro recursos distintos del mismo negocio, con el mismo
	// código de camino que un negocio unipersonal (CA-021-01): no hay una
	// forma de datos especial para "profesional único".
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	created := make(map[string]bool, 4)
	for i := 0; i < 4; i++ {
		b := createProfessional(t, repo, shopC, "Equipo "+suffix+" "+string(rune('A'+i)))
		if created[b.ID] {
			t.Fatalf("duplicate id returned by Create: %s", b.ID)
		}
		created[b.ID] = true
	}
	if len(created) != 4 {
		t.Fatalf("expected 4 distinct professionals, got %d", len(created))
	}

	// Recorre TODAS las páginas con limit=1 y confirma que los 4 ids
	// aparecen entre lo recorrido, sin duplicados, en orden estable.
	seen := map[string]bool{}
	var cursor *staff.Cursor
	var lastCreatedAt time.Time
	pages := 0
	for {
		pages++
		if pages > 10000 {
			t.Fatal("too many pages; possible infinite loop")
		}
		page, err := repo.List(context.Background(), string(shopC), cursor, 1)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatalf("CA-021-02: item %s seen twice while paging", item.ID)
			}
			seen[item.ID] = true
			if item.CreatedAt.Before(lastCreatedAt) {
				t.Fatalf("expected non-decreasing created_at order, got %v after %v", item.CreatedAt, lastCreatedAt)
			}
			lastCreatedAt = item.CreatedAt
		}
		if page.NextCursor == "" {
			break
		}
		decoded, err := staff.DecodeCursor(page.NextCursor)
		if err != nil {
			t.Fatalf("DecodeCursor: %v", err)
		}
		cursor = &decoded
	}

	for id := range created {
		if !seen[id] {
			t.Fatalf("CA-021-02: professional %s was never returned while paging through all pages", id)
		}
	}
}

func TestList_FirstPage_NeverReturnsMoreThanLimit(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	// Deja al menos 3 filas conocidas en shopC para esta prueba, sin
	// importar cuántas más haya de corridas anteriores.
	createProfessional(t, repo, shopC, "Límite Uno "+suffix)
	createProfessional(t, repo, shopC, "Límite Dos "+suffix)
	createProfessional(t, repo, shopC, "Límite Tres "+suffix)

	page, err := repo.List(context.Background(), string(shopC), nil, 2)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("expected exactly 2 items for limit=2, got %d", len(page.Items))
	}
	if page.NextCursor == "" {
		t.Fatal("expected a next cursor: there are at least 3 known items and limit was 2")
	}
}

// --- CA-021-05: A no ve, no lee ni renombra un profesional de B --------------

func TestGet_CrossTenant_NeverLeaksAnotherShopsProfessional(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	professionalD := createProfessional(t, repo, shopD, "Del negocio D "+suffix)

	// El mismo identificador real, consultado bajo el contexto de C, debe
	// comportarse EXACTAMENTE como "no existe" (CA-021-05).
	_, found, err := repo.Get(context.Background(), string(shopC), professionalD.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if found {
		t.Fatal("CA-021-05: shopC's context could read shopD's professional")
	}

	// Defensivo: bajo su propio tenant, sigue visible.
	got, found, err := repo.Get(context.Background(), string(shopD), professionalD.ID)
	if err != nil {
		t.Fatalf("Get (own tenant): %v", err)
	}
	if !found || got.ID != professionalD.ID {
		t.Fatal("expected shopD to still see its own professional")
	}
}

func TestGet_NonexistentID_ReturnsNotFoundSameAsOtherTenant(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)

	_, found, err := repo.Get(context.Background(), string(shopC), "99999999-9999-4999-8999-999999999999")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if found {
		t.Fatal("expected not found for a nonexistent id")
	}
}

func TestRename_CrossTenant_NeverRenamesAnotherShopsProfessional(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	professionalD := createProfessional(t, repo, shopD, "Nombre Original D "+suffix)

	result, err := repo.Update(context.Background(), string(shopC), professionalD.ID, "Renombrado por C "+suffix, staff.DescriptionPatch{})
	if err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if result.Found {
		t.Fatal("CA-021-05: shopC's context renamed shopD's professional")
	}

	// El nombre de D no cambió.
	stillD, found, err := repo.Get(context.Background(), string(shopD), professionalD.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !found || stillD.FullName != "Nombre Original D "+suffix {
		t.Fatalf("expected shopD's professional name untouched, got %+v", stillD)
	}
}

func TestRename_OwnTenant_UpdatesByIDWithoutDuplicating(t *testing.T) {
	// CA-021-04: la lista muestra el nuevo nombre sin duplicar el recurso.
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	original := createProfessional(t, repo, shopC, "Antes de renombrar "+suffix)

	result, err := repo.Update(context.Background(), string(shopC), original.ID, "Después de renombrar "+suffix, staff.DescriptionPatch{})
	if err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if !result.Found {
		t.Fatal("expected Found=true for the professional's own tenant")
	}
	if result.Professional.ID != original.ID {
		t.Fatalf("expected the same id after rename, got %s vs %s", result.Professional.ID, original.ID)
	}
	if result.Professional.FullName != "Después de renombrar "+suffix {
		t.Fatalf("unexpected renamed name: %+v", result.Professional)
	}
	if !result.Professional.UpdatedAt.After(original.UpdatedAt) && !result.Professional.UpdatedAt.Equal(original.UpdatedAt) {
		t.Fatalf("expected updated_at to advance or stay equal (never go backwards), before=%v after=%v",
			original.UpdatedAt, result.Professional.UpdatedAt)
	}

	got, found, err := repo.Get(context.Background(), string(shopC), original.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !found || got.FullName != "Después de renombrar "+suffix {
		t.Fatalf("expected the rename to persist, got %+v", got)
	}
}

func TestRename_DuplicateNameAcrossProfessionals_Allowed(t *testing.T) {
	// HU-021 no impone unicidad de fullName: dos profesionales del mismo
	// negocio pueden compartir nombre.
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	sharedName := "Nombre Compartido " + suffix

	a := createProfessional(t, repo, shopC, "Barbero Uno "+suffix)
	b := createProfessional(t, repo, shopC, "Barbero Dos "+suffix)

	if _, err := repo.Update(context.Background(), string(shopC), a.ID, sharedName, staff.DescriptionPatch{}); err != nil {
		t.Fatalf("Rename a: %v", err)
	}
	if _, err := repo.Update(context.Background(), string(shopC), b.ID, sharedName, staff.DescriptionPatch{}); err != nil {
		t.Fatalf("Rename b: %v", err)
	}

	gotA, _, _ := repo.Get(context.Background(), string(shopC), a.ID)
	gotB, _, _ := repo.Get(context.Background(), string(shopC), b.ID)
	if gotA.FullName != sharedName || gotB.FullName != sharedName {
		t.Fatalf("expected both professionals to accept the same name, got %q and %q", gotA.FullName, gotB.FullName)
	}
	if gotA.ID == gotB.ID {
		t.Fatal("expected two distinct professionals, not one merged into the other")
	}
}

// --- Idempotencia del alta (RN-IDE-01, DEC-043, CA-021-02) ----------------

func TestCreate_FirstExecution_PersistsAndReturnsProceed(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	key := idempotency.Key("first-exec-" + suffix)
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"Nuevo"}`))

	result, err := repo.Create(context.Background(), string(shopC), "Nuevo "+suffix, nil, key, fp)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if result.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("expected OutcomeProceed, got %s", result.Decision.Outcome)
	}
	if result.Professional.ID == "" || result.Professional.FullName != "Nuevo "+suffix {
		t.Fatalf("unexpected created professional: %+v", result.Professional)
	}
	if result.Response.Status != 201 {
		t.Fatalf("expected stored status 201, got %d", result.Response.Status)
	}

	got, found, err := repo.Get(context.Background(), string(shopC), result.Professional.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !found || got.FullName != "Nuevo "+suffix {
		t.Fatalf("expected the created professional to be persisted, got found=%v %+v", found, got)
	}
}

func TestCreate_SameKeyAndContent_ReplaysWithoutCreatingASecondRow(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	key := idempotency.Key("replay-" + suffix)
	body := []byte(`{"fullName":"Repetido"}`)
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", body)

	first, err := repo.Create(context.Background(), string(shopC), "Repetido "+suffix, nil, key, fp)
	if err != nil {
		t.Fatalf("Create (first): %v", err)
	}
	if first.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("expected first call to proceed, got %s", first.Decision.Outcome)
	}

	second, err := repo.Create(context.Background(), string(shopC), "Repetido "+suffix, nil, key, fp)
	if err != nil {
		t.Fatalf("Create (second): %v", err)
	}
	if second.Decision.Outcome != idempotency.OutcomeReplay {
		t.Fatalf("expected second call to replay, got %s", second.Decision.Outcome)
	}
	if second.Response != first.Response {
		t.Fatalf("expected the exact same stored response (CA-004-01), got %+v vs %+v", first.Response, second.Response)
	}

	// Confirma que existe UNA sola fila con ese nombre para esta clave (no
	// una segunda inserción silenciosa): se verifica leyendo por id el
	// mismo recurso que la primera respuesta reportó.
	var parsed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(second.Response.Body), &parsed); err != nil {
		t.Fatalf("unmarshal stored response body: %v", err)
	}
	if parsed.ID != first.Professional.ID {
		t.Fatalf("expected the replayed body to reference the original professional id %s, got %s", first.Professional.ID, parsed.ID)
	}
}

func TestCreate_SameKeyDifferentContent_ConflictsWithoutEffect(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	key := idempotency.Key("conflict-" + suffix)
	fpA := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"A"}`))
	fpB := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"B"}`))

	first, err := repo.Create(context.Background(), string(shopC), "Nombre A "+suffix, nil, key, fpA)
	if err != nil {
		t.Fatalf("Create (first): %v", err)
	}
	if first.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("expected first call to proceed, got %s", first.Decision.Outcome)
	}

	second, err := repo.Create(context.Background(), string(shopC), "Nombre B "+suffix, nil, key, fpB)
	if err != nil {
		t.Fatalf("Create (second): %v", err)
	}
	if second.Decision.Outcome != idempotency.OutcomeConflictFingerprint {
		t.Fatalf("expected OutcomeConflictFingerprint, got %s", second.Decision.Outcome)
	}
	if second.Professional.ID != "" {
		t.Fatal("expected no professional created on conflict")
	}
	if err := second.Decision.AsError(); err == nil {
		t.Fatal("expected Decision.AsError() to be non-nil for a conflict")
	} else if appErr, ok := apperr.As(err); !ok || appErr.Kind != apperr.KindIdempotencyConflict {
		t.Fatalf("expected apperr.KindIdempotencyConflict, got %v", err)
	}
}

func TestCreate_TwoRealConcurrentConnections_SingleEffect(t *testing.T) {
	// CA-004-03/RN-IDE-01: dos conexiones reales y simultáneas con la misma
	// clave producen el efecto exactamente una vez; la perdedora recibe
	// OutcomeLocked de inmediato, sin esperar.
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	key := idempotency.Key("two-conn-" + suffix)
	fullName := "Concurrente " + suffix
	body := []byte(`{"fullName":"` + fullName + `"}`)
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", body)

	// db.InTenantTx serializa internamente por CONEXIÓN, no por llamada: se
	// necesita una segunda "sesión" real, que la implementación de
	// Repository ya adquiere de su propio pool en cada InTenantTx
	// (Repository.db comparte el pool, pero cada InTenantTx adquiere su
	// propia conexión física). Se orquesta con dos goroutines igual que
	// internal/platform/idempotency/postgres_test.go.
	var (
		wg               sync.WaitGroup
		aResult, bResult staff.CreateResult
		aErr, bErr       error
		aStarted         = make(chan struct{})
		bAttempted       = make(chan struct{})
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		// No hay gancho directo para "mantener abierta la transacción de A
		// mientras B intenta": Repository.Create ya hace Begin+INSERT+
		// Complete de punta a punta. Para forzar la contención real se
		// dispara B inmediatamente después de A sin esperar a que A
		// termine, confiando en que el planificador del sistema operativo
		// entrelace ambas conexiones dentro de la ventana de la
		// transacción de A la mayoría de las veces; si no colisionan,
		// ambas rutas (proceed+replay o proceed+locked) son válidas y la
		// prueba las acepta explícitamente más abajo (ver comentario final).
		close(aStarted)
		aResult, aErr = repo.Create(context.Background(), string(shopC), fullName, nil, key, fp)
	}()
	go func() {
		defer wg.Done()
		<-aStarted
		bResult, bErr = repo.Create(context.Background(), string(shopC), fullName, nil, key, fp)
		close(bAttempted)
	}()
	wg.Wait()
	<-bAttempted

	if aErr != nil {
		t.Fatalf("goroutine A: %v", aErr)
	}
	if bErr != nil {
		t.Fatalf("goroutine B: %v", bErr)
	}

	outcomes := map[idempotency.Outcome]int{aResult.Decision.Outcome: 1, bResult.Decision.Outcome: 1}
	// La única combinación INACEPTABLE es que ambas hayan procedido: eso
	// significaría dos INSERT reales para la misma clave.
	if aResult.Decision.Outcome == idempotency.OutcomeProceed && bResult.Decision.Outcome == idempotency.OutcomeProceed {
		t.Fatalf("CA-004-03: both connections proceeded, expected the effect exactly once (%v)", outcomes)
	}
	validPair := func(x, y idempotency.Outcome) bool {
		return x == idempotency.OutcomeProceed &&
			(y == idempotency.OutcomeReplay || y == idempotency.OutcomeLocked || y == idempotency.OutcomeConflictInProgress)
	}
	if !validPair(aResult.Decision.Outcome, bResult.Decision.Outcome) && !validPair(bResult.Decision.Outcome, aResult.Decision.Outcome) {
		t.Fatalf("unexpected outcome pair: a=%s b=%s", aResult.Decision.Outcome, bResult.Decision.Outcome)
	}

	// Exactamente un profesional fue creado para esta clave: confirmarlo
	// leyendo el ganador por id.
	winner := aResult
	if winner.Decision.Outcome != idempotency.OutcomeProceed {
		winner = bResult
	}
	if winner.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatal("expected at least one of the two connections to proceed")
	}
	got, found, err := repo.Get(context.Background(), string(shopC), winner.Professional.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !found || got.FullName != fullName {
		t.Fatalf("expected the single created professional to be persisted, got found=%v %+v", found, got)
	}
}

func TestCreate_SameKeyLiteralInTwoTenants_DoesNotInterfere(t *testing.T) {
	// CA-004-04/RN-TEN-01: la misma clave literal en dos negocios distintos
	// no interfiere: cada una procede de forma independiente.
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	key := idempotency.Key("cross-tenant-" + suffix)
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"X"}`))

	resultC, err := repo.Create(context.Background(), string(shopC), "En C "+suffix, nil, key, fp)
	if err != nil {
		t.Fatalf("Create shopC: %v", err)
	}
	if resultC.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("expected shopC to proceed, got %s", resultC.Decision.Outcome)
	}

	resultD, err := repo.Create(context.Background(), string(shopD), "En D "+suffix, nil, key, fp)
	if err != nil {
		t.Fatalf("Create shopD: %v", err)
	}
	if resultD.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("expected shopD to ALSO proceed with the same literal key (RN-TEN-01), got %s", resultD.Decision.Outcome)
	}
	if resultC.Professional.ID == resultD.Professional.ID {
		t.Fatal("expected two distinct professionals, one per tenant")
	}
}

func TestCreate_DifferentKeysSameName_CreatesTwoDistinctProfessionals(t *testing.T) {
	// La clave de idempotencia no convierte el nombre en único (trabajo
	// requerido §1.3): dos claves distintas SÍ crean dos profesionales con el
	// mismo fullName.
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	name := "Nombre Repetido " + suffix

	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"`+name+`"}`))

	first, err := repo.Create(context.Background(), string(shopC), name, nil, idempotency.Key("key-1-"+suffix), fp)
	if err != nil {
		t.Fatalf("Create (1): %v", err)
	}
	second, err := repo.Create(context.Background(), string(shopC), name, nil, idempotency.Key("key-2-"+suffix), fp)
	if err != nil {
		t.Fatalf("Create (2): %v", err)
	}
	if first.Professional.ID == second.Professional.ID {
		t.Fatal("expected two distinct professionals with the same name from two different idempotency keys")
	}
	if first.Professional.FullName != name || second.Professional.FullName != name {
		t.Fatalf("expected both to keep the requested name, got %q and %q", first.Professional.FullName, second.Professional.FullName)
	}
}

// TestCreate_StoredResponseBody_MatchesHTTPAPIWireShape confirma que el
// JSON que Repository.Create persiste para una repetición exacta usa
// EXACTAMENTE las mismas claves que httpapi.ProfessionalResponse (id, fullName,
// createdAt, updatedAt, photoUpdatedAt): la advertencia de mantenimiento manual que ambos
// archivos declaran en su comentario.
func TestCreate_StoredResponseBody_MatchesHTTPAPIWireShape(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	key := idempotency.Key("wire-shape-" + suffix)
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"Forma"}`))

	result, err := repo.Create(context.Background(), string(shopC), "Forma "+suffix, nil, key, fp)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	var generic map[string]any
	if err := json.Unmarshal([]byte(result.Response.Body), &generic); err != nil {
		t.Fatalf("unmarshal stored body: %v", err)
	}
	wantKeys := []string{"id", "fullName", "createdAt", "updatedAt", "photoUpdatedAt", "description", "rating", "ratingCount"}
	if len(generic) != len(wantKeys) {
		t.Fatalf("expected exactly %v, got keys %v", wantKeys, generic)
	}
	for _, k := range wantKeys {
		if _, ok := generic[k]; !ok {
			t.Fatalf("expected key %q in the stored response body, got %v", k, generic)
		}
	}
	// Un profesional recién creado no tiene fotografía ni descripción: null
	// explícito, no ausente.
	if generic["photoUpdatedAt"] != nil {
		t.Fatalf("a new professional has no photo, got photoUpdatedAt=%v", generic["photoUpdatedAt"])
	}
	if generic["description"] != nil {
		t.Fatalf("a new professional has no description, got description=%v", generic["description"])
	}
}

// --- Descripción del profesional (DEC-127) -------------------------------------

func strPtr(s string) *string { return &s }

func TestCreate_WithDescription_PersistsAndAppearsInStoredResponse(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	key := idempotency.Key("desc-create-" + suffix)
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/professionals", []byte(`{"fullName":"Con descripción","description":"Fade y barba"}`))
	result, err := repo.Create(context.Background(), string(shopC), "Con descripción "+suffix, strPtr("Fade y barba"), key, fp)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if result.Professional.Description == nil || *result.Professional.Description != "Fade y barba" {
		t.Fatalf("expected the description on the created professional, got %+v", result.Professional)
	}

	var stored map[string]any
	if err := json.Unmarshal([]byte(result.Response.Body), &stored); err != nil {
		t.Fatalf("unmarshal stored body: %v", err)
	}
	if stored["description"] != "Fade y barba" {
		t.Fatalf("expected the replayable response to carry the description, got %v", stored["description"])
	}

	got, found, err := repo.Get(context.Background(), string(shopC), result.Professional.ID)
	if err != nil || !found || got.Description == nil || *got.Description != "Fade y barba" {
		t.Fatalf("expected Get to read the description back, got %+v found=%v err=%v", got, found, err)
	}
}

func TestUpdate_Description_SetKeepAndClear(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	ctx := context.Background()

	professional := createProfessional(t, repo, shopC, "Descripción "+suffix)
	if professional.Description != nil {
		t.Fatalf("a professional created without description must have none, got %q", *professional.Description)
	}

	set, err := repo.Update(ctx, string(shopC), professional.ID, professional.FullName, staff.DescriptionPatch{Set: true, Value: strPtr("Navaja clásica")})
	if err != nil || !set.Found || set.Professional.Description == nil || *set.Professional.Description != "Navaja clásica" {
		t.Fatalf("expected the description to be set, got %+v err=%v", set, err)
	}

	// Sin `Set` el nombre cambia y la descripción se conserva.
	kept, err := repo.Update(ctx, string(shopC), professional.ID, "Otro nombre "+suffix, staff.DescriptionPatch{})
	if err != nil || !kept.Found {
		t.Fatalf("Update: %+v err=%v", kept, err)
	}
	if kept.Professional.Description == nil || *kept.Professional.Description != "Navaja clásica" {
		t.Fatalf("an update without a description change must keep it, got %+v", kept.Professional.Description)
	}

	cleared, err := repo.Update(ctx, string(shopC), professional.ID, "Otro nombre "+suffix, staff.DescriptionPatch{Set: true, Value: nil})
	if err != nil || !cleared.Found {
		t.Fatalf("Update: %+v err=%v", cleared, err)
	}
	if cleared.Professional.Description != nil {
		t.Fatalf("Set with a nil value must clear the description, got %q", *cleared.Professional.Description)
	}
}

func TestUpdate_Description_CrossTenant_NeverTouchesAnotherShopsProfessional(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	ctx := context.Background()

	professionalD := createProfessional(t, repo, shopD, "Barbero D "+suffix)
	if _, err := repo.Update(ctx, string(shopD), professionalD.ID, professionalD.FullName, staff.DescriptionPatch{Set: true, Value: strPtr("De D")}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	result, err := repo.Update(ctx, string(shopC), professionalD.ID, "Intruso "+suffix, staff.DescriptionPatch{Set: true, Value: strPtr("Pisada por C")})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if result.Found {
		t.Fatal("CA-021-05: shopC's context updated shopD's professional")
	}

	stillD, found, err := repo.Get(ctx, string(shopD), professionalD.ID)
	if err != nil || !found {
		t.Fatalf("Get: found=%v err=%v", found, err)
	}
	if stillD.FullName != professionalD.FullName || stillD.Description == nil || *stillD.Description != "De D" {
		t.Fatalf("expected shopD's professional untouched, got %+v", stillD)
	}
}

// La base rechaza una descripción vacía o de más de 280 caracteres aunque la
// aplicación ya la normalice: professional_description_ck es la última defensa.
func TestUpdate_Description_DatabaseRejectsEmptyAndOversized(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	ctx := context.Background()

	professional := createProfessional(t, repo, shopC, "Restricción "+suffix)

	for name, value := range map[string]string{
		"vacía":          "",
		"solo espacios":  "   ",
		"281 caracteres": strings.Repeat("a", 281),
	} {
		if _, err := repo.Update(ctx, string(shopC), professional.ID, professional.FullName, staff.DescriptionPatch{Set: true, Value: strPtr(value)}); err == nil {
			t.Errorf("%s: expected professional_description_ck to reject the value", name)
		}
	}

	exact, err := repo.Update(ctx, string(shopC), professional.ID, professional.FullName, staff.DescriptionPatch{Set: true, Value: strPtr(strings.Repeat("ñ", 280))})
	if err != nil || !exact.Found {
		t.Fatalf("a 280-character description must be accepted, got %+v err=%v", exact, err)
	}
}

// seedReview inserta, bajo el tenant del negocio, un servicio, un cliente, una
// cita completada y su reseña directamente en SQL (la aplicación del cliente
// vive en el módulo reviews, que staff no importa). hidden=true la deja oculta.
func seedReview(t *testing.T, db *database.DB, shop database.BusinessID, professionalID string, rating int, hidden bool, slot int) {
	t.Helper()
	suffix := uniqueSuffix(t)
	err := db.InTenantTx(context.Background(), shop, func(ctx context.Context, q database.Queries) error {
		var serviceID, customerID, appointmentID string
		if err := q.QueryRow(ctx,
			`INSERT INTO service (business_id, name, duration_minutes, price_amount, price_currency)
			 VALUES ($1, $2, 30, 20000, 'COP') RETURNING id`, string(shop), "Servicio reseña "+suffix).Scan(&serviceID); err != nil {
			return err
		}
		if err := q.QueryRow(ctx,
			`INSERT INTO customer (business_id, full_name) VALUES ($1, 'Cliente de prueba') RETURNING id`, string(shop)).Scan(&customerID); err != nil {
			return err
		}
		starts := time.Date(2031, 1, 1, 8, 0, 0, 0, time.UTC).AddDate(0, 0, slot).Add(time.Duration(len(suffix)) * time.Minute)
		if err := q.QueryRow(ctx,
			`INSERT INTO appointment (business_id, professional_id, service_id, customer_id, attendee_name, starts_at, ends_at,
			                          status, origin, resolved_at, service_name_snapshot, duration_minutes_snapshot,
			                          price_amount_snapshot, price_currency_snapshot)
			 VALUES ($1, $2, $3, $4, 'Cliente de prueba', $5, $6, 'completed', 'manual', now(), 'Servicio', 30, 20000, 'COP')
			 RETURNING id`, string(shop), professionalID, serviceID, customerID, starts, starts.Add(30*time.Minute)).Scan(&appointmentID); err != nil {
			return err
		}
		_, err := q.Exec(ctx,
			`INSERT INTO professional_review (business_id, professional_id, appointment_id, rating, hidden_at)
			 VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)`,
			string(shop), professionalID, appointmentID, rating, hidden)
		return err
	})
	if err != nil {
		t.Fatalf("seedReview: %v", err)
	}
}

// DEC-128 §5: el promedio (1 decimal) y el total de la ficha del profesional cuentan
// solo las reseñas no ocultas, sin columna derivada, y no cruzan negocios.
func TestGetAndListPage_RatingCountsOnlyVisibleReviews_PerTenant(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)

	rated := createProfessional(t, repo, shopC, "Con reseñas "+suffix)
	unrated := createProfessional(t, repo, shopC, "Sin reseñas "+suffix)
	other := createProfessional(t, repo, shopD, "De otro negocio "+suffix)

	// Sin reseñas: promedio nulo y total 0 (no 0.0).
	got, found, err := repo.Get(context.Background(), string(shopC), rated.ID)
	if err != nil || !found {
		t.Fatalf("Get: found=%v err=%v", found, err)
	}
	if got.Rating != nil || got.RatingCount != 0 {
		t.Fatalf("sin reseñas: rating=%v count=%d", got.Rating, got.RatingCount)
	}

	seedReview(t, db, shopC, rated.ID, 5, false, 1)
	seedReview(t, db, shopC, rated.ID, 4, false, 2)
	seedReview(t, db, shopC, rated.ID, 1, true, 3) // oculta: no cuenta
	seedReview(t, db, shopD, other.ID, 1, false, 4)

	got, _, err = repo.Get(context.Background(), string(shopC), rated.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Rating == nil || *got.Rating != 4.5 || got.RatingCount != 2 {
		t.Fatalf("rating=%v count=%d, se esperaba 4.5 y 2", got.Rating, got.RatingCount)
	}

	// Recorre todas las páginas: la base persistente puede tener más de una.
	var items []staff.Professional
	for pageNumber, totalPages := 1, 1; pageNumber <= totalPages; pageNumber++ {
		page, err := repo.ListPage(context.Background(), string(shopC), pageNumber, 100)
		if err != nil {
			t.Fatalf("ListPage: %v", err)
		}
		totalPages = page.TotalPages
		items = append(items, page.Items...)
	}
	var seenRated, seenUnrated bool
	for _, b := range items {
		switch b.ID {
		case rated.ID:
			seenRated = true
			if b.Rating == nil || *b.Rating != 4.5 || b.RatingCount != 2 {
				t.Fatalf("ListPage: rating=%v count=%d", b.Rating, b.RatingCount)
			}
		case unrated.ID:
			seenUnrated = true
			if b.Rating != nil || b.RatingCount != 0 {
				t.Fatalf("ListPage sin reseñas: rating=%v count=%d", b.Rating, b.RatingCount)
			}
		}
	}
	if !seenRated || !seenUnrated {
		t.Fatalf("ListPage no devolvió los profesionales esperados: rated=%v unrated=%v (items=%d)", seenRated, seenUnrated, len(items))
	}

	// La reseña de otro negocio no se mezcla.
	otherGot, _, _ := repo.Get(context.Background(), string(shopD), other.ID)
	if otherGot.Rating == nil || *otherGot.Rating != 1 || otherGot.RatingCount != 1 {
		t.Fatalf("otro negocio: rating=%v count=%d", otherGot.Rating, otherGot.RatingCount)
	}
}
