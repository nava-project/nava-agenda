package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"system-barbershop/internal/modules/shops"
	"system-barbershop/internal/platform/database"
)

// BarberBookingPolicyRepository implementa shops.BarberBookingPolicyRepository
// sobre la tabla barber_booking_policy (DEC-169). Todas las operaciones corren
// en una transacción tenant-aware: RLS restringe las filas a la barbería
// vigente y los filtros explícitos por barbershop_id son defensa en
// profundidad.
type BarberBookingPolicyRepository struct {
	db *database.DB
}

// NewBarberBookingPolicyRepository construye el repositorio.
func NewBarberBookingPolicyRepository(db *database.DB) *BarberBookingPolicyRepository {
	return &BarberBookingPolicyRepository{db: db}
}

var _ shops.BarberBookingPolicyRepository = (*BarberBookingPolicyRepository)(nil)

// List implementa shops.BarberBookingPolicyRepository.List.
func (r *BarberBookingPolicyRepository) List(ctx context.Context, barbershopID string) ([]shops.BarberBookingPolicy, error) {
	policies := []shops.BarberBookingPolicy{}
	err := r.db.InTenantTx(ctx, database.BarbershopID(barbershopID), func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx,
			`SELECT professional_id::text, min_advance_minutes, max_advance_days, slot_grid_minutes, updated_at
			   FROM professional_booking_policy
			  WHERE business_id = $1
			  ORDER BY professional_id`,
			barbershopID,
		)
		if err != nil {
			return fmt.Errorf("select barber booking policies: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var p shops.BarberBookingPolicy
			if err := rows.Scan(&p.BarberID, &p.MinAdvanceMinutes, &p.MaxAdvanceDays, &p.SlotGridMinutes, &p.UpdatedAt); err != nil {
				return fmt.Errorf("scan barber booking policy: %w", err)
			}
			policies = append(policies, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("shops/postgres: list barber booking policies: %w", err)
	}
	return policies, nil
}

// Get implementa shops.BarberBookingPolicyRepository.Get.
func (r *BarberBookingPolicyRepository) Get(ctx context.Context, barbershopID, barberID string) (shops.BarberBookingPolicy, bool, error) {
	var (
		p     shops.BarberBookingPolicy
		found bool
	)
	err := r.db.InTenantTx(ctx, database.BarbershopID(barbershopID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT professional_id::text, min_advance_minutes, max_advance_days, slot_grid_minutes, updated_at
			   FROM professional_booking_policy
			  WHERE business_id = $1 AND professional_id = $2`,
			barbershopID, barberID,
		).Scan(&p.BarberID, &p.MinAdvanceMinutes, &p.MaxAdvanceDays, &p.SlotGridMinutes, &p.UpdatedAt)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// Hereda: found queda false.
		default:
			return fmt.Errorf("select barber booking policy: %w", err)
		}
		return nil
	})
	if err != nil {
		return shops.BarberBookingPolicy{}, false, fmt.Errorf("shops/postgres: get barber booking policy: %w", err)
	}
	return p, found, nil
}

// Upsert implementa shops.BarberBookingPolicyRepository.Upsert. El INSERT
// toma el barbero de un SELECT sobre `barber` del mismo tenant: si no existe
// (o pertenece a otra barbería, invisible por RLS) no se inserta nada y
// RETURNING no devuelve fila, sin provocar la violación de la FK que
// abortaría la transacción. La FK compuesta sigue siendo la última defensa.
func (r *BarberBookingPolicyRepository) Upsert(ctx context.Context, barbershopID, barberID string, input shops.BarberBookingPolicyInput) (shops.BarberBookingPolicy, bool, error) {
	var (
		p     shops.BarberBookingPolicy
		found bool
	)
	err := r.db.InTenantTx(ctx, database.BarbershopID(barbershopID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`INSERT INTO professional_booking_policy
			        (business_id, professional_id, min_advance_minutes, max_advance_days, slot_grid_minutes)
			 SELECT b.business_id, b.id, $3, $4, $5
			   FROM professional b
			  WHERE b.business_id = $1 AND b.id = $2
			 ON CONFLICT (business_id, professional_id) DO UPDATE
			    SET min_advance_minutes = EXCLUDED.min_advance_minutes,
			        max_advance_days    = EXCLUDED.max_advance_days,
			        slot_grid_minutes   = EXCLUDED.slot_grid_minutes
			 RETURNING professional_id::text, min_advance_minutes, max_advance_days, slot_grid_minutes, updated_at`,
			barbershopID, barberID, input.MinAdvanceMinutes, input.MaxAdvanceDays, input.SlotGridMinutes,
		).Scan(&p.BarberID, &p.MinAdvanceMinutes, &p.MaxAdvanceDays, &p.SlotGridMinutes, &p.UpdatedAt)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// Barbero inexistente en el tenant: cero escritura.
		default:
			return fmt.Errorf("upsert barber booking policy: %w", err)
		}
		return nil
	})
	if err != nil {
		return shops.BarberBookingPolicy{}, false, fmt.Errorf("shops/postgres: upsert barber booking policy: %w", err)
	}
	return p, found, nil
}

// Delete implementa shops.BarberBookingPolicyRepository.Delete (idempotente).
func (r *BarberBookingPolicyRepository) Delete(ctx context.Context, barbershopID, barberID string) error {
	err := r.db.InTenantTx(ctx, database.BarbershopID(barbershopID), func(ctx context.Context, q database.Queries) error {
		if _, err := q.Exec(ctx,
			`DELETE FROM professional_booking_policy WHERE business_id = $1 AND professional_id = $2`,
			barbershopID, barberID,
		); err != nil {
			return fmt.Errorf("delete barber booking policy: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("shops/postgres: delete barber booking policy: %w", err)
	}
	return nil
}
