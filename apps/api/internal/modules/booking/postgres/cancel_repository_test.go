// Package postgres_test (pruebas de integración, HU-066) requiere
// PostgreSQL REAL con las diecisiete migraciones aplicadas y
// database/testdata/dos_negocios.sql + database/testdata/hu060_citas.sql
// cargados: mismos fixtures que reschedule_repository_test.go (HU-065). El
// turno base de cada prueba se inserta con repo.CreateInternal, la misma
// primitiva probada en repository_test.go.
//
//	export TEST_DATABASE_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable"
//	go test -race ./internal/modules/booking/postgres/...
package postgres_test

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// cancelFingerprint deriva un Fingerprint hexadecimal válido a partir de una
// semilla legible, mismo criterio que rescheduleFingerprint: estas pruebas
// ejercitan booking.Repository.CancelByProfessional directamente, sin pasar por
// la capa HTTP que lo calcularía.
func cancelFingerprint(seed string) idempotency.Fingerprint {
	sum := sha256.Sum256([]byte(seed))
	return idempotency.Fingerprint(fmt.Sprintf("%x", sum))
}

func newCancelInput(appointmentID, versionToken string) booking.CancelAppointmentByProfessionalInput {
	return booking.CancelAppointmentByProfessionalInput{
		AppointmentID:        appointmentID,
		ExpectedVersionToken: versionToken,
		Actor:                booking.Actor{Type: booking.ActorTypeStaff, StaffUserID: strPtr(staffQ)},
	}
}

func TestCancelByProfessional_ValidRequest_UpdatesStatusAndInsertsHistory(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	detail, found, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil || !found {
		t.Fatalf("GetAppointmentDetail: found=%v err=%v", found, err)
	}

	input := newCancelInput(created.Appointment.ID, detail.VersionToken)
	result, err := repo.CancelByProfessional(context.Background(), string(shopQ), input,
		idempotency.Key("cancel-key-"+suffix), cancelFingerprint("valid-"+suffix))
	if err != nil {
		t.Fatalf("CancelByProfessional: %v", err)
	}
	if result.Decision.Outcome != idempotency.OutcomeProceed {
		t.Fatalf("Outcome = %v, want Proceed", result.Decision.Outcome)
	}
	if result.Appointment.Status != booking.StatusCancelledByProfessional {
		t.Fatalf("Status = %v, want %v", result.Appointment.Status, booking.StatusCancelledByProfessional)
	}
	if result.Appointment.VersionToken == detail.VersionToken {
		t.Fatalf("VersionToken no cambió tras la escritura")
	}
	// Profesional, servicio, cliente, persona, intervalo y nota NUNCA cambian en
	// T6 (CA-066-07).
	if result.Appointment.ProfessionalID != detail.ProfessionalID ||
		!result.Appointment.StartsAt.Equal(detail.StartsAt) || !result.Appointment.EndsAt.Equal(detail.EndsAt) {
		t.Fatalf("T6 modificó datos fuera del estado: %+v", result.Appointment)
	}

	items, _, found, err := repo.ListAppointmentHistory(context.Background(), string(shopQ), created.Appointment.ID, nil, 20)
	if err != nil || !found {
		t.Fatalf("ListAppointmentHistory: found=%v err=%v", found, err)
	}
	var cancelled *booking.HistoryRow
	for i := range items {
		if items[i].EventType == booking.EventTypeAppointmentCancelledByProfessional {
			cancelled = &items[i]
		}
	}
	if cancelled == nil {
		t.Fatalf("no se insertó el evento appointment_cancelled_by_professional: %+v", items)
	}
	if len(cancelled.Changes) != 1 || cancelled.Changes[0].FieldName != "status" ||
		cancelled.Changes[0].PreviousValue == nil || *cancelled.Changes[0].PreviousValue != "confirmed" ||
		cancelled.Changes[0].NewValue == nil || *cancelled.Changes[0].NewValue != "cancelled_by_professional" {
		t.Fatalf("Changes = %+v, want status: confirmed -> cancelled_by_professional", cancelled.Changes)
	}
}

// TestCancelByProfessional_RepeatedByProfessional_IsSuccessNoOpNoDuplicateEvent cubre
// CA-066-04: cancelar una cita YA cancelled_by_professional con una clave de
// idempotencia NUEVA y el token de versión ORIGINAL (deliberadamente
// obsoleto) sigue teniendo éxito, sin duplicar el evento de historial.
func TestCancelByProfessional_RepeatedByProfessional_IsSuccessNoOpNoDuplicateEvent(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	original, found, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil || !found {
		t.Fatalf("GetAppointmentDetail: found=%v err=%v", found, err)
	}

	first, err := repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, original.VersionToken),
		idempotency.Key("cancel-first-"+suffix), cancelFingerprint("first-"+suffix))
	if err != nil {
		t.Fatalf("CancelByProfessional(1): %v", err)
	}

	// Segunda cancelación: clave nueva, token ORIGINAL (pre-cancelación,
	// ahora obsoleto). Debe tener éxito de todos modos (CA-066-04).
	second, err := repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, original.VersionToken),
		idempotency.Key("cancel-second-"+suffix), cancelFingerprint("second-"+suffix))
	if err != nil {
		t.Fatalf("CancelByProfessional(2) con token obsoleto debió tener éxito (CA-066-04): %v", err)
	}
	if second.Appointment.Status != booking.StatusCancelledByProfessional {
		t.Fatalf("Status(2) = %v, want %v", second.Appointment.Status, booking.StatusCancelledByProfessional)
	}
	if second.Appointment.VersionToken != first.Appointment.VersionToken {
		t.Fatalf("VersionToken cambió en una repetición no-op: %q != %q", second.Appointment.VersionToken, first.Appointment.VersionToken)
	}

	items, _, _, err := repo.ListAppointmentHistory(context.Background(), string(shopQ), created.Appointment.ID, nil, 20)
	if err != nil {
		t.Fatalf("ListAppointmentHistory: %v", err)
	}
	count := 0
	for _, row := range items {
		if row.EventType == booking.EventTypeAppointmentCancelledByProfessional {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("appointment_cancelled_by_professional insertado %d veces, want exactamente 1", count)
	}
}

func TestCancelByProfessional_OtherTerminalStatus_ReturnsInvalidState(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	markAppointmentTerminal(t, db, shopQ, created.Appointment.ID)

	afterDetail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}

	_, err = repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, afterDetail.VersionToken),
		idempotency.Key("cancel-terminal-"+suffix), cancelFingerprint("terminal-"+suffix))
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInvalidState {
		t.Fatalf("err = %v, want apperr.KindInvalidState", err)
	}
}

// TestCancelByProfessional_StaleVersionTokenOnConfirmed_ReturnsVersionConflict
// cubre CA-066-05: la cita sigue `confirmed` (reprogramada, no cancelada),
// así que un token obsoleto SÍ debe rechazarse con version-conflict — a
// diferencia del caso "ya cancelled_by_professional" de CA-066-04.
func TestCancelByProfessional_StaleVersionTokenOnConfirmed_ReturnsVersionConflict(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	staleDetail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}

	newStarts := start.Add(3 * time.Hour)
	_, err = repo.Reschedule(context.Background(), string(shopQ),
		booking.RescheduleInput{
			AppointmentID:        created.Appointment.ID,
			NewStartsAt:          newStarts,
			NewEndsAt:            newStarts.Add(30 * time.Minute),
			ExpectedVersionToken: staleDetail.VersionToken,
			Actor:                booking.Actor{Type: booking.ActorTypeStaff, StaffUserID: strPtr(staffQ)},
		},
		idempotency.Key("resched-for-cancel-"+suffix), cancelFingerprint("resched-for-cancel-"+suffix))
	if err != nil {
		t.Fatalf("Reschedule (para invalidar el token): %v", err)
	}

	_, err = repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, staleDetail.VersionToken),
		idempotency.Key("cancel-stale-"+suffix), cancelFingerprint("stale-"+suffix))
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindVersionConflict {
		t.Fatalf("err = %v, want apperr.KindVersionConflict", err)
	}
}

// TestCancelByProfessional_TenantMismatch_ReturnsNotFound verifica RN-TEN-01: una
// cita real de shopQ nunca se cancela consultándola con el businessID de
// shopR, aunque el identificador coincida literalmente.
func TestCancelByProfessional_TenantMismatch_ReturnsNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	detail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}

	_, err = repo.CancelByProfessional(context.Background(), string(shopR), newCancelInput(created.Appointment.ID, detail.VersionToken),
		idempotency.Key("cancel-tenant-"+suffix), cancelFingerprint("tenant-"+suffix))
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindNotFound {
		t.Fatalf("err = %v, want apperr.KindNotFound (RN-TEN-01)", err)
	}
}

func TestCancelByProfessional_RepeatedKeySameIntent_Replays(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	detail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}

	input := newCancelInput(created.Appointment.ID, detail.VersionToken)
	key := idempotency.Key("cancel-replay-" + suffix)
	fingerprint := cancelFingerprint("replay-" + suffix)

	first, err := repo.CancelByProfessional(context.Background(), string(shopQ), input, key, fingerprint)
	if err != nil {
		t.Fatalf("CancelByProfessional(1): %v", err)
	}
	second, err := repo.CancelByProfessional(context.Background(), string(shopQ), input, key, fingerprint)
	if err != nil {
		t.Fatalf("CancelByProfessional(2): %v", err)
	}
	if second.Response.Body != first.Response.Body {
		t.Fatalf("la repetición no reprodujo el mismo cuerpo byte a byte:\n1: %s\n2: %s", first.Response.Body, second.Response.Body)
	}

	items, _, _, err := repo.ListAppointmentHistory(context.Background(), string(shopQ), created.Appointment.ID, nil, 20)
	if err != nil {
		t.Fatalf("ListAppointmentHistory: %v", err)
	}
	count := 0
	for _, row := range items {
		if row.EventType == booking.EventTypeAppointmentCancelledByProfessional {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("appointment_cancelled_by_professional insertado %d veces, want exactamente 1", count)
	}
}

// TestCancelByProfessional_ExclusionReleased_NewAppointmentCanUseFreedSlot cubre
// CA-066-03: tras cancelar una cita FUTURA, su intervalo deja de participar
// en la restricción de exclusión de inmediato.
func TestCancelByProfessional_ExclusionReleased_NewAppointmentCanUseFreedSlot(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	detail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}

	if _, err := repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, detail.VersionToken),
		idempotency.Key("cancel-free-"+suffix), cancelFingerprint("free-"+suffix)); err != nil {
		t.Fatalf("CancelByProfessional: %v", err)
	}

	// Misma franja exacta, mismo profesional: solo puede tener éxito si la
	// exclusión ya liberó el intervalo cancelado.
	if _, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix+"-new")); err != nil {
		t.Fatalf("CreateInternal en la franja liberada debió tener éxito: %v", err)
	}
}

// TestCancelByProfessional_ConcurrentDoubleCancel_ExactlyOneWritesHistory cubre la
// "carrera coordinada" de las pruebas obligatorias: dos cancelaciones
// concurrentes sobre LA MISMA cita, con claves de idempotencia distintas.
// FOR UPDATE serializa las dos transacciones: la segunda encuentra la fila
// ya cancelled_by_professional y toma la rama no-op (CA-066-04), así que AMBAS
// deben tener éxito y el historial debe conservar exactamente un evento.
func TestCancelByProfessional_ConcurrentDoubleCancel_ExactlyOneWritesHistory(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	suffix := uniqueSuffix(t)
	start := baseStart(t)

	created, err := repo.CreateInternal(context.Background(), string(shopQ), validInput(t, professionalQ1, serviceQ, start, 30, suffix))
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	detail, _, err := repo.GetAppointmentDetail(context.Background(), string(shopQ), created.Appointment.ID)
	if err != nil {
		t.Fatalf("GetAppointmentDetail: %v", err)
	}

	var (
		wg               sync.WaitGroup
		resultA, resultB booking.CancelAppointmentByProfessionalResult
		errA, errB       error
		startBarrier     = make(chan struct{})
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		close(startBarrier)
		resultA, errA = repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, detail.VersionToken),
			idempotency.Key("cancel-race-a-"+suffix), cancelFingerprint("race-a-"+suffix))
	}()
	go func() {
		defer wg.Done()
		<-startBarrier
		resultB, errB = repo.CancelByProfessional(context.Background(), string(shopQ), newCancelInput(created.Appointment.ID, detail.VersionToken),
			idempotency.Key("cancel-race-b-"+suffix), cancelFingerprint("race-b-"+suffix))
	}()
	wg.Wait()

	if errA != nil {
		t.Fatalf("errA = %v, want nil (ambas cancelaciones deben tener éxito, CA-066-04)", errA)
	}
	if errB != nil {
		t.Fatalf("errB = %v, want nil (ambas cancelaciones deben tener éxito, CA-066-04)", errB)
	}
	if resultA.Appointment.Status != booking.StatusCancelledByProfessional || resultB.Appointment.Status != booking.StatusCancelledByProfessional {
		t.Fatalf("ambos resultados deben reflejar cancelled_by_professional: A=%v B=%v", resultA.Appointment.Status, resultB.Appointment.Status)
	}

	count := 0
	items, _, _, err := repo.ListAppointmentHistory(context.Background(), string(shopQ), created.Appointment.ID, nil, 20)
	if err != nil {
		t.Fatalf("ListAppointmentHistory: %v", err)
	}
	for _, row := range items {
		if row.EventType == booking.EventTypeAppointmentCancelledByProfessional {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("appointment_cancelled_by_professional insertado %d veces bajo carrera, want exactamente 1", count)
	}
}
