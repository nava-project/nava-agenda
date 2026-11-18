package postgres_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	customeraccesspostgres "system-barbershop/internal/modules/customeraccess/postgres"
	"system-barbershop/internal/platform/config"
	"system-barbershop/internal/platform/database"
)

func setupWorkerDB(t *testing.T) *database.DB {
	t.Helper()
	url := os.Getenv("TEST_WORKER_DATABASE_URL")
	if url == "" {
		url = "postgres://agenda_worker@localhost:5432/barberia_test?sslmode=disable"
	}
	db, err := database.NewDB(config.DatabaseDSN(url), config.Config{
		Environment: "test", DatabaseMaxConns: 5, DatabaseMinConns: 1,
		DatabaseMaxConnLifetime: time.Hour, DatabaseMaxConnIdleTime: 30 * time.Minute,
		DatabaseConnectTimeout: 5 * time.Second, DatabaseStatementTimeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatalf("database.NewDB (worker): %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func TestPurgeExpiredChallenges_KeepsRecentRowsAndRemovesOldOnes(t *testing.T) {
	appDB := setupTestDB(t)
	ctx := context.Background()
	// Hashes propios de cada corrida: la base de pruebas persiste entre ejecuciones.
	hash := func(seed string) string { return strings.Repeat(seed+uniqueDigits(t, 8), 8)[:64] }
	old, recent := hash("a"), hash("b")

	err := appDB.InTenantTx(ctx, database.BarbershopID(accessShopUno), func(ctx context.Context, q database.Queries) error {
		now := time.Now().UTC()
		// Vencido hace tres horas: se purga. Vencido hace 30 minutos: todavía cuenta
		// para la ventana del límite y se conserva.
		for _, row := range []struct {
			contact string
			created time.Time
			expires time.Time
		}{
			{old, now.Add(-4 * time.Hour), now.Add(-3 * time.Hour)},
			{recent, now.Add(-40 * time.Minute), now.Add(-30 * time.Minute)},
		} {
			if _, err := q.Exec(ctx,
				`INSERT INTO customer_access_challenge (business_id, channel, contact_hash, ip_hash, created_at, expires_at)
				 VALUES ($1, 'email', $2, $2, $3, $4)`,
				accessShopUno, row.contact, row.created, row.expires); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	repo := customeraccesspostgres.NewPurgeRepository(setupWorkerDB(t))
	if _, err := repo.PurgeExpiredChallenges(ctx, 1000); err != nil {
		t.Fatalf("PurgeExpiredChallenges: %v", err)
	}

	count := func(contact string) int {
		var n int
		if err := appDB.InTenantTx(ctx, database.BarbershopID(accessShopUno), func(ctx context.Context, q database.Queries) error {
			return q.QueryRow(ctx, `SELECT count(*) FROM customer_access_challenge WHERE contact_hash = $1`, contact).Scan(&n)
		}); err != nil {
			t.Fatalf("count: %v", err)
		}
		return n
	}
	if count(old) != 0 {
		t.Fatal("a challenge expired more than an hour ago must be purged")
	}
	if count(recent) != 1 {
		t.Fatal("a challenge expired 30 minutes ago must be kept: it still counts for the rate limit")
	}
}

func TestPurge_AppRoleCannotDeleteNorCallThePurgeFunction(t *testing.T) {
	appDB := setupTestDB(t)
	ctx := context.Background()
	err := appDB.InTenantTx(ctx, database.BarbershopID(accessShopUno), func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx, `DELETE FROM customer_access_challenge`)
		return err
	})
	if err == nil {
		t.Fatal("agenda_app must not be able to DELETE retos")
	}
	err = appDB.InTenantTx(ctx, database.BarbershopID(accessShopUno), func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx, `SELECT customer_access_challenge_purge_expired(10)`)
		return err
	})
	if err == nil {
		t.Fatal("agenda_app must not be able to run the purge function")
	}
}
