// Package postgres implementa access.Repository sobre staff_user_role,
// professional.staff_user_id y appointment, siempre dentro del tenant de la sesión.
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/access"
	"nava-agenda/internal/platform/database"
)

// Repository lee roles, vínculo con profesional y profesional de un turno.
type Repository struct {
	db *database.DB
}

// New construye el repositorio de acceso.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

var _ access.Repository = (*Repository)(nil)

// RolesAndProfessional implementa access.Repository. Una sola transacción: los roles
// del usuario (solo lectura para la aplicación, DEC-134) y su profesional
// vinculado (DEC-100). RLS ya limita al tenant; el filtro por business_id es
// defensa en profundidad.
func (r *Repository) RolesAndProfessional(ctx context.Context, businessID, staffUserID string) ([]string, string, error) {
	var (
		roles          []string
		professionalID string
	)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx,
			`SELECT role FROM staff_user_role WHERE business_id = $1 AND staff_user_id = $2`,
			businessID, staffUserID)
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
			`SELECT id::text FROM professional WHERE business_id = $1 AND staff_user_id = $2`,
			businessID, staffUserID).Scan(&professionalID)
		if errors.Is(err, pgx.ErrNoRows) {
			professionalID = ""
			return nil
		}
		if err != nil {
			return fmt.Errorf("select linked professional: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, "", fmt.Errorf("access/postgres: roles and professional: %w", err)
	}
	return roles, professionalID, nil
}

// AppointmentProfessional implementa access.Repository. appointmentID ya tiene forma
// de UUID (lo comprueba el middleware antes de consultar).
func (r *Repository) AppointmentProfessional(ctx context.Context, businessID, appointmentID string) (string, bool, error) {
	var professionalID string
	found := false
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT professional_id::text FROM appointment WHERE business_id = $1 AND id = $2`,
			businessID, appointmentID).Scan(&professionalID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("select appointment professional: %w", err)
		}
		found = true
		return nil
	})
	if err != nil {
		return "", false, fmt.Errorf("access/postgres: appointment professional: %w", err)
	}
	return professionalID, found, nil
}
