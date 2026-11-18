package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/database"
)

// OpeningHoursRepository implementa shops.OpeningHoursRepository sobre
// `business_opening_hour` y `business.closed_on_holidays` (migración
// 20261120090000_create_barbershop_opening_hour.sql, HU-107), siempre en una
// transacción tenant-aware: RLS restringe las filas y los `WHERE business_id`
// son defensa en profundidad.
type OpeningHoursRepository struct {
	db *database.DB
}

// NewOpeningHoursRepository construye el repositorio.
func NewOpeningHoursRepository(db *database.DB) *OpeningHoursRepository {
	return &OpeningHoursRepository{db: db}
}

var _ shops.OpeningHoursRepository = (*OpeningHoursRepository)(nil)

// Get implementa shops.OpeningHoursRepository.
func (r *OpeningHoursRepository) Get(ctx context.Context, businessID string) (shops.OpeningHours, bool, error) {
	var (
		hours shops.OpeningHours
		found bool
	)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		var err error
		hours, found, err = readOpeningHours(ctx, q, businessID)
		return err
	})
	if err != nil {
		return shops.OpeningHours{}, false, fmt.Errorf("shops/postgres: leer horario del local: %w", err)
	}
	return hours, found, nil
}

// Replace implementa shops.OpeningHoursRepository: borra la semana y escribe la
// nueva en la misma transacción, y devuelve lo que quedó leído de la base.
func (r *OpeningHoursRepository) Replace(ctx context.Context, businessID string, hours shops.OpeningHours) (shops.OpeningHours, bool, error) {
	var (
		stored shops.OpeningHours
		found  bool
	)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		tag, err := q.Exec(ctx,
			`UPDATE business SET closed_on_holidays = $2 WHERE id = $1`, businessID, hours.ClosedOnHolidays)
		if err != nil {
			return fmt.Errorf("closed_on_holidays: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil // found queda false: negocio no visible en este tenant
		}
		if _, err := q.Exec(ctx,
			`DELETE FROM business_opening_hour WHERE business_id = $1`, businessID); err != nil {
			return fmt.Errorf("borrar horario anterior: %w", err)
		}
		for _, seg := range hours.Segments {
			// La hora viaja como texto `HH:MM` porque `24:00` es un `time` válido
			// en PostgreSQL pero un intervalo de 1440 minutos daría 00:00.
			if _, err := q.Exec(ctx,
				`INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
				 VALUES ($1, $2, $3::time, $4::time)`,
				businessID, int(seg.Weekday), seg.Opens.String(), seg.Closes.String()); err != nil {
				return fmt.Errorf("insertar tramo %s %s–%s: %w", seg.Weekday, seg.Opens, seg.Closes, err)
			}
		}
		stored, found, err = readOpeningHours(ctx, q, businessID)
		return err
	})
	if err != nil {
		return shops.OpeningHours{}, false, fmt.Errorf("shops/postgres: guardar horario del local: %w", err)
	}
	return stored, found, nil
}

func readOpeningHours(ctx context.Context, q database.Queries, businessID string) (shops.OpeningHours, bool, error) {
	var hours shops.OpeningHours
	err := q.QueryRow(ctx,
		`SELECT closed_on_holidays FROM business WHERE id = $1`, businessID,
	).Scan(&hours.ClosedOnHolidays)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return shops.OpeningHours{}, false, nil
	case err != nil:
		return shops.OpeningHours{}, false, fmt.Errorf("closed_on_holidays: %w", err)
	}

	// EXTRACT(EPOCH) de un `time` son segundos desde medianoche: 24:00 da 86400.
	rows, err := q.Query(ctx,
		`SELECT iso_weekday,
		        (EXTRACT(EPOCH FROM opens_time)  / 60)::int,
		        (EXTRACT(EPOCH FROM closes_time) / 60)::int
		   FROM business_opening_hour
		  WHERE business_id = $1
		  ORDER BY iso_weekday, opens_time`, businessID)
	if err != nil {
		return shops.OpeningHours{}, false, fmt.Errorf("tramos: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var weekday, opens, closes int
		if err := rows.Scan(&weekday, &opens, &closes); err != nil {
			return shops.OpeningHours{}, false, fmt.Errorf("leer tramo: %w", err)
		}
		hours.Segments = append(hours.Segments, shops.OpeningSegment{
			Weekday: shops.Weekday(weekday), Opens: shops.ClockMinutes(opens), Closes: shops.ClockMinutes(closes),
		})
	}
	if err := rows.Err(); err != nil {
		return shops.OpeningHours{}, false, fmt.Errorf("recorrer tramos: %w", err)
	}
	return hours, true, nil
}
