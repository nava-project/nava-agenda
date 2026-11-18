package apperr_test

import (
	"errors"
	"fmt"
	"testing"

	"nava-agenda/internal/platform/apperr"
)

func TestNotFound_CarriesSafeMessage(t *testing.T) {
	err := apperr.NotFound("recurso no disponible")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindNotFound {
		t.Fatalf("expected KindNotFound, got %q", got.Kind)
	}
	if got.Message != "recurso no disponible" {
		t.Fatalf("unexpected message: %q", got.Message)
	}
}

func TestInternal_WrapsCauseWithoutExposingIt(t *testing.T) {
	cause := errors.New("pq: syntax error at or near \"SELEC\"")
	err := apperr.Internal(cause)

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindInternal {
		t.Fatalf("expected KindInternal, got %q", got.Kind)
	}
	if !errors.Is(err, cause) {
		t.Fatal("expected Unwrap to expose the cause for internal error-chain inspection")
	}
}

func TestInvalid_CarriesSafeMessage(t *testing.T) {
	err := apperr.Invalid("Idempotency-Key tiene un formato inválido")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindInvalid {
		t.Fatalf("expected KindInvalid, got %q", got.Kind)
	}
	if got.Message != "Idempotency-Key tiene un formato inválido" {
		t.Fatalf("unexpected message: %q", got.Message)
	}
}

func TestIdempotencyConflict_CarriesSafeMessage(t *testing.T) {
	err := apperr.IdempotencyConflict("la clave ya se usó con contenido distinto")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindIdempotencyConflict {
		t.Fatalf("expected KindIdempotencyConflict, got %q", got.Kind)
	}
}

func TestIdempotencyLocked_CarriesSafeMessage(t *testing.T) {
	err := apperr.IdempotencyLocked("operación en curso")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindIdempotencyLocked {
		t.Fatalf("expected KindIdempotencyLocked, got %q", got.Kind)
	}
}

func TestValidation_CarriesSafeMessage(t *testing.T) {
	err := apperr.Validation("email es obligatorio")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindValidation {
		t.Fatalf("expected KindValidation, got %q", got.Kind)
	}
}

func TestUnauthorized_CarriesSafeMessage(t *testing.T) {
	err := apperr.Unauthorized("correo o contraseña incorrectos")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindUnauthorized {
		t.Fatalf("expected KindUnauthorized, got %q", got.Kind)
	}
	if got.Message != "correo o contraseña incorrectos" {
		t.Fatalf("unexpected message: %q", got.Message)
	}
}

func TestConflict_CarriesSafeMessage(t *testing.T) {
	err := apperr.Conflict("ya existe un servicio activo con ese nombre")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindConflict {
		t.Fatalf("expected KindConflict, got %q", got.Kind)
	}
	if got.Message != "ya existe un servicio activo con ese nombre" {
		t.Fatalf("unexpected message: %q", got.Message)
	}
}

func TestScheduleConflict_CarriesSafeMessageAndDistinctKind(t *testing.T) {
	err := apperr.ScheduleConflict("la franja elegida ya no está disponible")

	got, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr.As to recognize the error")
	}
	if got.Kind != apperr.KindScheduleConflict {
		t.Fatalf("expected KindScheduleConflict, got %q", got.Kind)
	}
	if got.Kind == apperr.KindConflict {
		t.Fatal("KindScheduleConflict must stay distinct from KindConflict (HU-097, RN-CON-05)")
	}
	if got.Message != "la franja elegida ya no está disponible" {
		t.Fatalf("unexpected message: %q", got.Message)
	}
}

func TestAs_ReturnsFalseForForeignError(t *testing.T) {
	_, ok := apperr.As(fmt.Errorf("plain error"))
	if ok {
		t.Fatal("expected apperr.As to return false for a non-apperr error")
	}
}

func TestAs_UnwrapsWrappedError(t *testing.T) {
	base := apperr.NotFound("x")
	wrapped := fmt.Errorf("contexto adicional: %w", base)

	got, ok := apperr.As(wrapped)
	if !ok {
		t.Fatal("expected apperr.As to unwrap through fmt.Errorf %w")
	}
	if got.Kind != apperr.KindNotFound {
		t.Fatalf("expected KindNotFound, got %q", got.Kind)
	}
}

func TestCancellationRejections_HaveDistinctKinds(t *testing.T) {
	closed, ok := apperr.As(apperr.CancellationWindowClosed("fuera de plazo"))
	if !ok || closed.Kind != apperr.KindCancellationWindowClosed {
		t.Fatalf("expected KindCancellationWindowClosed, got %+v", closed)
	}
	reason, ok := apperr.As(apperr.CancellationReasonRequired("falta el motivo"))
	if !ok || reason.Kind != apperr.KindCancellationReasonRequired {
		t.Fatalf("expected KindCancellationReasonRequired, got %+v", reason)
	}
	if closed.Kind == reason.Kind || closed.Kind == apperr.KindValidation {
		t.Fatal("the two policy rejections must stay distinct from each other and from KindValidation (HU-099)")
	}
}

func TestRescheduleRejections_HaveDistinctKinds(t *testing.T) {
	closed, ok := apperr.As(apperr.RescheduleWindowClosed("fuera de plazo"))
	if !ok || closed.Kind != apperr.KindRescheduleWindowClosed {
		t.Fatalf("expected KindRescheduleWindowClosed, got %+v", closed)
	}
	limit, ok := apperr.As(apperr.RescheduleLimitReached("sin cambios"))
	if !ok || limit.Kind != apperr.KindRescheduleLimitReached {
		t.Fatalf("expected KindRescheduleLimitReached, got %+v", limit)
	}
	if closed.Kind == limit.Kind || closed.Kind == apperr.KindCancellationWindowClosed {
		t.Fatal("the reschedule rejections must stay distinct from each other and from the cancellation ones (HU-104)")
	}
}

func TestRateLimited_CarriesRetryAfter(t *testing.T) {
	limited, ok := apperr.As(apperr.RateLimited("espera", 42))
	if !ok || limited.Kind != apperr.KindRateLimited || limited.RetryAfterSeconds != 42 {
		t.Fatalf("expected KindRateLimited with 42s, got %+v", limited)
	}
	if limited.Kind == apperr.KindChallengeRequired {
		t.Fatal("rate limiting must stay distinct from the staff phone challenge (HU-007)")
	}
}

func TestAppointmentNotAvailableAndUnavailable_KeepTheirKinds(t *testing.T) {
	if e, ok := apperr.As(apperr.AppointmentNotAvailable("x")); !ok || e.Kind != apperr.KindAppointmentNotAvailable {
		t.Fatalf("expected KindAppointmentNotAvailable, got %+v", e)
	}
	if e, ok := apperr.As(apperr.Unavailable("x")); !ok || e.Kind != apperr.KindUnavailable {
		t.Fatalf("expected KindUnavailable, got %+v", e)
	}
}
