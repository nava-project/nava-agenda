// Pruebas de integración de DEC-169 (ventana de reserva propia por barbero)
// contra PostgreSQL REAL con las migraciones aplicadas y
// database/testdata/hu093_politica_reserva.sql cargado, conectado como
// barberia_app: cubren upsert, lectura, borrado, la FK por tenant y el
// aislamiento RLS entre dos barberías.
package postgres_test

import (
	"context"
	"testing"

	"system-barbershop/internal/modules/shops"
	shopspostgres "system-barbershop/internal/modules/shops/postgres"
	"system-barbershop/internal/platform/database"
)

// Barberos propios de esta prueba en el par dedicado de HU-093. Fijos e
// insertados con ON CONFLICT DO NOTHING para que repetir la suite no acumule
// filas (un barbero no se borra físicamente).
const (
	barberPolicyBarberUno = "d1690000-0000-4000-8000-000000000001"
	barberPolicyBarberDos = "d1690000-0000-4000-8000-000000000002"
)

func seedBarberForPolicy(t *testing.T, db *database.DB, shopID, barberID string) {
	t.Helper()
	err := db.InTenantTx(context.Background(), database.BarbershopID(shopID), func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx,
			`INSERT INTO barber (id, barbershop_id, full_name) VALUES ($1, $2, 'Barbero DEC-169')
			 ON CONFLICT (id) DO NOTHING`, barberID, shopID)
		return err
	})
	if err != nil {
		t.Fatalf("sembrar barbero: %v", err)
	}
}

func TestBarberBookingPolicy_UpsertGetListDelete(t *testing.T) {
	db := setupTestDB(t)
	repo := shopspostgres.NewBarberBookingPolicyRepository(db)
	ctx := context.Background()
	seedBarberForPolicy(t, db, bookingPolicyShopUno, barberPolicyBarberUno)
	t.Cleanup(func() { _ = repo.Delete(ctx, bookingPolicyShopUno, barberPolicyBarberUno) })

	if _, found, err := repo.Get(ctx, bookingPolicyShopUno, barberPolicyBarberUno); err != nil || found {
		t.Fatalf("antes de guardar debe heredar: found=%v err=%v", found, err)
	}

	created, barberFound, err := repo.Upsert(ctx, bookingPolicyShopUno, barberPolicyBarberUno,
		shops.BarberBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40})
	if err != nil || !barberFound {
		t.Fatalf("Upsert: found=%v err=%v", barberFound, err)
	}
	if created.BarberID != barberPolicyBarberUno || created.SlotGridMinutes != 40 || created.UpdatedAt.IsZero() {
		t.Fatalf("respuesta inesperada: %+v", created)
	}

	// Reemplazo completo sobre la misma fila.
	replaced, _, err := repo.Upsert(ctx, bookingPolicyShopUno, barberPolicyBarberUno,
		shops.BarberBookingPolicyInput{MinAdvanceMinutes: 0, MaxAdvanceDays: 14, SlotGridMinutes: 20})
	if err != nil {
		t.Fatalf("Upsert (reemplazo): %v", err)
	}
	got, found, err := repo.Get(ctx, bookingPolicyShopUno, barberPolicyBarberUno)
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
	if len(list) != 1 || list[0].BarberID != barberPolicyBarberUno {
		t.Fatalf("List debe traer solo la configuración propia: %+v", list)
	}

	if err := repo.Delete(ctx, bookingPolicyShopUno, barberPolicyBarberUno); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := repo.Delete(ctx, bookingPolicyShopUno, barberPolicyBarberUno); err != nil {
		t.Fatalf("Delete idempotente: %v", err)
	}
	if _, found, _ := repo.Get(ctx, bookingPolicyShopUno, barberPolicyBarberUno); found {
		t.Fatal("tras borrar, el barbero debe volver a heredar")
	}
}

func TestBarberBookingPolicy_UnknownBarber_WritesNothing(t *testing.T) {
	db := setupTestDB(t)
	repo := shopspostgres.NewBarberBookingPolicyRepository(db)

	_, barberFound, err := repo.Upsert(context.Background(), bookingPolicyShopUno, "d1690000-0000-4000-8000-0000000000ff",
		shops.BarberBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if barberFound {
		t.Fatal("un barbero inexistente no puede recibir configuración")
	}
}

func TestBarberBookingPolicy_TenantIsolation(t *testing.T) {
	db := setupTestDB(t)
	repo := shopspostgres.NewBarberBookingPolicyRepository(db)
	ctx := context.Background()
	seedBarberForPolicy(t, db, bookingPolicyShopUno, barberPolicyBarberUno)
	seedBarberForPolicy(t, db, bookingPolicyShopDos, barberPolicyBarberDos)
	t.Cleanup(func() {
		_ = repo.Delete(ctx, bookingPolicyShopUno, barberPolicyBarberUno)
		_ = repo.Delete(ctx, bookingPolicyShopDos, barberPolicyBarberDos)
	})

	if _, _, err := repo.Upsert(ctx, bookingPolicyShopUno, barberPolicyBarberUno,
		shops.BarberBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40}); err != nil {
		t.Fatalf("Upsert A: %v", err)
	}

	// B no puede configurar al barbero de A: no lo ve, cero escritura.
	_, barberFound, err := repo.Upsert(ctx, bookingPolicyShopDos, barberPolicyBarberUno,
		shops.BarberBookingPolicyInput{MinAdvanceMinutes: 0, MaxAdvanceDays: 1, SlotGridMinutes: 5})
	if err != nil {
		t.Fatalf("Upsert B sobre barbero de A: %v", err)
	}
	if barberFound {
		t.Fatal("B no debe poder configurar a un barbero de A")
	}

	// B no ve, ni lee, ni borra la configuración de A.
	listB, err := repo.List(ctx, bookingPolicyShopDos)
	if err != nil {
		t.Fatalf("List B: %v", err)
	}
	for _, p := range listB {
		if p.BarberID == barberPolicyBarberUno {
			t.Fatal("B no debe listar configuraciones de A")
		}
	}
	if _, found, _ := repo.Get(ctx, bookingPolicyShopDos, barberPolicyBarberUno); found {
		t.Fatal("B no debe leer la configuración de A")
	}
	if err := repo.Delete(ctx, bookingPolicyShopDos, barberPolicyBarberUno); err != nil {
		t.Fatalf("Delete B: %v", err)
	}
	got, found, err := repo.Get(ctx, bookingPolicyShopUno, barberPolicyBarberUno)
	if err != nil || !found || got.SlotGridMinutes != 40 {
		t.Fatalf("la configuración de A debe seguir intacta: %+v found=%v err=%v", got, found, err)
	}
}
