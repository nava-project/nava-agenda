package postgres_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"nava-agenda/internal/modules/retention"
	retentionpostgres "nava-agenda/internal/modules/retention/postgres"
	"nava-agenda/internal/platform/config"
	"nava-agenda/internal/platform/database"
)

// Negocio A de database/testdata/dos_negocios.sql.
const businessA = "11111111-1111-1111-1111-111111111111"

func openDB(t *testing.T, env, fallback string) *database.DB {
	t.Helper()
	url := os.Getenv(env)
	if url == "" {
		url = fallback
	}
	db, err := database.NewDB(config.DatabaseDSN(url), config.Config{
		Environment: "test", DatabaseMaxConns: 5, DatabaseMinConns: 1,
		DatabaseMaxConnLifetime: time.Hour, DatabaseMaxConnIdleTime: 30 * time.Minute,
		DatabaseConnectTimeout: 5 * time.Second, DatabaseStatementTimeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatalf("database.NewDB (%s): %v", env, err)
	}
	t.Cleanup(db.Close)
	return db
}

// La base de pruebas persiste entre corridas: cada cliente lleva un teléfono propio.
func uniquePhone() string {
	return fmt.Sprintf("+5730%09d", time.Now().UnixNano()%1_000_000_000)
}

func TestAnonymizeExpired_AnonymizesOnlyExpiredCustomers(t *testing.T) {
	ctx := context.Background()
	appDB := openDB(t, "TEST_DATABASE_URL", "postgres://agenda_app@localhost:5432/agenda_test?sslmode=disable")
	workerDB := openDB(t, "TEST_WORKER_DATABASE_URL", "postgres://agenda_worker@localhost:5432/agenda_test?sslmode=disable")

	expiredPhone, activePhone := uniquePhone(), uniquePhone()+"1"
	var expiredID, activeID string
	err := appDB.InTenantTx(ctx, database.BusinessID(businessA), func(ctx context.Context, q database.Queries) error {
		now := time.Now().UTC()
		// Sin turnos, la última actividad es la creación (DEC-054): uno venció
		// hace un mes (25 meses) y el otro sigue activo (23 meses).
		if err := q.QueryRow(ctx,
			`INSERT INTO customer (business_id, full_name, phone, created_at)
			 VALUES ($1, 'Cliente vencido de prueba', $2, $3) RETURNING id`,
			businessA, expiredPhone, now.AddDate(0, -25, 0)).Scan(&expiredID); err != nil {
			return err
		}
		return q.QueryRow(ctx,
			`INSERT INTO customer (business_id, full_name, phone, created_at)
			 VALUES ($1, 'Cliente activo de prueba', $2, $3) RETURNING id`,
			businessA, activePhone, now.AddDate(0, -23, 0)).Scan(&activeID)
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	total, err := retention.NewService(retentionpostgres.NewRepository(workerDB)).RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if total < 1 {
		t.Fatalf("total=%d, want at least the expired customer", total)
	}

	type row struct {
		name       string
		phone      *string
		anonymized bool
	}
	read := func(id string) row {
		var r row
		if err := appDB.InTenantTx(ctx, database.BusinessID(businessA), func(ctx context.Context, q database.Queries) error {
			return q.QueryRow(ctx,
				`SELECT full_name, phone, anonymized_at IS NOT NULL FROM customer WHERE id = $1`, id,
			).Scan(&r.name, &r.phone, &r.anonymized)
		}); err != nil {
			t.Fatalf("read %s: %v", id, err)
		}
		return r
	}

	if got := read(expiredID); !got.anonymized || got.name != "Cliente anonimizado" || got.phone != nil {
		t.Fatalf("expired customer = %+v, want anonymized with the marker and no phone", got)
	}
	if got := read(activeID); got.anonymized || got.phone == nil || *got.phone != activePhone {
		t.Fatalf("active customer = %+v, want untouched", got)
	}

	// Repetir no vuelve a contar al ya anonimizado.
	again, err := retentionpostgres.NewRepository(workerDB).AnonymizeExpired(ctx, retention.BatchLimit)
	if err != nil {
		t.Fatalf("AnonymizeExpired (repeat): %v", err)
	}
	if again != 0 {
		t.Fatalf("repeat anonymized %d, want 0", again)
	}
}

func TestAnonymizeExpired_RejectsTheAppRole(t *testing.T) {
	appDB := openDB(t, "TEST_DATABASE_URL", "postgres://agenda_app@localhost:5432/agenda_test?sslmode=disable")
	if _, err := retentionpostgres.NewRepository(appDB).AnonymizeExpired(context.Background(), 1); err == nil {
		t.Fatal("agenda_app must not be able to run customer_anonymize_expired")
	}
}
