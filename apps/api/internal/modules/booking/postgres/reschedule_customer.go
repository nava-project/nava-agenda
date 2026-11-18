package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/idempotency"
)

// rescheduleAppointmentByCustomerOperation separa, para el protocolo de
// idempotencia (RN-IDE-01, DEC-043), la T2 del cliente (HU-104) de la del
// profesional: una clave usada para una no se reutiliza en la otra.
const rescheduleAppointmentByCustomerOperation idempotency.Operation = "reschedule_appointment_by_customer"

// rescheduleAppointmentByCustomerIdempotencyTTL usa la misma vigencia que la
// T2 del profesional; ninguna razón de negocio pide otra.
const rescheduleAppointmentByCustomerIdempotencyTTL = 10 * time.Minute

// customerRescheduleResponseWire es el cuerpo 200 de la reprogramación del
// cliente: solo el intervalo nuevo, sin identificadores internos (CA-098-03).
// El cliente vuelve a leer el turno con GET para lo demás.
type customerRescheduleResponseWire struct {
	StartsAt time.Time `json:"startsAt"`
	EndsAt   time.Time `json:"endsAt"`
}

// countCustomerReschedules cuenta las reprogramaciones que hizo el propio
// cliente sobre el turno (DEC-178, punto 3). Las del profesional (actor `staff`)
// no cuentan.
func countCustomerReschedules(ctx context.Context, q database.Queries, businessID, appointmentID string) (int, error) {
	var count int
	err := q.QueryRow(ctx, `
		SELECT count(*)
		  FROM appointment_history
		 WHERE business_id = $1
		   AND appointment_id = $2
		   AND event_type = 'appointment_rescheduled'
		   AND actor_type = 'customer'`,
		businessID, appointmentID,
	).Scan(&count)
	return count, err
}

// CustomerRescheduleState implementa la lectura previa de HU-104: sin
// bloqueo, solo para responder pronto y pedir las franjas.
func (r *Repository) CustomerRescheduleState(ctx context.Context, businessID, appointmentID string) (booking.CustomerRescheduleState, bool, error) {
	shop, err := database.ValidBusinessID(businessID)
	if err != nil {
		return booking.CustomerRescheduleState{}, false, fmt.Errorf("booking/postgres: %w", err)
	}

	var (
		state booking.CustomerRescheduleState
		found bool
	)
	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		var status string
		err := q.QueryRow(ctx, `
			SELECT a.professional_id, a.duration_minutes_snapshot, a.starts_at, a.ends_at, a.status,
			       b.cancellation_deadline_minutes
			  FROM appointment a
			  JOIN business b ON b.id = a.business_id
			 WHERE a.business_id = $1 AND a.id = $2`,
			businessID, appointmentID,
		).Scan(&state.ProfessionalID, &state.DurationMinutes, &state.StartsAt, &state.EndsAt, &status, &state.DeadlineMinutes)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		state.Status = booking.Status(status)
		state.CustomerReschedules, err = countCustomerReschedules(ctx, q, businessID, appointmentID)
		if err != nil {
			return err
		}
		found = true
		return nil
	})
	if err != nil {
		return booking.CustomerRescheduleState{}, false, err
	}
	return state, found, nil
}

// RescheduleByCustomer implementa booking.CustomerRescheduleRepository
// (HU-104, DEC-178) con la estructura de Reschedule (HU-065): Begin, bloquear
// la fila, verificar con la fila bloqueada, aplicar y Complete en una sola
// InTenantTx. Diferencias con la del profesional:
//   - el plazo y el límite se vuelven a evaluar aquí, con la fila bloqueada,
//     así que dos peticiones simultáneas no pueden pasar ambas el límite;
//   - el historial lleva actor `customer` (el dueño del turno, RN-HIS-01);
//   - no se encola aviso al cliente (DEC-142: lo hizo él), pero sí el
//     recordatorio nuevo y la publicación en Google.
//
// Un rechazo revierte la transacción completa, incluida la reclamación de
// idempotencia.
func (r *Repository) RescheduleByCustomer(
	ctx context.Context,
	businessID string,
	input booking.RescheduleAppointmentByCustomerInput,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (booking.RescheduleByCustomerResult, error) {
	shop, err := database.ValidBusinessID(businessID)
	if err != nil {
		return booking.RescheduleByCustomerResult{}, fmt.Errorf("booking/postgres: %w", err)
	}

	var result booking.RescheduleByCustomerResult

	err = r.db.InTenantTx(ctx, shop, func(ctx context.Context, q database.Queries) error {
		decision, err := r.coord.Begin(ctx, q, shop, key, rescheduleAppointmentByCustomerOperation, fingerprint, rescheduleAppointmentByCustomerIdempotencyTTL)
		if err != nil {
			return fmt.Errorf("idempotency begin: %w", err)
		}
		result.Decision = decision
		if decision.Outcome != idempotency.OutcomeProceed {
			if decision.Outcome == idempotency.OutcomeReplay {
				result.Response = decision.Response
			}
			return nil
		}

		current, found, err := lockAppointmentForReschedule(ctx, q, businessID, input.AppointmentID)
		if err != nil {
			return err
		}
		if !found {
			return errAppointmentNotFound()
		}
		if current.status != string(booking.StatusConfirmed) {
			return errAppointmentNotConfirmed()
		}
		if booking.EncodeVersionToken(current.id, current.updatedAt) != input.ExpectedVersionToken {
			return errVersionConflict()
		}

		policy, err := readCancellationPolicy(ctx, q, businessID)
		if err != nil {
			return fmt.Errorf("read cancellation policy: %w", err)
		}
		if err := (booking.CustomerReschedulePolicy{DeadlineMinutes: policy.DeadlineMinutes}).Evaluate(current.startsAt, input.Now); err != nil {
			return err
		}
		done, err := countCustomerReschedules(ctx, q, businessID, current.id)
		if err != nil {
			return fmt.Errorf("count customer reschedules: %w", err)
		}
		if err := booking.EvaluateCustomerRescheduleCount(done); err != nil {
			return err
		}

		if !current.startsAt.Equal(input.NewStartsAt) || !current.endsAt.Equal(input.NewEndsAt) {
			if _, err := updateAppointmentInterval(ctx, q, businessID, current.id, input.NewStartsAt, input.NewEndsAt); err != nil {
				// El cruce en carrera se presenta al cliente como la franja que
				// dejó de estar disponible (slot-conflict), igual que en la
				// reserva pública: su interfaz vuelve a pedir las franjas.
				if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindConflict {
					return apperr.ScheduleConflict("ese horario ya no está disponible; elige otro")
				}
				return err
			}
			if err := r.appointmentChanged(ctx, q, businessID, current.id); err != nil {
				return err
			}
			if err := r.reminderRequired(ctx, q, businessID, current.id); err != nil {
				return err
			}
			customerID := current.customerID
			if err := insertAppointmentRescheduledHistory(
				ctx, q, businessID, current.id,
				booking.Actor{Type: booking.ActorTypeCustomer, CustomerID: &customerID},
				current.startsAt, current.endsAt, input.NewStartsAt, input.NewEndsAt,
			); err != nil {
				return err
			}
			current.startsAt = input.NewStartsAt
			current.endsAt = input.NewEndsAt
		}

		body, err := json.Marshal(customerRescheduleResponseWire{StartsAt: current.startsAt.UTC(), EndsAt: current.endsAt.UTC()})
		if err != nil {
			return fmt.Errorf("marshal customer reschedule: %w", err)
		}
		stored := idempotency.StoredResponse{Status: 200, ContentType: "application/json", Body: string(body)}

		ok, err := r.coord.Complete(ctx, q, shop, key, stored)
		if err != nil {
			return fmt.Errorf("idempotency complete: %w", err)
		}
		if !ok {
			return fmt.Errorf("idempotency complete: la reclamación ya no estaba in_progress")
		}
		result.Response = stored
		return nil
	})
	if err != nil {
		return booking.RescheduleByCustomerResult{}, err
	}
	return result, nil
}
