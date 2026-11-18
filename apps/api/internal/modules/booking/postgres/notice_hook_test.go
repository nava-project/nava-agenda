package postgres_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	bookingpostgres "nava-agenda/internal/modules/booking/postgres"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/idempotency"
)

// Pruebas del puerto NoticeHook (HU-130, DEC-142): booking avisa, dentro de la
// MISMA transacción, solo cuando el profesional cambia el turno de verdad.

type recordingNoticeHook struct {
	mu        sync.Mutex
	calls     []string
	reminders []string
	err       error
}

func (h *recordingNoticeHook) AppointmentReminderRequired(_ context.Context, _ database.Queries, businessID, appointmentID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.reminders = append(h.reminders, businessID+"|"+appointmentID)
	return h.err
}

func (h *recordingNoticeHook) reminderSnapshot() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.reminders...)
}

func (h *recordingNoticeHook) AppointmentNoticeRequired(_ context.Context, _ database.Queries, businessID, appointmentID, kind string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.calls = append(h.calls, businessID+"|"+appointmentID+"|"+kind)
	return h.err
}

func (h *recordingNoticeHook) snapshot() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.calls...)
}

func seedForNotice(t *testing.T, repo *bookingpostgres.Repository, suffix string) (booking.CreateInternalResult, string, time.Time) {
	t.Helper()
	start := baseStart(t)
	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	detail, found, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil || !found {
		t.Fatalf("GetAppointmentDetail: found=%v err=%v", found, err)
	}
	return created, detail.VersionToken, start
}

func TestNoticeHook_CancelByProfessional_QueuesOnceAndNotOnRepeatOrReplay(t *testing.T) {
	db := setupTestDB(t)
	hook := &recordingNoticeHook{}
	repo := newRepository(db).WithNoticeHook(hook)
	suffix := uniqueSuffix(t)
	created, token, _ := seedForNotice(t, repo, suffix)
	ctx := context.Background()

	input := newCancelInput(created.Appointment.ID, token)
	key := idempotency.Key("notice-cancel-" + suffix)
	fp := cancelFingerprint("notice-cancel-" + suffix)
	if _, err := repo.CancelByProfessional(ctx, string(shopQ), input, key, fp); err != nil {
		t.Fatalf("CancelByProfessional: %v", err)
	}
	want := string(shopQ) + "|" + created.Appointment.ID + "|" + bookingpostgres.NoticeCancelledByProfessional
	if got := hook.snapshot(); len(got) != 1 || got[0] != want {
		t.Fatalf("la cancelación aplicada avisa una vez: %v, quiero [%s]", got, want)
	}

	// Repetición exacta (misma clave): reproduce, no avisa (CA-130-02).
	if _, err := repo.CancelByProfessional(ctx, string(shopQ), input, key, fp); err != nil {
		t.Fatalf("CancelByProfessional (replay): %v", err)
	}
	// Otra clave sobre un turno ya cancelado por el profesional: éxito sin cambio, no avisa.
	if _, err := repo.CancelByProfessional(ctx, string(shopQ), input,
		idempotency.Key("notice-cancel-again-"+suffix), cancelFingerprint("notice-cancel-again-"+suffix)); err != nil {
		t.Fatalf("CancelByProfessional (repetida): %v", err)
	}
	if got := hook.snapshot(); len(got) != 1 {
		t.Fatalf("ni la reproducción ni la cancelación repetida avisan: %v", got)
	}
}

func TestNoticeHook_Reschedule_QueuesOnlyWhenTheIntervalChanges(t *testing.T) {
	db := setupTestDB(t)
	hook := &recordingNoticeHook{}
	repo := newRepository(db).WithNoticeHook(hook)
	suffix := uniqueSuffix(t)
	created, token, start := seedForNotice(t, repo, suffix)
	ctx := context.Background()

	// Mismo intervalo: no-op, no avisa (CA-130-02).
	same := newRescheduleInput(created.Appointment.ID, token, created.Appointment.StartsAt, created.Appointment.EndsAt)
	if _, err := repo.Reschedule(ctx, string(shopQ), same,
		idempotency.Key("notice-same-"+suffix), rescheduleFingerprint("notice-same-"+suffix)); err != nil {
		t.Fatalf("Reschedule (no-op): %v", err)
	}
	if got := hook.snapshot(); len(got) != 0 {
		t.Fatalf("un no-op no avisa: %v", got)
	}

	newStarts := start.Add(3 * time.Hour)
	moved := newRescheduleInput(created.Appointment.ID, token, newStarts, newStarts.Add(30*time.Minute))
	if _, err := repo.Reschedule(ctx, string(shopQ), moved,
		idempotency.Key("notice-moved-"+suffix), rescheduleFingerprint("notice-moved-"+suffix)); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
	want := string(shopQ) + "|" + created.Appointment.ID + "|" + bookingpostgres.NoticeRescheduled
	if got := hook.snapshot(); len(got) != 1 || got[0] != want {
		t.Fatalf("la reprogramación aplicada avisa una vez: %v, quiero [%s]", got, want)
	}
}

func TestNoticeHook_FailureRollsBackTheChange(t *testing.T) {
	db := setupTestDB(t)
	suffix := uniqueSuffix(t)
	// El turno de partida se crea sin gancho: aquí solo falla el aviso de la cancelación.
	created, token, _ := seedForNotice(t, newRepository(db), suffix)
	repo := newRepository(db).WithNoticeHook(&recordingNoticeHook{err: errors.New("cola caída")})
	ctx := context.Background()

	_, err := repo.CancelByProfessional(ctx, string(shopQ), newCancelInput(created.Appointment.ID, token),
		idempotency.Key("notice-fail-"+suffix), cancelFingerprint("notice-fail-"+suffix))
	if err == nil {
		t.Fatal("si el aviso no puede encolarse, la cancelación debe fallar entera")
	}
	detail, found, err := repo.GetAppointmentDetail(ctx, string(shopQ), created.Appointment.ID)
	if err != nil || !found || detail.Status != booking.StatusConfirmed {
		t.Fatalf("la cancelación debió revertirse: found=%v status=%v err=%v", found, detail.Status, err)
	}
}

// HU-131 (DEC-144): el recordatorio se programa en la transacción que crea el
// turno y se regenera cuando cambia de hora; ni un no-op ni una cancelación lo
// programan.
func TestReminderHook_CreateAndReschedule(t *testing.T) {
	db := setupTestDB(t)
	hook := &recordingNoticeHook{}
	repo := newRepository(db).WithNoticeHook(hook)
	suffix := uniqueSuffix(t)
	created, token, start := seedForNotice(t, repo, suffix)
	ctx := context.Background()
	want := string(shopQ) + "|" + created.Appointment.ID

	if got := hook.reminderSnapshot(); len(got) != 1 || got[0] != want {
		t.Fatalf("crear el turno programa el recordatorio una vez: %v, quiero [%s]", got, want)
	}

	same := newRescheduleInput(created.Appointment.ID, token, created.Appointment.StartsAt, created.Appointment.EndsAt)
	if _, err := repo.Reschedule(ctx, string(shopQ), same,
		idempotency.Key("rem-same-"+suffix), rescheduleFingerprint("rem-same-"+suffix)); err != nil {
		t.Fatalf("Reschedule (no-op): %v", err)
	}
	if got := hook.reminderSnapshot(); len(got) != 1 {
		t.Fatalf("un no-op no regenera el recordatorio: %v", got)
	}

	newStarts := start.Add(3 * time.Hour)
	moved := newRescheduleInput(created.Appointment.ID, token, newStarts, newStarts.Add(30*time.Minute))
	if _, err := repo.Reschedule(ctx, string(shopQ), moved,
		idempotency.Key("rem-moved-"+suffix), rescheduleFingerprint("rem-moved-"+suffix)); err != nil {
		t.Fatalf("Reschedule: %v", err)
	}
	if got := hook.reminderSnapshot(); len(got) != 2 || got[1] != want {
		t.Fatalf("reprogramar regenera el recordatorio: %v", got)
	}
}

func TestReminderHook_CancelDoesNotSchedule(t *testing.T) {
	db := setupTestDB(t)
	hook := &recordingNoticeHook{}
	repo := newRepository(db).WithNoticeHook(hook)
	suffix := uniqueSuffix(t)
	created, token, _ := seedForNotice(t, repo, suffix)

	if _, err := repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, token),
		idempotency.Key("rem-cancel-"+suffix), cancelFingerprint("rem-cancel-"+suffix)); err != nil {
		t.Fatalf("CancelByProfessional: %v", err)
	}
	if got := hook.reminderSnapshot(); len(got) != 1 {
		t.Fatalf("cancelar no programa otro recordatorio (se descarta al enviar): %v", got)
	}
}

func TestReminderHook_FailureRollsBackTheCreation(t *testing.T) {
	db := setupTestDB(t)
	hook := &recordingNoticeHook{err: errors.New("cola caída")}
	repo := newRepository(db).WithNoticeHook(hook)

	if _, err := repo.CreateInternal(context.Background(), string(shopQ),
		validInput(t, professionalQ1, serviceQ, baseStart(t), 30, uniqueSuffix(t))); err == nil {
		t.Fatal("si el recordatorio no puede programarse, el turno no debe crearse")
	}
}

// HU-131: la reserva pública también programa el recordatorio, dentro de la
// transacción que crea el turno, y una repetición con la misma clave no lo duplica.
func TestReminderHook_CreatePublic_SchedulesOnceAndNotOnReplay(t *testing.T) {
	db := setupTestDB(t)
	hook := &recordingNoticeHook{}
	repo := newRepository(db).WithNoticeHook(hook)
	suffix := uniqueSuffix(t)

	input := publicInput(t, professionalQ1, serviceQ, baseStart(t), suffix, booking.CustomerInput{
		New: &booking.NewCustomerInput{FullName: "Cliente recordatorio " + suffix, Email: strPtr(suffix + "@example.com")},
	})
	key := idempotency.Key("public-rem-" + suffix)
	fp := idempotency.Fingerprint("3123456789abcdef0123456789abcdef")

	if _, err := repo.CreatePublic(context.Background(), string(shopQ), input, key, fp); err != nil {
		t.Fatalf("CreatePublic: %v", err)
	}
	if got := hook.reminderSnapshot(); len(got) != 1 || !strings.HasPrefix(got[0], string(shopQ)+"|") {
		t.Fatalf("la reserva pública programa el recordatorio una vez en su negocio: %v", got)
	}
	if _, err := repo.CreatePublic(context.Background(), string(shopQ), input, key, fp); err != nil {
		t.Fatalf("CreatePublic (replay): %v", err)
	}
	if got := hook.reminderSnapshot(); len(got) != 1 {
		t.Fatalf("una repetición idempotente no programa otro: %v", got)
	}
}
