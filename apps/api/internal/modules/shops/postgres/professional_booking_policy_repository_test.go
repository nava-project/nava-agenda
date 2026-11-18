// Pruebas de integración de DEC-169 (ventana de reserva propia por profesional)
// contra PostgreSQL REAL con las migraciones aplicadas y
// database/testdata/hu093_politica_reserva.sql cargado, conectado como
// agenda_app: cubren upsert, lectura, borrado, la FK por tenant y el
// aislamiento RLS entre dos negocios.
package postgres_test

import (
	"context"
	"testing"

	"nava-agenda/internal/modules/shops"
	shopspostgres "nava-agenda/internal/modules/shops/postgres"
	"nava-agenda/internal/platform/database"
)

// Profesionales propios de esta prueba en el par dedicado de HU-093. Fijos e
// insertados con ON CONFLICT DO NOTHING para que repetir la suite no acumule
// filas (un profesional no se borra físicamente).
const (
	professionalPolicyProfessionalUno = "d1690000-0000-4000-8000-000000000001"
	professionalPolicyProfessionalDos = "d1690000-0000-4000-8000-000000000002"
)

func seedProfessionalForPolicy(t *testing.T, db *database.DB, shopID, professionalID string) {
	t.Helper()
	err := db.InTenantTx(context.Background(), database.BusinessID(shopID), func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx,
			`INSERT INTO professional (id, business_id, full_name) VALUES ($1, $2, 'Barbero DEC-169')
			 ON CONFLICT (id) DO NOTHING`, professionalID, shopID)
		return err
	})
	if err != nil {
		t.Fatalf("sembrar profesional: %v", err)
	}
}

func TestProfessionalBookingPolicy_UpsertGetListDelete(t *testing.T) {
	db := setupTestDB(t)
	repo := shopspostgres.NewProfessionalBookingPolicyRepository(db)
	ctx := context.Background()
	seedProfessionalForPolicy(t, db, bookingPolicyShopUno, professionalPolicyProfessionalUno)
	t.Cleanup(func() { _ = repo.Delete(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno) })

	if _, found, err := repo.Get(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno); err != nil || found {
		t.Fatalf("antes de guardar debe heredar: found=%v err=%v", found, err)
	}

	created, professionalFound, err := repo.Upsert(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno,
		shops.ProfessionalBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40})
	if err != nil || !professionalFound {
		t.Fatalf("Upsert: found=%v err=%v", professionalFound, err)
	}
	if created.ProfessionalID != professionalPolicyProfessionalUno || created.SlotGridMinutes != 40 || created.UpdatedAt.IsZero() {
		t.Fatalf("respuesta inesperada: %+v", created)
	}

	// Reemplazo completo sobre la misma fila.
	replaced, _, err := repo.Upsert(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno,
		shops.ProfessionalBookingPolicyInput{MinAdvanceMinutes: 0, MaxAdvanceDays: 14, SlotGridMinutes: 20})
	if err != nil {
		t.Fatalf("Upsert (reemplazo): %v", err)
	}
	got, found, err := repo.Get(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno)
	if err != nil || !found {
		t.Fatalf("Get: found=%v err=%v", found, err)
	}
	if got.MinAdvanceMinutes != 0 || got.MaxAdvanceDays != 14 || got.SlotGridMinutes != 20 || got != replaced {
		t.Fatalf("Get debe devolver el reemplazo: %+v vs %+v", got, replaced)
	}

	list, err := repo.List(ctx, bookingPolicyShopUno)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 || list[0].ProfessionalID != professionalPolicyProfessionalUno {
		t.Fatalf("List debe traer solo la configuración propia: %+v", list)
	}

	if err := repo.Delete(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := repo.Delete(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno); err != nil {
		t.Fatalf("Delete idempotente: %v", err)
	}
	if _, found, _ := repo.Get(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno); found {
		t.Fatal("tras borrar, el profesional debe volver a heredar")
	}
}

func TestProfessionalBookingPolicy_UnknownProfessional_WritesNothing(t *testing.T) {
	db := setupTestDB(t)
	repo := shopspostgres.NewProfessionalBookingPolicyRepository(db)

	_, professionalFound, err := repo.Upsert(context.Background(), bookingPolicyShopUno, "d1690000-0000-4000-8000-0000000000ff",
		shops.ProfessionalBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if professionalFound {
		t.Fatal("un profesional inexistente no puede recibir configuración")
	}
}

func TestProfessionalBookingPolicy_TenantIsolation(t *testing.T) {
	db := setupTestDB(t)
	repo := shopspostgres.NewProfessionalBookingPolicyRepository(db)
	ctx := context.Background()
	seedProfessionalForPolicy(t, db, bookingPolicyShopUno, professionalPolicyProfessionalUno)
	seedProfessionalForPolicy(t, db, bookingPolicyShopDos, professionalPolicyProfessionalDos)
	t.Cleanup(func() {
		_ = repo.Delete(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno)
		_ = repo.Delete(ctx, bookingPolicyShopDos, professionalPolicyProfessionalDos)
	})

	if _, _, err := repo.Upsert(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno,
		shops.ProfessionalBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40}); err != nil {
		t.Fatalf("Upsert A: %v", err)
	}

	// B no puede configurar al profesional de A: no lo ve, cero escritura.
	_, professionalFound, err := repo.Upsert(ctx, bookingPolicyShopDos, professionalPolicyProfessionalUno,
		shops.ProfessionalBookingPolicyInput{MinAdvanceMinutes: 0, MaxAdvanceDays: 1, SlotGridMinutes: 5})
	if err != nil {
		t.Fatalf("Upsert B sobre profesional de A: %v", err)
	}
	if professionalFound {
		t.Fatal("B no debe poder configurar a un profesional de A")
	}

	// B no ve, ni lee, ni borra la configuración de A.
	listB, err := repo.List(ctx, bookingPolicyShopDos)
	if err != nil {
		t.Fatalf("List B: %v", err)
	}
	for _, p := range listB {
		if p.ProfessionalID == professionalPolicyProfessionalUno {
			t.Fatal("B no debe listar configuraciones de A")
		}
	}
	if _, found, _ := repo.Get(ctx, bookingPolicyShopDos, professionalPolicyProfessionalUno); found {
		t.Fatal("B no debe leer la configuración de A")
	}
	if err := repo.Delete(ctx, bookingPolicyShopDos, professionalPolicyProfessionalUno); err != nil {
		t.Fatalf("Delete B: %v", err)
	}
	got, found, err := repo.Get(ctx, bookingPolicyShopUno, professionalPolicyProfessionalUno)
	if err != nil || !found || got.SlotGridMinutes != 40 {
		t.Fatalf("la configuración de A debe seguir intacta: %+v found=%v err=%v", got, found, err)
	}
}
