// Pruebas de integración de HU-104 (T2 del cliente, DEC-178) contra PostgreSQL
// REAL con dos negocios (shopQ y shopR), con los mismos fixtures que
// cancel_customer_repository_test.go. El reloj llega por
// RescheduleAppointmentByCustomerInput.Now para fijar el plazo sin dormir.
package postgres_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	bookingpostgres "nava-agenda/internal/modules/booking/postgres"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/idempotency"
)

type customerRescheduleFixture struct {
	db          *database.DB
	repo        *bookingpostgres.Repository
	notices     *recordingNoticeHook
	sync        *recordingHook
	suffix      string
	start       time.Time
	appointment string
	customerID  string
}

// newCustomerRescheduleFixture crea una cita futura de 30 minutos en shopQ con
// los ganchos de aviso y de Google grabando, y deja el plazo de shopQ en 20
// minutos.
func newCustomerRescheduleFixture(t *testing.T) customerRescheduleFixture {
	t.Helper()
	db := setupTestDB(t)
	notices := &recordingNoticeHook{}
	syncHook := &recordingHook{}
	repo := newRepository(db).WithNoticeHook(notices).WithSyncHook(syncHook)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	f := customerRescheduleFixture{
		db: db, repo: repo, notices: notices, sync: syncHook, suffix: suffix, start: start,
		appointment: created.Appointment.ID, customerID: created.Appointment.CustomerID,
	}
	f.setDeadline(t, shopQ, 20)
	return f
}

func (f customerRescheduleFixture) setDeadline(t *testing.T, shop database.BusinessID, minutes int) {
	t.Helper()
	err := f.db.InTenantTx(context.Background(), shop, func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx, `UPDATE business SET cancellation_deadline_minutes = $2 WHERE id = $1`, shop, minutes)
		return err
	})
	if err != nil {
		t.Fatalf("setDeadline: %v", err)
	}
}

func (f customerRescheduleFixture) version(t *testing.T) string {
	t.Helper()
	detail, found, err := f.repo.GetAppointmentDetail(context.Background(), string(shopQ), f.appointment)
	if err != nil || !found {
		t.Fatalf("GetAppointmentDetail: found=%v err=%v", found, err)
	}
	return detail.VersionToken
}

func (f customerRescheduleFixture) input(t *testing.T, newStart, now time.Time) booking.RescheduleAppointmentByCustomerInput {
	return booking.RescheduleAppointmentByCustomerInput{
		AppointmentID:        f.appointment,
		NewStartsAt:          newStart,
		NewEndsAt:            newStart.Add(30 * time.Minute),
		ExpectedVersionToken: f.version(t),
		Now:                  now,
	}
}

func (f customerRescheduleFixture) reschedule(t *testing.T, shop database.BusinessID, in booking.RescheduleAppointmentByCustomerInput, key string) (booking.RescheduleByCustomerResult, error) {
	t.Helper()
	return f.repo.RescheduleByCustomer(context.Background(), string(shop), in,
		idempotency.Key("cresched-"+key+"-"+f.suffix), rescheduleFingerprint("cresched-"+key+"-"+f.suffix))
}

type customerRescheduleRow struct {
	startsAt, endsAt time.Time
	customerEvents   int
	staffEvents      int
	actorCustomerOK  bool
}

func (f customerRescheduleFixture) row(t *testing.T) customerRescheduleRow {
	t.Helper()
	var r customerRescheduleRow
	err := f.db.InTenantTx(context.Background(), shopQ, func(ctx context.Context, q database.Queries) error {
		if err := q.QueryRow(ctx, `SELECT starts_at, ends_at FROM appointment WHERE business_id = $1 AND id = $2`,
			shopQ, f.appointment).Scan(&r.startsAt, &r.endsAt); err != nil {
			return err
		}
		if err := q.QueryRow(ctx, `
			SELECT count(*) FILTER (WHERE actor_type = 'customer'),
			       count(*) FILTER (WHERE actor_type = 'staff'),
			       coalesce(bool_and(actor_customer_id = $3) FILTER (WHERE actor_type = 'customer'), true)
			  FROM appointment_history
			 WHERE business_id = $1 AND appointment_id = $2 AND event_type = 'appointment_rescheduled'`,
			shopQ, f.appointment, f.customerID).Scan(&r.customerEvents, &r.staffEvents, &r.actorCustomerOK); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatalf("row: %v", err)
	}
	return r
}

// CA-104-03: mueve el intervalo, historial con actor cliente (el dueño del
// turno), recordatorio regenerado, Google encolado y NINGÚN aviso al cliente.
func TestRescheduleByCustomer_WithinDeadline_MovesWithCustomerActorAndNoNotice(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	newStart := f.start.Add(2 * time.Hour)
	remindersBefore := len(f.notices.reminderSnapshot())
	f.sync.mu.Lock()
	syncBefore := len(f.sync.calls)
	f.sync.mu.Unlock()

	result, err := f.reschedule(t, shopQ, f.input(t, newStart, f.start.Add(-time.Hour)), "ok")
	if err != nil {
		t.Fatalf("RescheduleByCustomer: %v", err)
	}
	if result.Decision.Outcome != idempotency.OutcomeProceed || result.Response.Status != 200 {
		t.Fatalf("result = %+v", result)
	}
	want := `{"startsAt":"` + newStart.UTC().Format(time.RFC3339) + `","endsAt":"` + newStart.Add(30*time.Minute).UTC().Format(time.RFC3339) + `"}`
	if result.Response.Body != want {
		t.Fatalf("body = %s, quiero %s", result.Response.Body, want)
	}
	r := f.row(t)
	if !r.startsAt.Equal(newStart) || !r.endsAt.Equal(newStart.Add(30*time.Minute)) {
		t.Fatalf("intervalo = [%v,%v)", r.startsAt, r.endsAt)
	}
	if r.customerEvents != 1 || r.staffEvents != 0 || !r.actorCustomerOK {
		t.Fatalf("historial = %+v", r)
	}
	if got := f.notices.snapshot(); len(got) != 0 {
		t.Fatalf("el cliente no recibe aviso de su propio cambio (DEC-142): %v", got)
	}
	if got := f.notices.reminderSnapshot(); len(got) != remindersBefore+1 {
		t.Fatalf("el recordatorio se regenera una vez: %v", got)
	}
	f.sync.mu.Lock()
	syncCalls := len(f.sync.calls)
	f.sync.mu.Unlock()
	if syncCalls != syncBefore+1 {
		t.Fatalf("la publicación en Google se encola una vez al mover: %d llamadas, antes %d", syncCalls, syncBefore)
	}
}

// RN-IDE-01: la misma clave y el mismo cuerpo reproducen la respuesta sin
// volver a escribir.
func TestRescheduleByCustomer_Replay_DoesNotWriteTwice(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	in := f.input(t, f.start.Add(2*time.Hour), f.start.Add(-time.Hour))

	first, err := f.reschedule(t, shopQ, in, "replay")
	if err != nil {
		t.Fatalf("primera: %v", err)
	}
	second, err := f.reschedule(t, shopQ, in, "replay")
	if err != nil {
		t.Fatalf("repetición: %v", err)
	}
	if second.Decision.Outcome != idempotency.OutcomeReplay || second.Response.Body != first.Response.Body {
		t.Fatalf("repetición = %+v", second)
	}
	if r := f.row(t); r.customerEvents != 1 {
		t.Fatalf("la repetición no agrega historial: %+v", r)
	}
}

// Un intervalo idéntico es un no-op: ni historial, ni recordatorio, ni Google.
func TestRescheduleByCustomer_SameInterval_IsNoOp(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	remindersBefore := len(f.notices.reminderSnapshot())

	if _, err := f.reschedule(t, shopQ, f.input(t, f.start, f.start.Add(-time.Hour)), "same"); err != nil {
		t.Fatalf("RescheduleByCustomer: %v", err)
	}
	if r := f.row(t); r.customerEvents != 0 {
		t.Fatalf("un no-op no escribe historial: %+v", r)
	}
	if got := f.notices.reminderSnapshot(); len(got) != remindersBefore {
		t.Fatalf("un no-op no regenera el recordatorio: %v", got)
	}
}

// CA-104-05: el plazo es el de la cancelación, inclusive, y con plazo 0 nunca.
func TestRescheduleByCustomer_Deadline(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	limit := f.start.Add(-20 * time.Minute)

	_, err := f.reschedule(t, shopQ, f.input(t, f.start.Add(2*time.Hour), limit.Add(time.Second)), "late")
	assertAppKind(t, err, apperr.KindRescheduleWindowClosed)
	if r := f.row(t); !r.startsAt.Equal(f.start) || r.customerEvents != 0 {
		t.Fatalf("un rechazo no toca nada: %+v", r)
	}

	f.setDeadline(t, shopQ, 0)
	_, err = f.reschedule(t, shopQ, f.input(t, f.start.Add(2*time.Hour), f.start.Add(-48*time.Hour)), "zero")
	assertAppKind(t, err, apperr.KindRescheduleWindowClosed)

	f.setDeadline(t, shopQ, 20)
	if _, err := f.reschedule(t, shopQ, f.input(t, f.start.Add(2*time.Hour), limit), "exact"); err != nil {
		t.Fatalf("el límite exacto cuenta como dentro de plazo: %v", err)
	}
}

// CA-104-05: dos reprogramaciones del cliente como máximo; las del profesional no
// cuentan.
func TestRescheduleByCustomer_LimitCountsOnlyCustomerReschedules(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	now := f.start.Add(-48 * time.Hour)

	// El profesional mueve el turno: no consume el cupo del cliente.
	staffMove := f.start.Add(time.Hour)
	if _, err := f.repo.Reschedule(context.Background(), string(shopQ),
		newRescheduleInput(f.appointment, f.version(t), staffMove, staffMove.Add(30*time.Minute)),
		idempotency.Key("staff-"+f.suffix), rescheduleFingerprint("staff-"+f.suffix)); err != nil {
		t.Fatalf("Reschedule (profesional): %v", err)
	}

	for i, offset := range []time.Duration{2 * time.Hour, 3 * time.Hour} {
		if _, err := f.reschedule(t, shopQ, f.input(t, f.start.Add(offset), now), "n"+string(rune('0'+i))); err != nil {
			t.Fatalf("reprogramación %d del cliente: %v", i+1, err)
		}
	}
	_, err := f.reschedule(t, shopQ, f.input(t, f.start.Add(4*time.Hour), now), "third")
	assertAppKind(t, err, apperr.KindRescheduleLimitReached)

	r := f.row(t)
	if r.customerEvents != 2 || r.staffEvents != 1 || !r.startsAt.Equal(f.start.Add(3*time.Hour)) {
		t.Fatalf("row = %+v", r)
	}

	state, found, err := f.repo.CustomerRescheduleState(context.Background(), string(shopQ), f.appointment)
	if err != nil || !found || state.CustomerReschedules != 2 || state.DeadlineMinutes != 20 || state.DurationMinutes != 30 {
		t.Fatalf("CustomerRescheduleState = %+v found=%v err=%v", state, found, err)
	}
}

// CA-104-05: versión vieja y turno no confirmado se rechazan sin cambios.
func TestRescheduleByCustomer_StaleVersionAndNotConfirmed(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	now := f.start.Add(-48 * time.Hour)

	stale := f.input(t, f.start.Add(2*time.Hour), now)
	if _, err := f.reschedule(t, shopQ, f.input(t, f.start.Add(3*time.Hour), now), "first"); err != nil {
		t.Fatalf("primera: %v", err)
	}
	_, err := f.reschedule(t, shopQ, stale, "stale")
	assertAppKind(t, err, apperr.KindVersionConflict)

	markAppointmentTerminal(t, f.db, shopQ, f.appointment)
	_, err = f.reschedule(t, shopQ, f.input(t, f.start.Add(2*time.Hour), now), "terminal")
	assertAppKind(t, err, apperr.KindInvalidState)
}

// CA-104-04: la exclusión de PostgreSQL rechaza mover el turno sobre otra
// cita, y dos clientes que eligen a la vez la misma franja libre dejan un
// solo ganador.
func TestRescheduleByCustomer_OverlapAndRace(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	now := f.start.Add(-48 * time.Hour)

	busy := f.start.Add(2 * time.Hour)
	if _, err := f.repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, busy, 30, f.suffix+"-busy")); err != nil {
		t.Fatalf("CreateInternal (ocupada): %v", err)
	}
	_, err := f.reschedule(t, shopQ, f.input(t, busy.Add(15*time.Minute), now), "overlap")
	assertAppKind(t, err, apperr.KindScheduleConflict)

	other, err := f.repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, f.start.Add(4*time.Hour), 30, f.suffix+"-other"))
	if err != nil {
		t.Fatalf("CreateInternal (otra): %v", err)
	}
	otherDetail, _, err := f.repo.GetAppointmentDetail(context.Background(), string(shopQ), other.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}
	target := f.start.Add(6 * time.Hour)
	inputs := []booking.RescheduleAppointmentByCustomerInput{
		f.input(t, target, now),
		{AppointmentID: other.Appointment.ID, NewStartsAt: target, NewEndsAt: target.Add(30 * time.Minute), ExpectedVersionToken: otherDetail.VersionToken, Now: now},
	}
	var wg sync.WaitGroup
	errs := make([]error, len(inputs))
	for i := range inputs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = f.reschedule(t, shopQ, inputs[i], "race-"+string(rune('a'+i)))
		}()
	}
	wg.Wait()
	wins, conflicts := 0, 0
	for _, err := range errs {
		if err == nil {
			wins++
			continue
		}
		if appErr, ok := apperr.As(err); ok && appErr.Kind == apperr.KindScheduleConflict {
			conflicts++
			continue
		}
		t.Fatalf("error inesperado en la carrera: %v", err)
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("carrera: %d ganadores y %d conflictos, quiero 1 y 1", wins, conflicts)
	}
}

// CA-104-07: la cita de un negocio no existe para la otra.
func TestRescheduleByCustomer_TwoTenants(t *testing.T) {
	f := newCustomerRescheduleFixture(t)
	now := f.start.Add(-48 * time.Hour)

	_, err := f.reschedule(t, shopR, f.input(t, f.start.Add(2*time.Hour), now), "tenant")
	assertAppKind(t, err, apperr.KindNotFound)
	if _, found, err := f.repo.CustomerRescheduleState(context.Background(), string(shopR), f.appointment); err != nil || found {
		t.Fatalf("el otro negocio no ve el turno: found=%v err=%v", found, err)
	}
	if r := f.row(t); !r.startsAt.Equal(f.start) {
		t.Fatalf("el otro negocio no mueve el turno: %+v", r)
	}
}

func assertAppKind(t *testing.T, err error, kind apperr.Kind) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != kind {
		t.Fatalf("esperaba %s, obtuvo %v", kind, err)
	}
}
