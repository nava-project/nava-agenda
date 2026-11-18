// Pruebas de DEC-169 EN AISLAMIENTO: validación compartida con la política
// del negocio, 404 uniforme para profesionales inexistentes o mal formados y
// resolución de la ventana efectiva (propia o heredada). El aislamiento por
// tenant y la FK se prueban contra PostgreSQL real en
// postgres/professional_booking_policy_repository_test.go.
package shops_test

import (
	"context"
	"errors"
	"testing"

	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/apperr"
)

const policyProfessionalID = "d1690000-0000-4000-8000-000000000001"

type fakeProfessionalPolicyRepository struct {
	own         map[string]shops.ProfessionalBookingPolicy
	getErr      error
	upsertCalls int
	deleteCalls int
}

func (f *fakeProfessionalPolicyRepository) List(_ context.Context, _ string) ([]shops.ProfessionalBookingPolicy, error) {
	out := []shops.ProfessionalBookingPolicy{}
	for _, p := range f.own {
		out = append(out, p)
	}
	return out, nil
}

func (f *fakeProfessionalPolicyRepository) Get(_ context.Context, _, professionalID string) (shops.ProfessionalBookingPolicy, bool, error) {
	p, ok := f.own[professionalID]
	return p, ok, f.getErr
}

func (f *fakeProfessionalPolicyRepository) Upsert(_ context.Context, _, professionalID string, in shops.ProfessionalBookingPolicyInput) (shops.ProfessionalBookingPolicy, bool, error) {
	f.upsertCalls++
	if professionalID != policyProfessionalID {
		return shops.ProfessionalBookingPolicy{}, false, nil
	}
	p := shops.ProfessionalBookingPolicy{ProfessionalID: professionalID, MinAdvanceMinutes: in.MinAdvanceMinutes, MaxAdvanceDays: in.MaxAdvanceDays, SlotGridMinutes: in.SlotGridMinutes}
	if f.own == nil {
		f.own = map[string]shops.ProfessionalBookingPolicy{}
	}
	f.own[professionalID] = p
	return p, true, nil
}

func (f *fakeProfessionalPolicyRepository) Delete(_ context.Context, _, professionalID string) error {
	f.deleteCalls++
	delete(f.own, professionalID)
	return nil
}

var _ shops.ProfessionalBookingPolicyRepository = (*fakeProfessionalPolicyRepository)(nil)

func newProfessionalPolicyService(repo *fakeProfessionalPolicyRepository) *shops.ProfessionalBookingPolicyService {
	shared := &fakeBookingPolicyRepository{getFound: true, getPolicy: shops.BookingPolicy{
		MinAdvanceMinutes: 60, MaxAdvanceDays: 3, SlotGridMinutes: 15, VersionToken: "tok-1",
	}}
	return shops.NewProfessionalBookingPolicyService(repo, shops.NewBookingPolicyService(shared))
}

func assertKind(t *testing.T, err error, kind apperr.Kind) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != kind {
		t.Fatalf("expected kind %v, got %v", kind, err)
	}
}

func TestProfessionalBookingPolicyPut_Valid_SavesOwnWindow(t *testing.T) {
	repo := &fakeProfessionalPolicyRepository{}
	svc := newProfessionalPolicyService(repo)

	got, err := svc.Put(context.Background(), bookingPolicyShopID, policyProfessionalID,
		shops.ProfessionalBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if got.SlotGridMinutes != 40 || repo.upsertCalls != 1 {
		t.Fatalf("Put debe guardar la ventana propia: %+v calls=%d", got, repo.upsertCalls)
	}
}

func TestProfessionalBookingPolicyPut_InvalidInput_ReturnsValidationWithoutWriting(t *testing.T) {
	cases := map[string]shops.ProfessionalBookingPolicyInput{
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
			repo := &fakeProfessionalPolicyRepository{}
			_, err := newProfessionalPolicyService(repo).Put(context.Background(), bookingPolicyShopID, policyProfessionalID, in)
			assertKind(t, err, apperr.KindValidation)
			if repo.upsertCalls != 0 {
				t.Fatal("una entrada inválida no debe llegar al repositorio")
			}
		})
	}
}

func TestProfessionalBookingPolicyPut_UnknownOrMalformedProfessional_ReturnsNotFound(t *testing.T) {
	repo := &fakeProfessionalPolicyRepository{}
	svc := newProfessionalPolicyService(repo)
	valid := shops.ProfessionalBookingPolicyInput{MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40}

	_, err := svc.Put(context.Background(), bookingPolicyShopID, "no-es-un-uuid", valid)
	assertKind(t, err, apperr.KindNotFound)
	if repo.upsertCalls != 0 {
		t.Fatal("un identificador mal formado no debe llegar al repositorio")
	}

	_, err = svc.Put(context.Background(), bookingPolicyShopID, "d1690000-0000-4000-8000-0000000000ff", valid)
	assertKind(t, err, apperr.KindNotFound)
}

func TestProfessionalBookingPolicyDelete_MalformedProfessional_ReturnsNotFound(t *testing.T) {
	repo := &fakeProfessionalPolicyRepository{}
	err := newProfessionalPolicyService(repo).Delete(context.Background(), bookingPolicyShopID, "x")
	assertKind(t, err, apperr.KindNotFound)
	if repo.deleteCalls != 0 {
		t.Fatal("un identificador mal formado no debe llegar al repositorio")
	}
}

func TestProfessionalBookingPolicyEffective_OwnOrInherited(t *testing.T) {
	repo := &fakeProfessionalPolicyRepository{own: map[string]shops.ProfessionalBookingPolicy{
		policyProfessionalID: {ProfessionalID: policyProfessionalID, MinAdvanceMinutes: 30, MaxAdvanceDays: 7, SlotGridMinutes: 40},
	}}
	svc := newProfessionalPolicyService(repo)

	minA, maxD, grid, err := svc.Effective(context.Background(), bookingPolicyShopID, policyProfessionalID)
	if err != nil || minA != 30 || maxD != 7 || grid != 40 {
		t.Fatalf("con ventana propia debe usarla: %d %d %d %v", minA, maxD, grid, err)
	}

	minA, maxD, grid, err = svc.Effective(context.Background(), bookingPolicyShopID, "d1690000-0000-4000-8000-000000000002")
	if err != nil || minA != 60 || maxD != 3 || grid != 15 {
		t.Fatalf("sin ventana propia debe heredar la del negocio: %d %d %d %v", minA, maxD, grid, err)
	}

	// Quitarla vuelve a heredar.
	if err := svc.Delete(context.Background(), bookingPolicyShopID, policyProfessionalID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, _, grid, _ := svc.Effective(context.Background(), bookingPolicyShopID, policyProfessionalID); grid != 15 {
		t.Fatalf("tras quitarla debe heredar la rejilla del negocio, got %d", grid)
	}
}

func TestProfessionalBookingPolicyEffective_RepositoryError_ReturnsInternal(t *testing.T) {
	repo := &fakeProfessionalPolicyRepository{getErr: errors.New("boom")}
	_, _, _, err := newProfessionalPolicyService(repo).Effective(context.Background(), bookingPolicyShopID, policyProfessionalID)
	assertKind(t, err, apperr.KindInternal)
}
