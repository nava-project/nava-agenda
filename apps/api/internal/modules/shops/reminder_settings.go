package shops

import (
	"context"
	"fmt"

	"system-barbershop/internal/platform/apperr"
)

// ReminderLeadMinutes es con cuántos minutos de anticipación sale el
// recordatorio al cliente (HU-131, DEC-174). Los valores son los del CHECK
// `barbershop_reminder_lead_minutes_ck`: de 10 en 10, sin pasar de 60.
type ReminderLeadMinutes int

// DefaultReminderLeadMinutes es la anticipación inicial (DEC-018).
const DefaultReminderLeadMinutes ReminderLeadMinutes = 30

// ReminderLeadOptions es la lista cerrada que ofrece Configuración.
var ReminderLeadOptions = []ReminderLeadMinutes{10, 20, 30, 40, 50, 60}

// Valid informa si m es una de las opciones admitidas.
func (m ReminderLeadMinutes) Valid() bool {
	for _, option := range ReminderLeadOptions {
		if m == option {
			return true
		}
	}
	return false
}

// ReminderSettingsRepository es el puerto de persistencia de la anticipación
// del recordatorio. El núcleo no importa internal/platform/database ni pgx.
type ReminderSettingsRepository interface {
	// Get lee la anticipación de barbershopID en una transacción tenant-aware.
	// found=false cubre una fila no visible en el tenant vigente (defensivo).
	Get(ctx context.Context, barbershopID string) (lead ReminderLeadMinutes, found bool, err error)
	// Update guarda la anticipación y, en la MISMA transacción, mueve los
	// recordatorios pendientes de turnos futuros a la nueva hora. Sin versión de
	// concurrencia: es una preferencia del negocio y la última escritura gana.
	Update(ctx context.Context, barbershopID string, lead ReminderLeadMinutes) (stored ReminderLeadMinutes, found bool, err error)
}

// ReminderSettingsService lee y cambia la anticipación del recordatorio del
// negocio de la sesión (DEC-174). El negocio llega siempre de un
// auth.Principal: no hay forma de leer o cambiar el de otro (RN-TEN-01).
type ReminderSettingsService struct {
	repo ReminderSettingsRepository
}

// NewReminderSettingsService construye el servicio.
func NewReminderSettingsService(repo ReminderSettingsRepository) *ReminderSettingsService {
	return &ReminderSettingsService{repo: repo}
}

// Get lee la anticipación vigente.
func (s *ReminderSettingsService) Get(ctx context.Context, barbershopID string) (ReminderLeadMinutes, error) {
	if err := ctx.Err(); err != nil {
		return 0, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de leer la anticipación del recordatorio: %w", err))
	}
	lead, found, err := s.repo.Get(ctx, barbershopID)
	if err != nil {
		return 0, apperr.Internal(fmt.Errorf("shops: leer anticipación del recordatorio: %w", err))
	}
	if !found {
		return 0, apperr.NotFound("barbería no encontrada")
	}
	return lead, nil
}

// Update valida la anticipación y la guarda. Un valor fuera de la lista se
// rechaza con 422 sin tocar la base de datos.
func (s *ReminderSettingsService) Update(ctx context.Context, barbershopID string, lead ReminderLeadMinutes) (ReminderLeadMinutes, error) {
	if err := ctx.Err(); err != nil {
		return 0, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de actualizar la anticipación del recordatorio: %w", err))
	}
	if !lead.Valid() {
		return 0, apperr.Validation("leadMinutes debe ser 10, 20, 30, 40, 50 o 60")
	}
	stored, found, err := s.repo.Update(ctx, barbershopID, lead)
	if err != nil {
		return 0, apperr.Internal(fmt.Errorf("shops: actualizar anticipación del recordatorio: %w", err))
	}
	if !found {
		return 0, apperr.NotFound("barbería no encontrada")
	}
	return stored, nil
}
