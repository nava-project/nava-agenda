package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/database"
)

// ProfessionalBookingPolicyRepository implementa shops.ProfessionalBookingPolicyRepository
// sobre la tabla professional_booking_policy (DEC-169). Todas las operaciones corren
// en una transacción tenant-aware: RLS restringe las filas al negocio
// vigente y los filtros explícitos por business_id son defensa en
// profundidad.
type ProfessionalBookingPolicyRepository struct {
	db *database.DB
}

// NewProfessionalBookingPolicyRepository construye el repositorio.
func NewProfessionalBookingPolicyRepository(db *database.DB) *ProfessionalBookingPolicyRepository {
	return &ProfessionalBookingPolicyRepository{db: db}
}

var _ shops.ProfessionalBookingPolicyRepository = (*ProfessionalBookingPolicyRepository)(nil)

// List implementa shops.ProfessionalBookingPolicyRepository.List.
func (r *ProfessionalBookingPolicyRepository) List(ctx context.Context, businessID string) ([]shops.ProfessionalBookingPolicy, error) {
	policies := []shops.ProfessionalBookingPolicy{}
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		rows, err := q.Query(ctx,
			`SELECT professional_id::text, min_advance_minutes, max_advance_days, slot_grid_minutes, updated_at
			   FROM professional_booking_policy
			  WHERE business_id = $1
			  ORDER BY professional_id`,
			businessID,
		)
		if err != nil {
			return fmt.Errorf("select professional booking policies: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var p shops.ProfessionalBookingPolicy
			if err := rows.Scan(&p.ProfessionalID, &p.MinAdvanceMinutes, &p.MaxAdvanceDays, &p.SlotGridMinutes, &p.UpdatedAt); err != nil {
				return fmt.Errorf("scan professional booking policy: %w", err)
			}
			policies = append(policies, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("shops/postgres: list professional booking policies: %w", err)
	}
	return policies, nil
}

// Get implementa shops.ProfessionalBookingPolicyRepository.Get.
func (r *ProfessionalBookingPolicyRepository) Get(ctx context.Context, businessID, professionalID string) (shops.ProfessionalBookingPolicy, bool, error) {
	var (
		p     shops.ProfessionalBookingPolicy
		found bool
	)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`SELECT professional_id::text, min_advance_minutes, max_advance_days, slot_grid_minutes, updated_at
			   FROM professional_booking_policy
			  WHERE business_id = $1 AND professional_id = $2`,
			businessID, professionalID,
		).Scan(&p.ProfessionalID, &p.MinAdvanceMinutes, &p.MaxAdvanceDays, &p.SlotGridMinutes, &p.UpdatedAt)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// Hereda: found queda false.
		default:
			return fmt.Errorf("select professional booking policy: %w", err)
		}
		return nil
	})
	if err != nil {
		return shops.ProfessionalBookingPolicy{}, false, fmt.Errorf("shops/postgres: get professional booking policy: %w", err)
	}
	return p, found, nil
}

// Upsert implementa shops.ProfessionalBookingPolicyRepository.Upsert. El INSERT
// toma el profesional de un SELECT sobre `professional` del mismo tenant: si no existe
// (o pertenece a otro negocio, invisible por RLS) no se inserta nada y
// RETURNING no devuelve fila, sin provocar la violación de la FK que
// abortaría la transacción. La FK compuesta sigue siendo la última defensa.
func (r *ProfessionalBookingPolicyRepository) Upsert(ctx context.Context, businessID, professionalID string, input shops.ProfessionalBookingPolicyInput) (shops.ProfessionalBookingPolicy, bool, error) {
	var (
		p     shops.ProfessionalBookingPolicy
		found bool
	)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
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
			businessID, professionalID, input.MinAdvanceMinutes, input.MaxAdvanceDays, input.SlotGridMinutes,
		).Scan(&p.ProfessionalID, &p.MinAdvanceMinutes, &p.MaxAdvanceDays, &p.SlotGridMinutes, &p.UpdatedAt)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			// Profesional inexistente en el tenant: cero escritura.
		default:
			return fmt.Errorf("upsert professional booking policy: %w", err)
		}
		return nil
	})
	if err != nil {
		return shops.ProfessionalBookingPolicy{}, false, fmt.Errorf("shops/postgres: upsert professional booking policy: %w", err)
	}
	return p, found, nil
}

// Delete implementa shops.ProfessionalBookingPolicyRepository.Delete (idempotente).
func (r *ProfessionalBookingPolicyRepository) Delete(ctx context.Context, businessID, professionalID string) error {
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		if _, err := q.Exec(ctx,
			`DELETE FROM professional_booking_policy WHERE business_id = $1 AND professional_id = $2`,
			businessID, professionalID,
		); err != nil {
			return fmt.Errorf("delete professional booking policy: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("shops/postgres: delete professional booking policy: %w", err)
	}
	return nil
}
