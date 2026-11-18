// Package postgres es el adaptador de retention sobre PostgreSQL.
package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/platform/database"
)

// Repository ejecuta el lote de anonimización con customer_anonymize_expired,
// concedida solo a agenda_worker. db debe ser el pool del proceso worker
// (DEC-040), nunca el de api.
type Repository struct {
	db *database.DB
}

// NewRepository construye el repositorio.
func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db}
}

// AnonymizeExpired anonimiza hasta limit clientes vencidos en una transacción
// y devuelve cuántos anonimizó. El instante es el reloj de la base, el mismo
// contra el que se guardó la actividad de cada cliente.
func (r *Repository) AnonymizeExpired(ctx context.Context, limit int) (int, error) {
	var anonymized int
	err := r.db.CallSecurityDefinerRow(ctx,
		`SELECT customer_anonymize_expired($1, pg_catalog.now())`, []any{limit},
		func(row pgx.Row) error { return row.Scan(&anonymized) },
	)
	if err != nil {
		return 0, fmt.Errorf("retention/postgres: customer_anonymize_expired: %w", err)
	}
	return anonymized, nil
}
