// Package postgres implementa access.Repository sobre staff_user_role,
// barber.staff_user_id y appointment, siempre dentro del tenant de la sesión.
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"system-barbershop/internal/modules/access"
	"system-barbershop/internal/platform/database"
)

// Repository lee roles, vínculo con barbero y barbero de un turno.
type Repository struct {
	db *database.DB
}

// New construye el repositorio de acceso.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

var _ access.Repository = (*Repository)(nil)

// RolesAndBarber implementa access.Repository. Una sola transacción: los roles
// del usuario (solo lectura para la aplicación, DEC-134) y su barbero
// vinculado (DEC-100). RLS ya limita al tenant; el filtro por barbershop_id es
// defensa en profundidad.
func (r *Repository) RolesAndBarber(ctx context.Context, barbershopID, staffUserID string) ([]string, string, error) {
	var (
		roles    []string
		barberID string
	)
	err := r.db.InTenantTx(ctx, database.BarbershopID(barbershopID), func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx,
			`SELECT role FROM staff_user_role WHERE barbershop_id = $1 AND staff_user_id = $2`,
			barbershopID, staffUserID)
		if err != nil {
			return fmt.Errorf("select roles: %w", err)
		}
		for rows.Next() {
			var role string
			if err := rows.Scan(&role); err != nil {
				rows.Close()
				return fmt.Errorf("scan role: %w", err)
			}
			roles = append(roles, role)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("roles rows: %w", err)
		}
		err = q.QueryRow(ctx,
			`SELECT id::text FROM barber WHERE barbershop_id = $1 AND staff_user_id = $2`,
			barbershopID, staffUserID).Scan(&barberID)
		if errors.Is(err, pgx.ErrNoRows) {
			barberID = ""
			return nil
		}
		if err != nil {
			return fmt.Errorf("select linked barber: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, "", fmt.Errorf("access/postgres: roles and barber: %w", err)
	}
	return roles, barberID, nil
}

// AppointmentBarber implementa access.Repository. appointmentID ya tiene forma
// de UUID (lo comprueba el middleware antes de consultar).
func (r *Repository) AppointmentBarber(ctx context.Context, barbershopID, appointmentID string) (string, bool, error) {
	var barberID string
	found := false
	err := r.db.InTenantTx(ctx, database.BarbershopID(barbershopID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT barber_id::text FROM appointment WHERE barbershop_id = $1 AND id = $2`,
			barbershopID, appointmentID).Scan(&barberID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("select appointment barber: %w", err)
		}
		found = true
		return nil
	})
	if err != nil {
		return "", false, fmt.Errorf("access/postgres: appointment barber: %w", err)
	}
	return barberID, found, nil
}
