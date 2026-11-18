package booking_test

import (
	"context"
	"errors"
	"testing"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// fakeCancelRepository es un doble de booking.Repository que solo
// implementa CancelByProfessional: las demás operaciones nunca deben llamarse
// desde CancelAppointmentByProfessionalService (heredadas de fakeManualRepository,
// que entra en panic si se invocan), mismo criterio que
// fakeRescheduleRepository en reschedule_test.go.
type fakeCancelRepository struct {
	fakeManualRepository

	cancelFn func(ctx context.Context, businessID string, input booking.CancelAppointmentByProfessionalInput, key idempotency.Key, fingerprint idempotency.Fingerprint) (booking.CancelAppointmentByProfessionalResult, error)

	lastCancelInput booking.CancelAppointmentByProfessionalInput
}

func (f *fakeCancelRepository) CancelByProfessional(
	ctx context.Context, businessID string, input booking.CancelAppointmentByProfessionalInput, key idempotency.Key, fingerprint idempotency.Fingerprint,
) (booking.CancelAppointmentByProfessionalResult, error) {
	f.lastCancelInput = input
	if f.cancelFn == nil {
		return booking.CancelAppointmentByProfessionalResult{
			Decision:    idempotency.Decision{Outcome: idempotency.OutcomeProceed},
			Appointment: booking.CancelledAppointment{ID: "appt-1"},
		}, nil
	}
	return f.cancelFn(ctx, businessID, input, key, fingerprint)
}

const validCancelAppointmentID = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"

func validCancelRequest() booking.CancelAppointmentByProfessionalRequest {
	return booking.CancelAppointmentByProfessionalRequest{
		AppointmentID:        validCancelAppointmentID,
		ExpectedVersionToken: "opaque-token",
		ActorStaffUserID:     "staff-1",
	}
}

func TestCancelAppointmentByProfessional_MalformedAppointmentID_RejectsWithoutTouchingRepository(t *testing.T) {
	repo := &fakeCancelRepository{}
	svc := booking.NewCancelAppointmentByProfessionalService(repo)

	req := validCancelRequest()
	req.AppointmentID = "not-a-uuid"

	_, err := svc.CancelAppointmentByProfessional(context.Background(), "shop-1", req, "key-1", "fp-1")
	assertKind(t, err, apperr.KindNotFound)
	if repo.lastCancelInput.AppointmentID != "" {
		t.Fatalf("no debió llamar al repositorio con un id malformado")
	}
}

func TestCancelAppointmentByProfessional_MissingVersionToken_RejectsAsInvalid(t *testing.T) {
	repo := &fakeCancelRepository{}
	svc := booking.NewCancelAppointmentByProfessionalService(repo)

	req := validCancelRequest()
	req.ExpectedVersionToken = "  "

	_, err := svc.CancelAppointmentByProfessional(context.Background(), "shop-1", req, "key-1", "fp-1")
	assertKind(t, err, apperr.KindInvalid)
}

func TestCancelAppointmentByProfessional_MissingActor_RejectsAsValidation(t *testing.T) {
	repo := &fakeCancelRepository{}
	svc := booking.NewCancelAppointmentByProfessionalService(repo)

	req := validCancelRequest()
	req.ActorStaffUserID = ""

	_, err := svc.CancelAppointmentByProfessional(context.Background(), "shop-1", req, "key-1", "fp-1")
	assertKind(t, err, apperr.KindValidation)
}

func TestCancelAppointmentByProfessional_ValidRequest_CallsRepositoryWithStaffActor(t *testing.T) {
	repo := &fakeCancelRepository{}
	svc := booking.NewCancelAppointmentByProfessionalService(repo)

	req := validCancelRequest()
	_, err := svc.CancelAppointmentByProfessional(context.Background(), "shop-1", req, "key-1", "fp-1")
	if err != nil {
		t.Fatalf("err inesperado: %v", err)
	}

	got := repo.lastCancelInput
	if got.AppointmentID != validCancelAppointmentID {
		t.Fatalf("AppointmentID = %q, want %q", got.AppointmentID, validCancelAppointmentID)
	}
	if got.ExpectedVersionToken != "opaque-token" {
		t.Fatalf("ExpectedVersionToken = %q, want %q", got.ExpectedVersionToken, "opaque-token")
	}
	if got.Actor.Type != booking.ActorTypeStaff || got.Actor.StaffUserID == nil || *got.Actor.StaffUserID != "staff-1" {
		t.Fatalf("Actor = %+v, want staff-1", got.Actor)
	}
}

func TestCancelAppointmentByProfessional_RepositoryResult_PassesThrough(t *testing.T) {
	want := booking.CancelAppointmentByProfessionalResult{
		Decision:    idempotency.Decision{Outcome: idempotency.OutcomeProceed},
		Appointment: booking.CancelledAppointment{ID: "appt-9", VersionToken: "new-token"},
	}
	repo := &fakeCancelRepository{
		cancelFn: func(context.Context, string, booking.CancelAppointmentByProfessionalInput, idempotency.Key, idempotency.Fingerprint) (booking.CancelAppointmentByProfessionalResult, error) {
			return want, nil
		},
	}
	svc := booking.NewCancelAppointmentByProfessionalService(repo)

	req := validCancelRequest()
	got, err := svc.CancelAppointmentByProfessional(context.Background(), "shop-1", req, "key-1", "fp-1")
	if err != nil {
		t.Fatalf("err inesperado: %v", err)
	}
	if got.Appointment.ID != "appt-9" || got.Appointment.VersionToken != "new-token" {
		t.Fatalf("resultado no pasado tal cual: %+v", got)
	}
}

func TestCancelAppointmentByProfessional_RepositoryError_Propagates(t *testing.T) {
	wantErr := apperr.VersionConflict("el turno cambió desde que se leyó; recarga antes de reintentar")
	repo := &fakeCancelRepository{
		cancelFn: func(context.Context, string, booking.CancelAppointmentByProfessionalInput, idempotency.Key, idempotency.Fingerprint) (booking.CancelAppointmentByProfessionalResult, error) {
			return booking.CancelAppointmentByProfessionalResult{}, wantErr
		},
	}
	svc := booking.NewCancelAppointmentByProfessionalService(repo)

	req := validCancelRequest()
	_, err := svc.CancelAppointmentByProfessional(context.Background(), "shop-1", req, "key-1", "fp-1")
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
}
