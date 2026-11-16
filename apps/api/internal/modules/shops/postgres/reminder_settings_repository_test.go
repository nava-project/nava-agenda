// Pruebas de integración de shops.ReminderSettingsRepository (DEC-174) contra
// PostgreSQL REAL con el par shopA/shopB: la anticipación es por negocio, el
// CHECK vive en la base y RLS impide tocar la fila del otro.
package postgres_test

import (
	"context"
	"testing"

	"system-barbershop/internal/modules/shops"
	shopspostgres "system-barbershop/internal/modules/shops/postgres"
	"system-barbershop/internal/platform/database"
)

func restoreReminderLead(t *testing.T, shopID string) {
	t.Helper()
	t.Cleanup(func() {
		db := setupTestDB(t)
		defer db.Close()
		if _, _, err := shopspostgres.NewReminderSettingsRepository(db, nil).Update(context.Background(), shopID, 30); err != nil {
			t.Fatalf("restaurar anticipación: %v", err)
		}
	})
}

func TestReminderSettingsRepository_DefaultsToThirtyAndRoundTrips(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	restoreReminderLead(t, shopA)
	repo := shopspostgres.NewReminderSettingsRepository(db, nil)

	got, found, err := repo.Get(context.Background(), shopA)
	if err != nil || !found || got != shops.DefaultReminderLeadMinutes {
		t.Fatalf("valor inicial: got=%d found=%v err=%v", got, found, err)
	}
	for _, lead := range shops.ReminderLeadOptions {
		stored, found, err := repo.Update(context.Background(), shopA, lead)
		if err != nil || !found || stored != lead {
			t.Fatalf("Update(%d): stored=%d found=%v err=%v", lead, stored, found, err)
		}
	}
}

func TestReminderSettingsRepository_TheDatabaseRejectsAValueOutsideTheList(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	restoreReminderLead(t, shopA)

	if _, _, err := shopspostgres.NewReminderSettingsRepository(db, nil).Update(context.Background(), shopA, 45); err == nil {
		t.Fatal("el CHECK debe rechazar 45 aunque el servicio no lo haya validado")
	}
}

// RN-TEN-01: cambiar la anticipación de A no cambia la de B, y una sesión de A no
// puede escribir la fila de B aunque conozca su id.
func TestReminderSettingsRepository_IsolatedBetweenTenants(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	restoreReminderLead(t, shopA)
	restoreReminderLead(t, shopB)
	repo := shopspostgres.NewReminderSettingsRepository(db, nil)

	if _, _, err := repo.Update(context.Background(), shopA, 10); err != nil {
		t.Fatalf("Update A: %v", err)
	}
	if gotB, _, err := repo.Get(context.Background(), shopB); err != nil || gotB != 30 {
		t.Fatalf("B no cambia al cambiar A: got=%d err=%v", gotB, err)
	}

	var affected int64
	err := db.InTenantTx(context.Background(), database.BarbershopID(shopA), func(ctx context.Context, q database.Queries) error {
		tag, err := q.Exec(ctx, `UPDATE barbershop SET reminder_lead_minutes = 60 WHERE id = $1`, shopB)
		affected = tag.RowsAffected()
		return err
	})
	if err != nil || affected != 0 {
		t.Fatalf("una sesión de A modificó %d fila(s) de B (err=%v)", affected, err)
	}
}
