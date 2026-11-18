package booking_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// DEC-178, punto 2: el mismo plazo que la cancelación, inclusive, sin
// reprogramación tardía y nunca con plazo 0.
func TestCustomerReschedulePolicy_Evaluate(t *testing.T) {
	startsAt := time.Date(2026, 11, 20, 15, 0, 0, 0, time.UTC)
	limit := startsAt.Add(-20 * time.Minute)
	cases := []struct {
		name     string
		deadline int
		now      time.Time
		ok       bool
	}{
		{"antes del límite", 20, limit.Add(-time.Hour), true},
		{"exactamente en el límite", 20, limit, true},
		{"un instante después del límite", 20, limit.Add(time.Nanosecond), false},
		{"turno ya iniciado", 20, startsAt, false},
		{"plazo 0 nunca permite", 0, startsAt.Add(-72 * time.Hour), false},
		{"plazo máximo de 7 días", 10080, startsAt.Add(-10080 * time.Minute), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := booking.CustomerReschedulePolicy{DeadlineMinutes: tc.deadline}.Evaluate(startsAt, tc.now)
			if tc.ok && err != nil {
				t.Fatalf("esperaba éxito, obtuvo %v", err)
			}
			if !tc.ok {
				assertKind(t, err, apperr.KindRescheduleWindowClosed)
			}
		})
	}
}

// DEC-178, punto 3: máximo dos reprogramaciones del cliente.
func TestCustomerRescheduleCount(t *testing.T) {
	for done, want := range []int{2, 1, 0, 0} {
		if got := booking.CustomerRescheduleRemaining(done); got != want {
			t.Fatalf("CustomerRescheduleRemaining(%d) = %d, quiero %d", done, got, want)
		}
	}
	if err := booking.EvaluateCustomerRescheduleCount(1); err != nil {
		t.Fatalf("con una hecha todavía se puede: %v", err)
	}
	assertKind(t, booking.EvaluateCustomerRescheduleCount(2), apperr.KindRescheduleLimitReached)
}

type fakeCustomerRescheduleRepo struct {
	state booking.CustomerRescheduleState
	found bool
	calls int
	last  booking.RescheduleAppointmentByCustomerInput
}

func (f *fakeCustomerRescheduleRepo) CustomerRescheduleState(context.Context, string, string) (booking.CustomerRescheduleState, bool, error) {
	return f.state, f.found, nil
}

func (f *fakeCustomerRescheduleRepo) RescheduleByCustomer(
	_ context.Context, _ string, input booking.RescheduleAppointmentByCustomerInput, _ idempotency.Key, _ idempotency.Fingerprint,
) (booking.RescheduleByCustomerResult, error) {
	f.calls++
	f.last = input
	return booking.RescheduleByCustomerResult{Decision: idempotency.Decision{Outcome: idempotency.OutcomeProceed}}, nil
}

type fakeRescheduleSlots struct {
	starts           []time.Time
	calls            int
	ownStart, ownEnd time.Time
	professionalID   string
	durationMinutes  int
}

func (f *fakeRescheduleSlots) OfferedRescheduleStarts(_ context.Context, _, professionalID string, duration int, ownStart, ownEnd time.Time) ([]time.Time, error) {
	f.calls++
	f.professionalID, f.durationMinutes, f.ownStart, f.ownEnd = professionalID, duration, ownStart, ownEnd
	return f.starts, nil
}

const customerRescheduleAppointmentID = "11111111-2222-3333-4444-555555555555"

func newCustomerRescheduleService(t *testing.T) (*booking.RescheduleAppointmentByCustomerService, *fakeCustomerRescheduleRepo, *fakeRescheduleSlots, time.Time) {
	t.Helper()
	startsAt := time.Date(2026, 11, 20, 15, 0, 0, 0, time.UTC)
	now := startsAt.Add(-24 * time.Hour)
	repo := &fakeCustomerRescheduleRepo{found: true, state: booking.CustomerRescheduleState{
		ProfessionalID: "professional-1", DurationMinutes: 45, StartsAt: startsAt, EndsAt: startsAt.Add(45 * time.Minute),
		Status: booking.StatusConfirmed, DeadlineMinutes: 20,
	}}
	slots := &fakeRescheduleSlots{starts: []time.Time{startsAt.Add(2 * time.Hour)}}
	svc := booking.NewRescheduleAppointmentByCustomerService(repo, slots, func() time.Time { return now })
	return svc, repo, slots, startsAt
}

func TestRescheduleAppointmentByCustomer_OfferedSlot_DelegatesWithDerivedEnd(t *testing.T) {
	svc, repo, slots, startsAt := newCustomerRescheduleService(t)
	target := startsAt.Add(2 * time.Hour)

	_, err := svc.RescheduleAppointmentByCustomer(context.Background(), "shop-1", customerRescheduleAppointmentID,
		target.Format(time.RFC3339), " v1 ", idempotency.Key("k"), idempotency.Fingerprint("f"))
	if err != nil {
		t.Fatalf("RescheduleAppointmentByCustomer: %v", err)
	}
	if repo.calls != 1 || !repo.last.NewStartsAt.Equal(target) || !repo.last.NewEndsAt.Equal(target.Add(45*time.Minute)) ||
		repo.last.ExpectedVersionToken != "v1" || !repo.last.Now.Equal(startsAt.Add(-24*time.Hour)) {
		t.Fatalf("entrada al repositorio = %+v", repo.last)
	}
	if slots.professionalID != "professional-1" || slots.durationMinutes != 45 || !slots.ownStart.Equal(startsAt) {
		t.Fatalf("las franjas se piden para el mismo profesional, duración y turno propio: %+v", slots)
	}
}

func TestRescheduleAppointmentByCustomer_Rejections(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*fakeCustomerRescheduleRepo, *fakeRescheduleSlots)
		start  func(time.Time) string
		kind   apperr.Kind
	}{
		{"franja no ofrecida", func(*fakeCustomerRescheduleRepo, *fakeRescheduleSlots) {}, func(s time.Time) string { return s.Add(3 * time.Hour).Format(time.RFC3339) }, apperr.KindScheduleConflict},
		{"inicio sin formato", func(*fakeCustomerRescheduleRepo, *fakeRescheduleSlots) {}, func(time.Time) string { return "mañana" }, apperr.KindValidation},
		{"turno no confirmado", func(r *fakeCustomerRescheduleRepo, _ *fakeRescheduleSlots) { r.state.Status = booking.StatusCompleted }, nil, apperr.KindInvalidState},
		{"fuera de plazo antes que la franja", func(r *fakeCustomerRescheduleRepo, _ *fakeRescheduleSlots) { r.state.DeadlineMinutes = 0 }, func(s time.Time) string { return s.Add(3 * time.Hour).Format(time.RFC3339) }, apperr.KindRescheduleWindowClosed},
		{"límite alcanzado", func(r *fakeCustomerRescheduleRepo, _ *fakeRescheduleSlots) { r.state.CustomerReschedules = 2 }, nil, apperr.KindRescheduleLimitReached},
		{"turno inexistente", func(r *fakeCustomerRescheduleRepo, _ *fakeRescheduleSlots) { r.found = false }, nil, apperr.KindNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, repo, slots, startsAt := newCustomerRescheduleService(t)
			tc.mutate(repo, slots)
			start := startsAt.Add(2 * time.Hour).Format(time.RFC3339)
			if tc.start != nil {
				start = tc.start(startsAt)
			}
			_, err := svc.RescheduleAppointmentByCustomer(context.Background(), "shop-1", customerRescheduleAppointmentID,
				start, "v1", idempotency.Key("k"), idempotency.Fingerprint("f"))
			assertKind(t, err, tc.kind)
			if repo.calls != 0 {
				t.Fatal("un rechazo previo no llega al repositorio")
			}
		})
	}
}

func TestListRescheduleStarts_NotConfirmedReturnsEmpty(t *testing.T) {
	svc, repo, slots, _ := newCustomerRescheduleService(t)
	repo.state.Status = booking.StatusCancelledByCustomer
	starts, err := svc.ListRescheduleStarts(context.Background(), "shop-1", customerRescheduleAppointmentID)
	if err != nil || len(starts) != 0 || slots.calls != 0 {
		t.Fatalf("starts=%v err=%v calls=%d", starts, err, slots.calls)
	}
}
