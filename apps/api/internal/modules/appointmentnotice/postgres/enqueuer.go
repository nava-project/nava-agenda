// Package postgres implementa los dos lados de la cola de avisos al cliente
// (HU-130, DEC-142): el Enqueuer, que la API usa dentro de la transacción del
// cambio, y el WorkerRepository, que el worker usa solo mediante funciones
// SECURITY DEFINER (DEC-040).
package postgres

import (
	"context"
	"fmt"

	"system-barbershop/internal/platform/database"
)

// Enqueuer implementa booking/postgres.NoticeHook con UNA sentencia: persiste el
// aviso dentro de la misma transacción que el cambio del turno. booking no
// importa este paquete: la raíz de composición lo inyecta.
//
// Hay como máximo un aviso `pending` por turno (índice único parcial): un cambio
// nuevo lo reemplaza (la cancelación sustituye a una reprogramación pendiente) y
// reinicia la espera de 60 segundos, de modo que dos cambios seguidos dan un solo
// correo (RN-REC-01).
type Enqueuer struct{}

// NewEnqueuer construye el encolador.
func NewEnqueuer() Enqueuer { return Enqueuer{} }

// state_at es el updated_at que el turno tiene tras el cambio, en esta misma
// transacción: identifica qué estado cubre cada aviso.
const enqueueSQL = `
INSERT INTO appointment_notice (business_id, appointment_id, kind, state_at, run_at)
SELECT a.business_id, a.id, $3, a.updated_at, now() + interval '60 seconds'
  FROM appointment a
 WHERE a.business_id = $1 AND a.id = $2
ON CONFLICT (appointment_id, (CASE WHEN kind IN ('reminder', 'reminder_whatsapp') THEN kind ELSE 'change' END)) WHERE status = 'pending'
DO UPDATE SET kind = EXCLUDED.kind, state_at = EXCLUDED.state_at, run_at = EXCLUDED.run_at`

// La anticipación es la que eligió el negocio (`barbershop.reminder_lead_minutes`,
// DEC-174; 30 minutos por defecto, DEC-018), leída en esta misma transacción.
//
// El recordatorio guarda como state_at el instante del turno: si el turno cambia
// de hora, el recordatorio viejo ya no coincide y el worker lo descarta al enviar
// (RN-REC-01, RN-REC-03). No se programa si falta menos que la anticipación para
// el turno: no habría nada que recordar con antelación (un turno tomado "para ya").
// Un turno no confirmado no se programa. El índice único admite un recordatorio
// pendiente por turno: reprogramar lo actualiza (regenera) en vez de duplicarlo.
//
// Hay un recordatorio por canal (DEC-175): `reminder` (correo) siempre, y
// `reminder_whatsapp` solo si el cliente tiene teléfono. Cada uno tiene su fila,
// su intento y su causa de omisión; el worker vuelve a mirar el contacto al
// enviar.
const reminderSQL = `
INSERT INTO appointment_notice (business_id, appointment_id, kind, state_at, run_at)
SELECT a.business_id, a.id, k.kind, a.starts_at,
       a.starts_at - make_interval(mins => b.reminder_lead_minutes)
  FROM appointment a
  JOIN business b ON b.id = a.business_id
  JOIN customer cu ON cu.business_id = a.business_id AND cu.id = a.customer_id
 CROSS JOIN (VALUES ('reminder'), ('reminder_whatsapp')) AS k(kind)
 WHERE a.business_id = $1 AND a.id = $2
   AND a.status = 'confirmed'
   AND a.starts_at - make_interval(mins => b.reminder_lead_minutes) > now()
   AND (k.kind = 'reminder' OR cu.phone IS NOT NULL)
ON CONFLICT (appointment_id, (CASE WHEN kind IN ('reminder', 'reminder_whatsapp') THEN kind ELSE 'change' END)) WHERE status = 'pending'
DO UPDATE SET state_at = EXCLUDED.state_at, run_at = EXCLUDED.run_at`

// Al cambiar la anticipación (DEC-174) se mueven los recordatorios pendientes
// que siguen vigentes (cubren el inicio actual del turno) a la nueva hora. Uno
// cuya nueva hora ya pasó se deja como estaba: moverlo al pasado lo enviaría de
// inmediato, y quitarlo dejaría sin recordatorio un turno que ya lo tenía.
const reminderLeadChangedSQL = `
UPDATE appointment_notice n
   SET run_at = a.starts_at - make_interval(mins => b.reminder_lead_minutes)
  FROM appointment a, business b
 WHERE n.business_id = $1 AND n.kind IN ('reminder', 'reminder_whatsapp') AND n.status = 'pending'
   AND a.business_id = n.business_id AND a.id = n.appointment_id
   AND b.id = n.business_id
   AND n.state_at = a.starts_at
   AND a.starts_at - make_interval(mins => b.reminder_lead_minutes) > now()`

// ReminderLeadChanged implementa shops/postgres.ReminderLeadHook.
func (Enqueuer) ReminderLeadChanged(ctx context.Context, q database.Queries, barbershopID string) error {
	if _, err := q.Exec(ctx, reminderLeadChangedSQL, barbershopID); err != nil {
		return fmt.Errorf("appointmentnotice/postgres: reschedule reminders: %w", err)
	}
	return nil
}

// AppointmentReminderRequired implementa booking/postgres.NoticeHook.
func (Enqueuer) AppointmentReminderRequired(ctx context.Context, q database.Queries, barbershopID, appointmentID string) error {
	if _, err := q.Exec(ctx, reminderSQL, barbershopID, appointmentID); err != nil {
		return fmt.Errorf("appointmentnotice/postgres: enqueue reminder: %w", err)
	}
	return nil
}

// AppointmentNoticeRequired implementa booking/postgres.NoticeHook.
func (Enqueuer) AppointmentNoticeRequired(ctx context.Context, q database.Queries, barbershopID, appointmentID, kind string) error {
	if _, err := q.Exec(ctx, enqueueSQL, barbershopID, appointmentID, kind); err != nil {
		return fmt.Errorf("appointmentnotice/postgres: enqueue: %w", err)
	}
	return nil
}
