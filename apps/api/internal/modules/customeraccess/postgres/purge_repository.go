package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"system-barbershop/internal/platform/database"
)

// PurgeRepository purga los retos de acceso vencidos (HU-105) con
// customer_access_challenge_purge_expired, concedida solo a barberia_worker. db
// debe ser el pool del proceso worker (DEC-040), nunca el de api.
type PurgeRepository struct {
	db *database.DB
}

// NewPurgeRepository construye el repositorio.
func NewPurgeRepository(db *database.DB) *PurgeRepository {
	return &PurgeRepository{db: db}
}

// PurgeExpiredChallenges borra en un lote, de a lo sumo limit filas, los retos
// vencidos hace más de una hora, y devuelve cuántos borró.
func (r *PurgeRepository) PurgeExpiredChallenges(ctx context.Context, limit int) (int, error) {
	var deleted int
	err := r.db.CallSecurityDefinerRow(ctx,
		`SELECT customer_access_challenge_purge_expired($1)`, []any{limit},
		func(row pgx.Row) error { return row.Scan(&deleted) },
	)
	if err != nil {
		return 0, fmt.Errorf("customeraccess/postgres: purge customer_access_challenge: %w", err)
	}
	return deleted, nil
}
