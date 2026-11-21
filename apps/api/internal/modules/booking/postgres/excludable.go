package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/database"
)

// ExcludableAppointment implementa booking.ExcludableAppointmentPort (#776):
// lee lo mínimo de un turno, dentro de la transacción del negocio (RLS), para
// excluirlo de la ocupación al reprogramarlo. Un id inexistente o de otro
// negocio da found=false, sin distinguir la causa (RN-TEN-01).
func (r *Repository) ExcludableAppointment(
	ctx context.Context,
	businessID, appointmentID string,
) (booking.ExcludableAppointment, bool, error) {
	shop, err := database.ValidBusinessID(businessID)
	if err != nil {
		return booking.ExcludableAppointment{}, false, fmt.Errorf("booking/postgres: %w", err)
	}

	var (
		own   booking.ExcludableAppointment
		found bool
	)
	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		var status string
		err := q.QueryRow(ctx, `
			SELECT a.professional_id, a.service_id, a.status, a.starts_at, a.ends_at,
			       a.duration_minutes_snapshot
			  FROM appointment a
			 WHERE a.business_id = $1 AND a.id = $2`,
			businessID, appointmentID,
		).Scan(&own.ProfessionalID, &own.ServiceID, &status, &own.StartsAt, &own.EndsAt, &own.DurationMinutesSnapshot)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		own.Status = booking.Status(status)
		found = true
		return nil
	})
	if err != nil {
		return booking.ExcludableAppointment{}, false, err
	}
	return own, found, nil
}
