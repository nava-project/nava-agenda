package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/database"
)

// LoginOTPRepository implementa shops.LoginOTPRepository sobre database.DB. Lee
// y escribe `business.login_otp_channel` (migración
// 20261103120000_add_login_otp_channel.sql) dentro de una transacción
// tenant-aware: RLS ya restringe la fila al negocio de la sesión y el filtro
// explícito `WHERE id = $1` es defensa en profundidad.
type LoginOTPRepository struct {
	db *database.DB
}

// NewLoginOTPRepository construye el repositorio.
func NewLoginOTPRepository(db *database.DB) *LoginOTPRepository {
	return &LoginOTPRepository{db: db}
}

var _ shops.LoginOTPRepository = (*LoginOTPRepository)(nil)

// Get implementa shops.LoginOTPRepository.
func (r *LoginOTPRepository) Get(ctx context.Context, businessID string) (shops.LoginOTPChannel, bool, error) {
	return r.run(ctx, businessID,
		`SELECT login_otp_channel FROM business WHERE id = $1`, businessID)
}

// Update implementa shops.LoginOTPRepository con un único UPDATE ... RETURNING.
func (r *LoginOTPRepository) Update(ctx context.Context, businessID string, channel shops.LoginOTPChannel) (shops.LoginOTPChannel, bool, error) {
	return r.run(ctx, businessID,
		`UPDATE business SET login_otp_channel = $2 WHERE id = $1 RETURNING login_otp_channel`,
		businessID, string(channel))
}

func (r *LoginOTPRepository) run(ctx context.Context, businessID, sql string, args ...any) (shops.LoginOTPChannel, bool, error) {
	var (
		value string
		found bool
	)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx, sql, args...).Scan(&value)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// found queda false: defensivo.
		default:
			return fmt.Errorf("login otp channel: %w", err)
		}
		return nil
	})
	if err != nil {
		return "", false, fmt.Errorf("shops/postgres: login otp channel: %w", err)
	}
	return shops.LoginOTPChannel(value), found, nil
}
