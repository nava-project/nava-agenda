// Pruebas de integración de DEC-193 (issue #854): un turno «No vino» ocupa la
// agenda solo hasta el minuto en que se marca. Mismo arnés y mismo criterio
// de reloj sintético que close_repository_test.go y correct_repository_test.go.
package postgres_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// markNoShowAt crea un turno de 30 min en start y lo marca «No vino» en now.
func markNoShowAt(t *testing.T, repo interface {
	CreateInternal(context.Context, string, booking.CreateInternalInput) (booking.CreateInternalResult, error)
	GetAppointmentDetail(context.Context, string, string) (booking.AppointmentDetail, bool, error)
	MarkNoShow(context.Context, string, booking.CloseAppointmentInput, idempotency.Key, idempotency.Fingerprint) (booking.MarkNoShowResult, error)
}, start, now time.Time, suffix string) string {
	t.Helper()
	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	detail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}
	if _, err := repo.MarkNoShow(context.Background(), string(shopQ),
		newCloseInput(created.Appointment.ID, detail.VersionToken, now),
		idempotency.Key("noshow-cut-"+suffix), closeFingerprint("noshow-cut-"+suffix)); err != nil {
		t.Fatalf("MarkNoShow: %v", err)
	}
	return created.Appointment.ID
}

func occupiedUntil(t *testing.T, repo interface {
	GetAppointmentDetail(context.Context, string, string) (booking.AppointmentDetail, bool, error)
}, id string) *time.Time {
	t.Helper()
	d, found, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), id)
	if err != nil || !found {
		t.Fatalf("GetAppointmentDetail: found=%v err=%v", found, err)
	}
	return d.OccupiedUntil
}

func assertConflict(t *testing.T, err error, what string) *apperr.Error {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindConflict {
		t.Fatalf("%s: err = %v, want apperr.KindConflict", what, err)
	}
	return appErr
}

// TestMarkNoShow_InsideSlot_FreesTheRestFromTheMarkMinute cubre R1, R2 y R5:
// marcado a los 10 min 40 s, el turno ocupa hasta el minuto 10 (truncado, con
// el instante de la guarda); un turno nuevo que empieza en el corte entra y
// uno que empieza un minuto antes choca. starts_at y ends_at no cambian.
func TestMarkNoShow_InsideSlot_FreesTheRestFromTheMarkMinute(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)
	cut := start.Add(10 * time.Minute)

	id := markNoShowAt(t, repo, start, cut.Add(40*time.Second), suffix)

	detail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), id)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}
	if detail.OccupiedUntil == nil || !detail.OccupiedUntil.Equal(cut) {
		t.Fatalf("OccupiedUntil = %v, want %v", detail.OccupiedUntil, cut)
	}
	if !detail.StartsAt.Equal(start) || !detail.EndsAt.Equal(start.Add(30*time.Minute)) {
		t.Fatalf("la marca cambió la franja original: [%v, %v)", detail.StartsAt, detail.EndsAt)
	}

	entries, err := repo.ListDailyAgenda(context.Background(), string(shopQ), professionalQ1, start, start.Add(time.Hour))
	if err != nil {
		t.Fatalf("ListDailyAgenda: %v", err)
	}
	var seen bool
	for _, e := range entries {
		if e.ID == id {
			seen = true
			if e.OccupiedUntil == nil || !e.OccupiedUntil.Equal(cut) {
				t.Fatalf("agenda: OccupiedUntil = %v, want %v", e.OccupiedUntil, cut)
			}
		}
	}
	if !seen {
		t.Fatalf("la agenda no muestra el no_show con su franja original")
	}

	_, err = repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, cut.Add(-time.Minute), 1, suffix+"-antes"))
	assertConflict(t, err, "un turno un minuto antes del corte")
	if _, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, cut, 20, suffix+"-corte")); err != nil {
		t.Fatalf("un turno en el corte debió entrar: %v", err)
	}
}

// TestMarkNoShow_AfterEndsAt_FreesNothing cubre R2: marcar después del fin
// (el cierre del día) no libera nada.
func TestMarkNoShow_AfterEndsAt_FreesNothing(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	id := markNoShowAt(t, repo, start, start.Add(3*time.Hour), suffix)
	if got := occupiedUntil(t, repo, id); got == nil || !got.Equal(start.Add(30*time.Minute)) {
		t.Fatalf("OccupiedUntil = %v, want ends_at", got)
	}
	_, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start.Add(15*time.Minute), 15, suffix+"-x"))
	assertConflict(t, err, "un turno dentro de la franja de un no_show marcado tarde")
}

// TestCorrectAppointmentStatus_NoShowToCompleted_FreedSlotTaken_ReturnsConflict
// cubre la pregunta 3 de DEC-193: si otro turno ya tomó el tramo liberado,
// revertir a completed responde 409 con su explicación y no toca nada.
func TestCorrectAppointmentStatus_NoShowToCompleted_FreedSlotTaken_ReturnsConflict(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)
	cut := start.Add(10 * time.Minute)

	id := markNoShowAt(t, repo, start, cut, suffix)
	if _, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, cut, 20, suffix+"-b")); err != nil {
		t.Fatalf("CreateInternal(B) en el tramo liberado: %v", err)
	}
	before, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), id)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}

	_, err = repo.CorrectAppointmentStatus(context.Background(), string(shopQ),
		newCorrectInput(id, "completed", "sí vino", before.VersionToken, cut.Add(time.Hour)),
		idempotency.Key("correct-cut-"+suffix), closeFingerprint("correct-cut-"+suffix))
	appErr := assertConflict(t, err, "revertir con el tramo tomado")
	if !strings.Contains(appErr.Message, "otro turno ya ocupa parte de esta franja") {
		t.Fatalf("detail = %q, want la explicación de DEC-193", appErr.Message)
	}

	after, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), id)
	if err != nil {
		t.Fatalf("GetAppointmentDetail(after): %v", err)
	}
	if after.Status != booking.StatusNoShow || after.VersionToken != before.VersionToken ||
		after.OccupiedUntil == nil || !after.OccupiedUntil.Equal(cut) {
		t.Fatalf("el 409 modificó el turno: %+v", after)
	}
}

// TestCorrectAppointmentStatus_CutFollowsTheStatus cubre T8 en los demás
// caminos: entrar en no_show corta en el minuto de la corrección; volver a
// completed ocupa entera; pasar a cancelado no ocupa (OccupiedUntil nil).
func TestCorrectAppointmentStatus_CutFollowsTheStatus(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)
	end := start.Add(30 * time.Minute)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	id := created.Appointment.ID
	setAppointmentStatus(t, db, shopQ, id, "completed")

	steps := []struct {
		to   string
		now  time.Time
		want *time.Time
	}{
		{"no_show", start.Add(5*time.Minute + 59*time.Second), ptrTime(start.Add(5 * time.Minute))},
		{"completed", start.Add(6 * time.Minute), &end},
		{"no_show", end.Add(time.Hour), &end},
		{"cancelled_by_professional", end.Add(2 * time.Hour), nil},
	}
	for i, s := range steps {
		d, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), id)
		if err != nil {
			t.Fatalf("paso %d: GetAppointmentDetail: %v", i, err)
		}
		if _, err := repo.CorrectAppointmentStatus(context.Background(), string(shopQ),
			newCorrectInput(id, s.to, "corrección", d.VersionToken, s.now),
			idempotency.Key("correct-steps-"+suffix+"-"+s.to+string(rune('a'+i))), closeFingerprint("steps-"+suffix+string(rune('a'+i)))); err != nil {
			t.Fatalf("paso %d (%s): %v", i, s.to, err)
		}
		got := occupiedUntil(t, repo, id)
		if (got == nil) != (s.want == nil) || (got != nil && !got.Equal(*s.want)) {
			t.Fatalf("paso %d (%s): OccupiedUntil = %v, want %v", i, s.to, got, s.want)
		}
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
