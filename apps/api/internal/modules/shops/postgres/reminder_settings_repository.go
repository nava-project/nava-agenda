package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/database"
)

// ReminderLeadHook mueve los recordatorios pendientes cuando cambia la
// anticipación del negocio (DEC-174), dentro de la misma transacción. shops no
// conoce la cola de avisos: la raíz de composición inyecta el encolador de
// appointmentnotice. Si devuelve un error, el cambio completo se revierte.
type ReminderLeadHook interface {
	ReminderLeadChanged(ctx context.Context, q database.Queries, businessID string) error
}

// ReminderSettingsRepository implementa shops.ReminderSettingsRepository sobre
// `business.reminder_lead_minutes` (migración
// 20261117120000_add_reminder_lead_minutes.sql), en una transacción
// tenant-aware: RLS ya restringe la fila y `WHERE id = $1` es defensa en
// profundidad.
type ReminderSettingsRepository struct {
	db   *database.DB
	hook ReminderLeadHook
}

// NewReminderSettingsRepository construye el repositorio. hook puede ser nil
// (pruebas sin cola): entonces solo se guarda la preferencia.
func NewReminderSettingsRepository(db *database.DB, hook ReminderLeadHook) *ReminderSettingsRepository {
	return &ReminderSettingsRepository{db: db, hook: hook}
}

var _ shops.ReminderSettingsRepository = (*ReminderSettingsRepository)(nil)

// Get implementa shops.ReminderSettingsRepository.
func (r *ReminderSettingsRepository) Get(ctx context.Context, businessID string) (shops.ReminderLeadMinutes, bool, error) {
	return r.run(ctx, businessID, false,
		`SELECT reminder_lead_minutes FROM business WHERE id = $1`, businessID)
}

// Update implementa shops.ReminderSettingsRepository.
func (r *ReminderSettingsRepository) Update(ctx context.Context, businessID string, lead shops.ReminderLeadMinutes) (shops.ReminderLeadMinutes, bool, error) {
	return r.run(ctx, businessID, true,
		`UPDATE business SET reminder_lead_minutes = $2 WHERE id = $1 RETURNING reminder_lead_minutes`,
		businessID, int(lead))
}

func (r *ReminderSettingsRepository) run(ctx context.Context, businessID string, write bool, sql string, args ...any) (shops.ReminderLeadMinutes, bool, error) {
	var (
		value int
		found bool
	)
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx, sql, args...).Scan(&value)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
			return nil
		default:
			return fmt.Errorf("reminder lead: %w", err)
		}
		if write && r.hook != nil {
			if err := r.hook.ReminderLeadChanged(ctx, q, businessID); err != nil {
				return fmt.Errorf("reminder lead: reprogramar pendientes: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return 0, false, fmt.Errorf("shops/postgres: reminder lead: %w", err)
	}
	return shops.ReminderLeadMinutes(value), found, nil
}
