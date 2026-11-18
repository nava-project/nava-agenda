// Pruebas de integración de shops.OpeningHoursRepository (HU-107, DEC-182)
// contra PostgreSQL REAL con el par shopA/shopB: guardar reemplaza la semana
// entera, 24:00 sobrevive al viaje y RLS impide tocar el horario del otro.
package postgres_test

import (
	"context"
	"testing"

	"system-barbershop/internal/modules/shops"
	shopspostgres "system-barbershop/internal/modules/shops/postgres"
	"system-barbershop/internal/platform/database"
)

func clearOpeningHours(t *testing.T, shopIDs ...string) {
	t.Helper()
	t.Cleanup(func() {
		db := setupTestDB(t)
		defer db.Close()
		for _, id := range shopIDs {
			if _, _, err := shopspostgres.NewOpeningHoursRepository(db).Replace(context.Background(), id, shops.OpeningHours{}); err != nil {
				t.Fatalf("limpiar horario de %s: %v", id, err)
			}
		}
	})
}

func openingSeg(day shops.Weekday, opens, closes int) shops.OpeningSegment {
	return shops.OpeningSegment{Weekday: day, Opens: shops.ClockMinutes(opens), Closes: shops.ClockMinutes(closes)}
}

func TestOpeningHoursRepository_StartsEmptyAndReplacesTheWholeWeek(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	clearOpeningHours(t, shopA)
	repo := shopspostgres.NewOpeningHoursRepository(db)
	ctx := context.Background()

	got, found, err := repo.Get(ctx, shopA)
	if err != nil || !found || len(got.Segments) != 0 || got.ClosedOnHolidays {
		t.Fatalf("valor inicial: got=%+v found=%v err=%v", got, found, err)
	}

	first := shops.OpeningHours{
		Segments: []shops.OpeningSegment{
			openingSeg(1, 9*60, 12*60), openingSeg(1, 14*60, 19*60),
			openingSeg(5, 20*60, 24*60), openingSeg(6, 0, 2*60),
		},
		ClosedOnHolidays: true,
	}
	stored, found, err := repo.Replace(ctx, shopA, first)
	if err != nil || !found {
		t.Fatalf("Replace: found=%v err=%v", found, err)
	}
	if len(stored.Segments) != 4 || stored.Segments[2].Closes != 24*60 || !stored.ClosedOnHolidays {
		t.Fatalf("lo guardado no vuelve igual (24:00 incluido): %+v", stored)
	}

	// La segunda escritura sustituye: el lunes partido y el fin de semana desaparecen.
	stored, _, err = repo.Replace(ctx, shopA, shops.OpeningHours{Segments: []shops.OpeningSegment{openingSeg(2, 8*60, 17*60)}})
	if err != nil || len(stored.Segments) != 1 || stored.Segments[0].Weekday != 2 || stored.ClosedOnHolidays {
		t.Fatalf("la semana nueva debe reemplazar la anterior: %+v err=%v", stored, err)
	}
}

// Si un tramo falla en la base, la transacción entera se revierte: queda el
// horario anterior completo, no uno a medias.
func TestOpeningHoursRepository_AFailedReplaceKeepsThePreviousWeek(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	clearOpeningHours(t, shopA)
	repo := shopspostgres.NewOpeningHoursRepository(db)
	ctx := context.Background()

	if _, _, err := repo.Replace(ctx, shopA, shops.OpeningHours{Segments: []shops.OpeningSegment{openingSeg(3, 9*60, 18*60)}}); err != nil {
		t.Fatalf("Replace inicial: %v", err)
	}
	// Apertura repetida: el UNIQUE la rechaza aunque el servicio no la haya validado.
	_, _, err := repo.Replace(ctx, shopA, shops.OpeningHours{
		Segments:         []shops.OpeningSegment{openingSeg(4, 9*60, 12*60), openingSeg(4, 9*60, 13*60)},
		ClosedOnHolidays: true,
	})
	if err == nil {
		t.Fatal("una apertura repetida debe fallar en la base")
	}
	got, _, err := repo.Get(ctx, shopA)
	if err != nil || len(got.Segments) != 1 || got.Segments[0].Weekday != 3 || got.ClosedOnHolidays {
		t.Fatalf("debe quedar el horario anterior completo: %+v err=%v", got, err)
	}
}

// RN-TEN-01: el horario de A no aparece en B y una sesión de A no puede borrar
// ni escribir el de B aunque conozca su id.
func TestOpeningHoursRepository_IsolatedBetweenTenants(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	clearOpeningHours(t, shopA, shopB)
	repo := shopspostgres.NewOpeningHoursRepository(db)
	ctx := context.Background()

	if _, _, err := repo.Replace(ctx, shopB, shops.OpeningHours{Segments: []shops.OpeningSegment{openingSeg(1, 10*60, 20*60)}}); err != nil {
		t.Fatalf("Replace B: %v", err)
	}
	if _, _, err := repo.Replace(ctx, shopA, shops.OpeningHours{Segments: []shops.OpeningSegment{openingSeg(2, 8*60, 16*60)}}); err != nil {
		t.Fatalf("Replace A: %v", err)
	}
	gotB, _, err := repo.Get(ctx, shopB)
	if err != nil || len(gotB.Segments) != 1 || gotB.Segments[0].Weekday != 1 {
		t.Fatalf("B no cambia al guardar A: %+v err=%v", gotB, err)
	}

	var deleted int64
	err = db.InTenantTx(ctx, database.BarbershopID(shopA), func(ctx context.Context, q database.Queries) error {
		tag, err := q.Exec(ctx, `DELETE FROM business_opening_hour WHERE business_id = $1`, shopB)
		deleted = tag.RowsAffected()
		return err
	})
	if err != nil || deleted != 0 {
		t.Fatalf("una sesión de A borró %d tramo(s) de B (err=%v)", deleted, err)
	}

	err = db.InTenantTx(ctx, database.BarbershopID(shopA), func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx,
			`INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
			 VALUES ($1, 3, '09:00', '10:00')`, shopB)
		return err
	})
	if err == nil {
		t.Fatal("una sesión de A no debe poder insertar un tramo en el horario de B")
	}
}
