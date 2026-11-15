// Pruebas de DEC-169 EN AISLAMIENTO: validación compartida con la política
// de la barbería, 404 uniforme para barberos inexistentes o mal formados y
// resolución de la ventana efectiva (propia o heredada). El aislamiento por
// tenant y la FK se prueban contra PostgreSQL real en
// postgres/barber_booking_policy_repository_test.go.
package shops_test

import (
	"context"
	"errors"
	"testing"

	"system-barbershop/internal/modules/shops"
	"system-barbershop/internal/platform/apperr"
)

const policyBarberID = "d1690000-0000-4000-8000-000000000001"

type fakeBarberPolicyRepository struct {
	own         map[string]shops.BarberBookingPolicy
	getErr      error
	upsertCalls int
	deleteCalls int
}

func (f *fakeBarberPolicyRepository) List(_ context.Context, _ string) ([]shops.BarberBookingPolicy, error) {
	out := []shops.BarberBookingPolicy{}
	for _, p := range f.own {
		out = append(out, p)
	}
	return out, nil
}

func (f *fakeBarberPolicyRepository) Get(_ context.Context, _, barberID string) (shops.BarberBookingPolicy, bool, error) {
	p, ok := f.own[barberID]
	return p, ok, f.getErr
}

func (f *fakeBarberPolicyRepository) Upsert(_ context.Context, _, barberID string, in shops.BarberBookingPolicyInput) (shops.BarberBookingPolicy, bool, error) {
	f.upsertCalls++
	if barberID != policyBarberID {
		return shops.BarberBookingPolicy{}, false, nil
	}
	p := shops.BarberBookingPolicy{BarberID: barberID, MinAdvanceMinutes: in.MinAdvanceMinutes, MaxAdvanceDays: in.MaxAdvanceDays, SlotGridMinutes: in.SlotGridMinutes}
	if f.own == nil {
		f.own = map[string]shops.BarberBookingPolicy{}
	}
	f.own[barberID] = p
	return p, true, nil
}

func (f *fakeBarberPolicyRepository) Delete(_ context.Context, _, barberID string) error {
	f.deleteCalls++
	delete(f.own, barberID)
	return nil
}

var _ shops.BarberBookingPolicyRepository = (*fakeBarberPolicyRepository)(nil)

func newBarberPolicyService(repo *fakeBarberPolicyRepository) *shops.BarberBookingPolicyService {
	shared := &fakeBookingPolicyRepository{getFound: true, getPolicy: shops.BookingPolicy{
		MinAdvanceMinutes: 60, MaxAdvanceDays: 3, SlotGridMinutes: 15, VersionToken: "tok-1",
	}}
	return shops.NewBarberBookingPolicyService(repo, shops.NewBookingPolicyService(shared))
}

func assertKind(t *testing.T, err error, kind apperr.Kind) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != kind {
		t.Fatalf("expected kind %v, got %v", kind, err)
	}
}

func TestBarberBookingPolicyPut_Valid_SavesOwnWindow(t *testing.T) {
	repo := &fakeBarberPolicyRepository{}
	svc := newBarberPolicyService(repo)

	got, err := svc.Put(context.Background(), bookingPolicyShopID, policyBarberID,
		shops.BarberBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if got.SlotGridMinutes != 40 || repo.upsertCalls != 1 {
		t.Fatalf("Put debe guardar la ventana propia: %+v calls=%d", got, repo.upsertCalls)
	}
}

func TestBarberBookingPolicyPut_InvalidInput_ReturnsValidationWithoutWriting(t *testing.T) {
	cases := map[string]shops.BarberBookingPolicyInput{
		"anticipación negativa":      {MinAdvanceMinutes: -1, MaxAdvanceDays: 3, SlotGridMinutes: 15},
		"anticipación sobre 1440":    {MinAdvanceMinutes: 1441, MaxAdvanceDays: 3, SlotGridMinutes: 15},
		"ventana de 0 días":          {MinAdvanceMinutes: 0, MaxAdvanceDays: 0, SlotGridMinutes: 15},
		"ventana sobre 90":           {MinAdvanceMinutes: 0, MaxAdvanceDays: 91, SlotGridMinutes: 15},
		"rejilla de 0":               {MinAdvanceMinutes: 0, MaxAdvanceDays: 3, SlotGridMinutes: 0},
		"rejilla sobre 60":           {MinAdvanceMinutes: 0, MaxAdvanceDays: 3, SlotGridMinutes: 61},
		"anticipación igual ventana": {MinAdvanceMinutes: 1440, MaxAdvanceDays: 1, SlotGridMinutes: 15},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			repo := &fakeBarberPolicyRepository{}
			_, err := newBarberPolicyService(repo).Put(context.Background(), bookingPolicyShopID, policyBarberID, in)
			assertKind(t, err, apperr.KindValidation)
			if repo.upsertCalls != 0 {
				t.Fatal("una entrada inválida no debe llegar al repositorio")
			}
		})
	}
}

func TestBarberBookingPolicyPut_UnknownOrMalformedBarber_ReturnsNotFound(t *testing.T) {
	repo := &fakeBarberPolicyRepository{}
	svc := newBarberPolicyService(repo)
	valid := shops.BarberBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40}

	_, err := svc.Put(context.Background(), bookingPolicyShopID, "no-es-un-uuid", valid)
	assertKind(t, err, apperr.KindNotFound)
	if repo.upsertCalls != 0 {
		t.Fatal("un identificador mal formado no debe llegar al repositorio")
	}

	_, err = svc.Put(context.Background(), bookingPolicyShopID, "d1690000-0000-4000-8000-0000000000ff", valid)
	assertKind(t, err, apperr.KindNotFound)
}

func TestBarberBookingPolicyDelete_MalformedBarber_ReturnsNotFound(t *testing.T) {
	repo := &fakeBarberPolicyRepository{}
	err := newBarberPolicyService(repo).Delete(context.Background(), bookingPolicyShopID, "x")
	assertKind(t, err, apperr.KindNotFound)
	if repo.deleteCalls != 0 {
		t.Fatal("un identificador mal formado no debe llegar al repositorio")
	}
}

func TestBarberBookingPolicyEffective_OwnOrInherited(t *testing.T) {
	repo := &fakeBarberPolicyRepository{own: map[string]shops.BarberBookingPolicy{
		policyBarberID: {BarberID: policyBarberID, MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40},
	}}
	svc := newBarberPolicyService(repo)

	minA, maxD, grid, err := svc.Effective(context.Background(), bookingPolicyShopID, policyBarberID)
	if err != nil || minA != 30 || maxD != 7 || grid != 40 {
		t.Fatalf("con ventana propia debe usarla: %d %d %d %v", minA, maxD, grid, err)
	}

	minA, maxD, grid, err = svc.Effective(context.Background(), bookingPolicyShopID, "d1690000-0000-4000-8000-000000000002")
	if err != nil || minA != 60 || maxD != 3 || grid != 15 {
		t.Fatalf("sin ventana propia debe heredar la de la barbería: %d %d %d %v", minA, maxD, grid, err)
	}

	// Quitarla vuelve a heredar.
	if err := svc.Delete(context.Background(), bookingPolicyShopID, policyBarberID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, _, grid, _ := svc.Effective(context.Background(), bookingPolicyShopID, policyBarberID); grid != 15 {
		t.Fatalf("tras quitarla debe heredar la rejilla de la barbería, got %d", grid)
	}
}

func TestBarberBookingPolicyEffective_RepositoryError_ReturnsInternal(t *testing.T) {
	repo := &fakeBarberPolicyRepository{getErr: errors.New("boom")}
	_, _, _, err := newBarberPolicyService(repo).Effective(context.Background(), bookingPolicyShopID, policyBarberID)
	assertKind(t, err, apperr.KindInternal)
}
