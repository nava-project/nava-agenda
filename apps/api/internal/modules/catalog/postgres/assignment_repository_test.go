// Package postgres_test (pruebas de integración, HU-023) requiere
// PostgreSQL REAL con las doce migraciones aplicadas (incluida
// 20260824150000_create_barber_service.sql) y database/testdata/
// dos_negocios.sql + database/testdata/hu023_asignaciones.sql cargados,
// además de un professional y un service reales por prueba. Conéctate como
// agenda_app (docs/03-desarrollo/estrategia-pruebas.md §2 prohíbe mocks
// para RLS/FK/carreras reales).
//
// Los profesionales de fixture se insertan con SQL directo (no vía
// staffpostgres.Repository): este paquete no importa el módulo staff bajo
// ninguna circunstancia, ni siquiera en pruebas (internal/platform/archtest/
// module_boundary_test.go lo verifica) -mismo espíritu que HU-023 exige
// para el propio núcleo (colaboración solo por ProfessionalPort). Los servicios sí
// se crean vía catalogpostgres.Repository.Create: ES el mismo módulo bajo
// prueba, no una dependencia cruzada.
//
//	export TEST_DATABASE_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable"
//	go test -race ./internal/modules/catalog/postgres/...
package postgres_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"nava-agenda/internal/modules/catalog"
	catalogpostgres "nava-agenda/internal/modules/catalog/postgres"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/idempotency"
)

const (
	// shopG/shopH son los dos negocios dedicados de
	// testdata/hu023_asignaciones.sql: aisladas de dos_negocios.sql/
	// hu021_profesionales.sql/hu022_catalogo.sql para que un conteo exacto de
	// asignaciones no dependa de lo que otras suites hagan sobre
	// shopA-shopF.
	shopG = database.BusinessID("77777777-7777-7777-7777-777777777777")
	shopH = database.BusinessID("88888888-8888-8888-8888-888888888888")
)

func newAssignmentRepository(db *database.DB) *catalogpostgres.AssignmentRepository {
	return catalogpostgres.NewAssignmentRepository(db)
}

// fixtureProfessional es el subconjunto mínimo de un profesional real que este
// paquete necesita para sus fixtures: solo el id, nunca importando
// staff.Professional (ver nota de paquete más arriba).
type fixtureProfessional struct {
	ID string
}

func createProfessionalFixture(t *testing.T, db *database.DB, shop database.BusinessID, name string) fixtureProfessional {
	t.Helper()
	var id string
	err := db.InTenantTx(context.Background(), shop, func(ctx context.Context, q database.Queries) error {
		return q.QueryRow(ctx,
			`INSERT INTO professional (business_id, full_name) VALUES ($1, $2) RETURNING id`,
			string(shop), name,
		).Scan(&id)
	})
	if err != nil {
		t.Fatalf("createProfessionalFixture: %v", err)
	}
	return fixtureProfessional{ID: id}
}

func createServiceFixture(t *testing.T, db *database.DB, shop database.BusinessID, name string) catalog.Service {
	t.Helper()
	repo := catalogpostgres.New(db, idempotency.NewSQLCoordinator())
	key := idempotency.Key("assignment-fixture-service-" + uniqueSuffix(t))
	fp := idempotency.ComputeFingerprint("POST", "/api/v1/private/services", []byte(`{"name":"`+name+`"}`))
	result, err := repo.Create(context.Background(), string(shop), validInput(name), key, fp)
	if err != nil {
		t.Fatalf("createServiceFixture: %v", err)
	}
	if result.NameTaken {
		t.Fatalf("createServiceFixture: unexpected name conflict for %q", name)
	}
	if result.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("createServiceFixture: expected OutcomeProceed, got %s", result.Decision.Outcome)
	}
	return result.Service
}

// --- Assign: CA-023-02, CA-023-03, CA-023-04 -----------------------------

func TestAssign_New_CreatesRowAndIsVisibleInList(t *testing.T) {
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	professional := createProfessionalFixture(t, db, shopG, "Barbero Asignación "+suffix)
	service := createServiceFixture(t, db, shopG, "Servicio Asignación "+suffix)

	result, err := repo.Assign(context.Background(), string(shopG), professional.ID, service.ID)
	if err != nil {
		t.Fatalf("Assign: %v", err)
	}
	if result.Outcome != catalog.AssignOutcomeCreated {
		t.Fatalf("expected AssignOutcomeCreated, got %v", result.Outcome)
	}
	if result.Assignment.ProfessionalID != professional.ID || result.Assignment.ServiceID != service.ID {
		t.Fatalf("unexpected assignment: %+v", result.Assignment)
	}

	page, err := repo.List(context.Background(), string(shopG), professional.ID, nil, 50)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	found := false
	for _, item := range page.Items {
		if item.ServiceID == service.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected the new assignment to appear in List, got %+v", page.Items)
	}
}

func TestAssign_Repeated_DoesNotCreateASecondRow(t *testing.T) {
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	professional := createProfessionalFixture(t, db, shopG, "Barbero Repetido "+suffix)
	service := createServiceFixture(t, db, shopG, "Servicio Repetido "+suffix)

	first, err := repo.Assign(context.Background(), string(shopG), professional.ID, service.ID)
	if err != nil {
		t.Fatalf("Assign (first): %v", err)
	}
	if first.Outcome != catalog.AssignOutcomeCreated {
		t.Fatalf("expected first call to create, got %v", first.Outcome)
	}

	second, err := repo.Assign(context.Background(), string(shopG), professional.ID, service.ID)
	if err != nil {
		t.Fatalf("Assign (second): %v", err)
	}
	if second.Outcome != catalog.AssignOutcomeAlreadyExists {
		t.Fatalf("expected AssignOutcomeAlreadyExists, got %v", second.Outcome)
	}
	if !second.Assignment.CreatedAt.Equal(first.Assignment.CreatedAt) {
		t.Fatalf("expected the replay to report the ORIGINAL createdAt, got first=%v second=%v",
			first.Assignment.CreatedAt, second.Assignment.CreatedAt)
	}

	page, err := repo.List(context.Background(), string(shopG), professional.ID, nil, 50)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	count := 0
	for _, item := range page.Items {
		if item.ServiceID == service.ID {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("CA-023-02: expected exactly 1 row for this pair, got %d", count)
	}
}

func TestAssign_SameServiceToMultipleProfessionals_EachIsAnIndependentResource(t *testing.T) {
	// CA-023-03: un mismo servicio puede asignarse a varios profesionales de la
	// mismo negocio, cada asociación es un recurso independiente.
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	service := createServiceFixture(t, db, shopG, "Servicio Compartido "+suffix)

	var professionals []fixtureProfessional
	for i := 0; i < 4; i++ {
		professionals = append(professionals, createProfessionalFixture(t, db, shopG, "Equipo Compartido "+suffix+string(rune('A'+i))))
	}

	for _, b := range professionals {
		result, err := repo.Assign(context.Background(), string(shopG), b.ID, service.ID)
		if err != nil {
			t.Fatalf("Assign: %v", err)
		}
		if result.Outcome != catalog.AssignOutcomeCreated {
			t.Fatalf("expected AssignOutcomeCreated for professional %s, got %v", b.ID, result.Outcome)
		}
	}

	// Retirar uno no afecta a los otros tres (cada asociación es
	// independiente): el servicio sigue activo con 3 asignaciones
	// restantes, muy por encima de la última.
	unassignRepo := repo
	unassignResult, err := unassignRepo.Unassign(context.Background(), string(shopG), professionals[0].ID, service.ID)
	if err != nil {
		t.Fatalf("Unassign: %v", err)
	}
	if unassignResult.Outcome != catalog.UnassignOutcomeDeleted {
		t.Fatalf("expected UnassignOutcomeDeleted, got %v", unassignResult.Outcome)
	}
	for _, b := range professionals[1:] {
		page, err := repo.List(context.Background(), string(shopG), b.ID, nil, 50)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		found := false
		for _, item := range page.Items {
			if item.ServiceID == service.ID {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected professional %s to keep its own assignment untouched", b.ID)
		}
	}
}

func TestAssign_UnknownServiceInSameTenant_ServiceNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	professional := createProfessionalFixture(t, db, shopG, "Barbero Sin Servicio "+suffix)

	result, err := repo.Assign(context.Background(), string(shopG), professional.ID, "99999999-9999-4999-8999-999999999999")
	if err != nil {
		t.Fatalf("Assign: %v", err)
	}
	if result.Outcome != catalog.AssignOutcomeServiceNotFound {
		t.Fatalf("expected AssignOutcomeServiceNotFound, got %v", result.Outcome)
	}
}

func TestAssign_ServiceFromAnotherTenant_ServiceNotFound(t *testing.T) {
	// CA-023-04: un servicio real, pero de Otro negocio, es indistinguible
	// de uno inexistente: el filtro WHERE business_id = $2 (defensa en
	// profundidad, además de RLS) lo descubre como "no existe" antes de
	// tocar la FK.
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	professionalG := createProfessionalFixture(t, db, shopG, "Barbero G "+suffix)
	serviceH := createServiceFixture(t, db, shopH, "Servicio H "+suffix)

	result, err := repo.Assign(context.Background(), string(shopG), professionalG.ID, serviceH.ID)
	if err != nil {
		t.Fatalf("Assign: %v", err)
	}
	if result.Outcome != catalog.AssignOutcomeServiceNotFound {
		t.Fatalf("expected AssignOutcomeServiceNotFound for a cross-tenant service, got %v", result.Outcome)
	}
}

// TestRawSQL_CompositeFK_RejectsCrossTenantAssociation confirma, con SQL
// directo (sin pasar por AssignmentRepository, que ya lo evita con su
// propio filtro), que professional_service_professional_fk/professional_service_service_fk
// (FK compuestas por business_id) rechazan una asociación entre un
// profesional y un servicio de negocios distintos AUN bajo el rol de
// aplicación real (CA-023-04): "la FK tenant-aware ... rechaza la relación
// incluso con el rol real de aplicación".
func TestRawSQL_CompositeFK_RejectsCrossTenantAssociation(t *testing.T) {
	db := setupTestDB(t)
	suffix := uniqueSuffix(t)

	professionalG := createProfessionalFixture(t, db, shopG, "FK Profesional G "+suffix)
	serviceH := createServiceFixture(t, db, shopH, "FK Servicio H "+suffix)

	err := db.InTenantTx(context.Background(), shopG, func(ctx context.Context, q database.Queries) error {
		_, execErr := q.Exec(ctx,
			`INSERT INTO professional_service (business_id, professional_id, service_id) VALUES ($1, $2, $3)`,
			string(shopG), professionalG.ID, serviceH.ID,
		)
		return execErr
	})
	if err == nil {
		t.Fatal("CA-023-04: expected the composite FK to reject a cross-tenant association, got no error")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
		t.Fatalf("expected a foreign_key_violation (23503), got %v", err)
	}
}

// --- Unassign: CA-023-05, DEC-114 ----------------------------------------

func TestUnassign_NotLastAssignment_Deletes(t *testing.T) {
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	service := createServiceFixture(t, db, shopG, "Servicio No Última "+suffix)
	professionalA := createProfessionalFixture(t, db, shopG, "No Última A "+suffix)
	professionalB := createProfessionalFixture(t, db, shopG, "No Última B "+suffix)

	mustAssign(t, repo, shopG, professionalA.ID, service.ID)
	mustAssign(t, repo, shopG, professionalB.ID, service.ID)

	result, err := repo.Unassign(context.Background(), string(shopG), professionalA.ID, service.ID)
	if err != nil {
		t.Fatalf("Unassign: %v", err)
	}
	if result.Outcome != catalog.UnassignOutcomeDeleted {
		t.Fatalf("expected UnassignOutcomeDeleted, got %v", result.Outcome)
	}

	page, err := repo.List(context.Background(), string(shopG), professionalA.ID, nil, 50)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, item := range page.Items {
		if item.ServiceID == service.ID {
			t.Fatal("expected the assignment to be gone after Unassign")
		}
	}
}

func TestUnassign_LastAssignmentOfActiveService_Deletes(t *testing.T) {
	// DEC-114 (sustituye a DEC-068): retirar al único profesional de un servicio
	// activo es válido; el servicio queda sin asignaciones.
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	service := createServiceFixture(t, db, shopG, "Servicio Última "+suffix)
	professional := createProfessionalFixture(t, db, shopG, "Última Único "+suffix)
	mustAssign(t, repo, shopG, professional.ID, service.ID)

	result, err := repo.Unassign(context.Background(), string(shopG), professional.ID, service.ID)
	if err != nil {
		t.Fatalf("Unassign: %v", err)
	}
	if result.Outcome != catalog.UnassignOutcomeDeleted {
		t.Fatalf("expected UnassignOutcomeDeleted, got %v", result.Outcome)
	}

	page, err := repo.List(context.Background(), string(shopG), professional.ID, nil, 50)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, item := range page.Items {
		if item.ServiceID == service.ID {
			t.Fatal("expected the last assignment to be gone after Unassign")
		}
	}

	// Repetir la operación es seguro: la asociación ya no existe.
	again, err := repo.Unassign(context.Background(), string(shopG), professional.ID, service.ID)
	if err != nil {
		t.Fatalf("Unassign (retry): %v", err)
	}
	if again.Outcome != catalog.UnassignOutcomeNotFound {
		t.Fatalf("expected the retry to report NotFound, got %v", again.Outcome)
	}
}

func TestUnassign_NoSuchAssignment_NotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	service := createServiceFixture(t, db, shopG, "Servicio Sin Asignar "+suffix)
	professional := createProfessionalFixture(t, db, shopG, "Sin Asignar "+suffix)

	result, err := repo.Unassign(context.Background(), string(shopG), professional.ID, service.ID)
	if err != nil {
		t.Fatalf("Unassign: %v", err)
	}
	if result.Outcome != catalog.UnassignOutcomeNotFound {
		t.Fatalf("expected UnassignOutcomeNotFound, got %v", result.Outcome)
	}
}

func TestUnassign_UnknownService_NotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	professional := createProfessionalFixture(t, db, shopG, "Servicio Fantasma "+suffix)

	result, err := repo.Unassign(context.Background(), string(shopG), professional.ID, "99999999-9999-4999-8999-999999999999")
	if err != nil {
		t.Fatalf("Unassign: %v", err)
	}
	if result.Outcome != catalog.UnassignOutcomeNotFound {
		t.Fatalf("expected UnassignOutcomeNotFound for an unknown service, got %v", result.Outcome)
	}
}

// TestUnassign_ConcurrentOnLastTwoAssignments_BothSucceed: dos
// desasignaciones concurrentes REALES (dos conexiones físicas) de las dos
// únicas filas de un servicio. Sin la regla de DEC-068 (sustituida por
// DEC-114) ambas terminan en UnassignOutcomeDeleted y el servicio queda sin
// asignaciones, sin errores ni filas a medias.
func TestUnassign_ConcurrentOnLastTwoAssignments_BothSucceed(t *testing.T) {
	db := setupTestDB(t)
	repo := newAssignmentRepository(db)
	suffix := uniqueSuffix(t)

	service := createServiceFixture(t, db, shopG, "Servicio Carrera "+suffix)
	professionalA := createProfessionalFixture(t, db, shopG, "Carrera A "+suffix)
	professionalB := createProfessionalFixture(t, db, shopG, "Carrera B "+suffix)

	mustAssign(t, repo, shopG, professionalA.ID, service.ID)
	mustAssign(t, repo, shopG, professionalB.ID, service.ID)

	var (
		wg               sync.WaitGroup
		resultA, resultB catalog.UnassignResult
		errA, errB       error
		startA           = make(chan struct{})
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		close(startA)
		resultA, errA = repo.Unassign(context.Background(), string(shopG), professionalA.ID, service.ID)
	}()
	go func() {
		defer wg.Done()
		<-startA
		resultB, errB = repo.Unassign(context.Background(), string(shopG), professionalB.ID, service.ID)
	}()
	wg.Wait()

	if errA != nil {
		t.Fatalf("goroutine A: %v", errA)
	}
	if errB != nil {
		t.Fatalf("goroutine B: %v", errB)
	}
	if resultA.Outcome != catalog.UnassignOutcomeDeleted || resultB.Outcome != catalog.UnassignOutcomeDeleted {
		t.Fatalf("expected both unassigns to delete, got A=%v B=%v", resultA.Outcome, resultB.Outcome)
	}

	for _, professionalID := range []string{professionalA.ID, professionalB.ID} {
		page, err := repo.List(context.Background(), string(shopG), professionalID, nil, 50)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		for _, item := range page.Items {
			if item.ServiceID == service.ID {
				t.Fatalf("expected no assignment left for professional %s", professionalID)
			}
		}
	}
}

func mustAssign(t *testing.T, repo *catalogpostgres.AssignmentRepository, shop database.BusinessID, professionalID, serviceID string) {
	t.Helper()
	result, err := repo.Assign(context.Background(), string(shop), professionalID, serviceID)
	if err != nil {
		t.Fatalf("mustAssign: %v", err)
	}
	if result.Outcome != catalog.AssignOutcomeCreated {
		t.Fatalf("mustAssign: expected AssignOutcomeCreated, got %v", result.Outcome)
	}
}
