package catalog_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"nava-agenda/internal/modules/catalog"
	"nava-agenda/internal/platform/apperr"
)

// fakeAssignmentRepository es un doble de catalog.AssignmentRepository:
// prueba solo la orquestación de catalog.AssignmentService (validación de
// forma, consulta al puerto de profesional ANTES de tocar el repositorio,
// traducción de Outcome a apperr), nunca SQL ni RLS (eso vive en
// postgres/assignment_repository_test.go contra PostgreSQL real).
type fakeAssignmentRepository struct {
	listFn     func(ctx context.Context, businessID, professionalID string, cursor *catalog.Cursor, limit int) (catalog.AssignmentListResult, error)
	assignFn   func(ctx context.Context, businessID, professionalID, serviceID string) (catalog.AssignResult, error)
	unassignFn func(ctx context.Context, businessID, professionalID, serviceID string) (catalog.UnassignResult, error)
	existsFn   func(ctx context.Context, businessID, professionalID, serviceID string) (bool, error)

	assignCalls   int
	unassignCalls int
}

func (f *fakeAssignmentRepository) Exists(ctx context.Context, businessID, professionalID, serviceID string) (bool, error) {
	if f.existsFn == nil {
		return false, nil
	}
	return f.existsFn(ctx, businessID, professionalID, serviceID)
}

func (f *fakeAssignmentRepository) List(ctx context.Context, businessID, professionalID string, cursor *catalog.Cursor, limit int) (catalog.AssignmentListResult, error) {
	return f.listFn(ctx, businessID, professionalID, cursor, limit)
}

func (f *fakeAssignmentRepository) Assign(ctx context.Context, businessID, professionalID, serviceID string) (catalog.AssignResult, error) {
	f.assignCalls++
	return f.assignFn(ctx, businessID, professionalID, serviceID)
}

func (f *fakeAssignmentRepository) Unassign(ctx context.Context, businessID, professionalID, serviceID string) (catalog.UnassignResult, error) {
	f.unassignCalls++
	return f.unassignFn(ctx, businessID, professionalID, serviceID)
}

var _ catalog.AssignmentRepository = (*fakeAssignmentRepository)(nil)

// fakeProfessionalPort es un doble de catalog.ProfessionalPort: nunca toca staff ni
// PostgreSQL.
type fakeProfessionalPort struct {
	existsFn func(ctx context.Context, businessID, professionalID string) (bool, error)
	calls    int
}

func (f *fakeProfessionalPort) Exists(ctx context.Context, businessID, professionalID string) (bool, error) {
	f.calls++
	return f.existsFn(ctx, businessID, professionalID)
}

var _ catalog.ProfessionalPort = (*fakeProfessionalPort)(nil)

const (
	fakeShop         = "11111111-1111-1111-1111-111111111111"
	fakeProfessional = "22222222-2222-2222-2222-222222222222"
	fakeService      = "33333333-3333-3333-3333-333333333333"
)

func alwaysExists() *fakeProfessionalPort {
	return &fakeProfessionalPort{existsFn: func(context.Context, string, string) (bool, error) { return true, nil }}
}

// --- List -------------------------------------------------------------

func TestAssignmentService_List_UnknownProfessionalID_NotFoundWithoutTouchingRepository(t *testing.T) {
	repo := &fakeAssignmentRepository{}
	professionals := &fakeProfessionalPort{existsFn: func(context.Context, string, string) (bool, error) { return false, nil }}
	svc := catalog.NewAssignmentService(repo, professionals)

	_, err := svc.List(context.Background(), fakeShop, fakeProfessional, "", 0)
	mustBeNotFound(t, err)
	if professionals.calls != 1 {
		t.Fatalf("expected exactly one ProfessionalPort.Exists call, got %d", professionals.calls)
	}
}

func TestAssignmentService_List_MalformedProfessionalID_NotFoundWithoutCallingPort(t *testing.T) {
	repo := &fakeAssignmentRepository{}
	professionals := &fakeProfessionalPort{existsFn: func(context.Context, string, string) (bool, error) {
		t.Fatal("ProfessionalPort.Exists should not be called for a malformed id")
		return false, nil
	}}
	svc := catalog.NewAssignmentService(repo, professionals)

	_, err := svc.List(context.Background(), fakeShop, "not-a-uuid", "", 0)
	mustBeNotFound(t, err)
}

func TestAssignmentService_List_KnownProfessional_ReturnsRepositoryResult(t *testing.T) {
	want := catalog.AssignmentListResult{
		Items: []catalog.Assignment{{ProfessionalID: fakeProfessional, ServiceID: fakeService, CreatedAt: time.Now()}},
	}
	repo := &fakeAssignmentRepository{
		listFn: func(ctx context.Context, businessID, professionalID string, cursor *catalog.Cursor, limit int) (catalog.AssignmentListResult, error) {
			if businessID != fakeShop || professionalID != fakeProfessional {
				t.Fatalf("unexpected args: %s %s", businessID, professionalID)
			}
			return want, nil
		},
	}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	got, err := svc.List(context.Background(), fakeShop, fakeProfessional, "", 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].ServiceID != fakeService {
		t.Fatalf("unexpected result: %+v", got)
	}
}

// --- Assign -------------------------------------------------------------

func TestAssignmentService_Assign_MalformedProfessionalID_NotFoundWithoutCallingPortOrRepo(t *testing.T) {
	repo := &fakeAssignmentRepository{}
	professionals := &fakeProfessionalPort{existsFn: func(context.Context, string, string) (bool, error) {
		t.Fatal("ProfessionalPort.Exists should not be called for a malformed id")
		return false, nil
	}}
	svc := catalog.NewAssignmentService(repo, professionals)

	_, err := svc.Assign(context.Background(), fakeShop, "not-a-uuid", fakeService)
	mustBeNotFound(t, err)
	if repo.assignCalls != 0 {
		t.Fatalf("expected Repository.Assign never called, got %d calls", repo.assignCalls)
	}
}

func TestAssignmentService_Assign_MalformedServiceID_NotFoundWithoutCallingPortOrRepo(t *testing.T) {
	repo := &fakeAssignmentRepository{}
	professionals := &fakeProfessionalPort{existsFn: func(context.Context, string, string) (bool, error) {
		t.Fatal("ProfessionalPort.Exists should not be called when serviceID is already malformed")
		return false, nil
	}}
	svc := catalog.NewAssignmentService(repo, professionals)

	_, err := svc.Assign(context.Background(), fakeShop, fakeProfessional, "not-a-uuid")
	mustBeNotFound(t, err)
	if repo.assignCalls != 0 {
		t.Fatalf("expected Repository.Assign never called, got %d calls", repo.assignCalls)
	}
}

func TestAssignmentService_Assign_UnknownProfessional_NotFoundWithoutTouchingRepository(t *testing.T) {
	repo := &fakeAssignmentRepository{}
	professionals := &fakeProfessionalPort{existsFn: func(context.Context, string, string) (bool, error) { return false, nil }}
	svc := catalog.NewAssignmentService(repo, professionals)

	_, err := svc.Assign(context.Background(), fakeShop, fakeProfessional, fakeService)
	mustBeNotFound(t, err)
	if repo.assignCalls != 0 {
		t.Fatalf("expected Repository.Assign never called when the professional does not exist, got %d calls", repo.assignCalls)
	}
}

func TestAssignmentService_Assign_UnknownService_NotFound(t *testing.T) {
	repo := &fakeAssignmentRepository{
		assignFn: func(context.Context, string, string, string) (catalog.AssignResult, error) {
			return catalog.AssignResult{Outcome: catalog.AssignOutcomeServiceNotFound}, nil
		},
	}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	_, err := svc.Assign(context.Background(), fakeShop, fakeProfessional, fakeService)
	mustBeNotFound(t, err)
}

func TestAssignmentService_Assign_New_ReturnsCreated(t *testing.T) {
	want := catalog.Assignment{ProfessionalID: fakeProfessional, ServiceID: fakeService, CreatedAt: time.Now()}
	repo := &fakeAssignmentRepository{
		assignFn: func(context.Context, string, string, string) (catalog.AssignResult, error) {
			return catalog.AssignResult{Outcome: catalog.AssignOutcomeCreated, Assignment: want}, nil
		},
	}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	got, err := svc.Assign(context.Background(), fakeShop, fakeProfessional, fakeService)
	if err != nil {
		t.Fatalf("Assign: %v", err)
	}
	if got.Outcome != catalog.AssignOutcomeCreated || got.Assignment.ServiceID != fakeService {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestAssignmentService_Assign_Repeated_ReturnsAlreadyExistsWithoutError(t *testing.T) {
	// CA-023-02: repetir exactamente la misma operación no crea una segunda
	// fila; el resultado sigue siendo un éxito, no un conflicto.
	repo := &fakeAssignmentRepository{
		assignFn: func(context.Context, string, string, string) (catalog.AssignResult, error) {
			return catalog.AssignResult{Outcome: catalog.AssignOutcomeAlreadyExists}, nil
		},
	}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	got, err := svc.Assign(context.Background(), fakeShop, fakeProfessional, fakeService)
	if err != nil {
		t.Fatalf("Assign: %v", err)
	}
	if got.Outcome != catalog.AssignOutcomeAlreadyExists {
		t.Fatalf("expected AssignOutcomeAlreadyExists, got %v", got.Outcome)
	}
}

func TestAssignmentService_Assign_RepositoryError_WrapsAsInternal(t *testing.T) {
	repo := &fakeAssignmentRepository{
		assignFn: func(context.Context, string, string, string) (catalog.AssignResult, error) {
			return catalog.AssignResult{}, errors.New("boom")
		},
	}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	_, err := svc.Assign(context.Background(), fakeShop, fakeProfessional, fakeService)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
}

// --- Unassign -----------------------------------------------------------

func TestAssignmentService_Unassign_MalformedIDs_NotFoundWithoutTouchingRepository(t *testing.T) {
	repo := &fakeAssignmentRepository{}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	_, err := svc.Unassign(context.Background(), fakeShop, "not-a-uuid", fakeService)
	mustBeNotFound(t, err)
	if repo.unassignCalls != 0 {
		t.Fatalf("expected Repository.Unassign never called, got %d calls", repo.unassignCalls)
	}
}

func TestAssignmentService_Unassign_NoSuchAssignment_NotFound(t *testing.T) {
	repo := &fakeAssignmentRepository{
		unassignFn: func(context.Context, string, string, string) (catalog.UnassignResult, error) {
			return catalog.UnassignResult{Outcome: catalog.UnassignOutcomeNotFound}, nil
		},
	}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	_, err := svc.Unassign(context.Background(), fakeShop, fakeProfessional, fakeService)
	mustBeNotFound(t, err)
}

func TestAssignmentService_Unassign_Deleted_Succeeds(t *testing.T) {
	repo := &fakeAssignmentRepository{
		unassignFn: func(context.Context, string, string, string) (catalog.UnassignResult, error) {
			return catalog.UnassignResult{Outcome: catalog.UnassignOutcomeDeleted}, nil
		},
	}
	svc := catalog.NewAssignmentService(repo, alwaysExists())

	got, err := svc.Unassign(context.Background(), fakeShop, fakeProfessional, fakeService)
	if err != nil {
		t.Fatalf("Unassign: %v", err)
	}
	if got.Outcome != catalog.UnassignOutcomeDeleted {
		t.Fatalf("expected UnassignOutcomeDeleted, got %v", got.Outcome)
	}
}

func TestAssignmentService_Unassign_DoesNotConsultProfessionalPort(t *testing.T) {
	// A diferencia de List/Assign, Unassign descubre un profesional ajeno o
	// inexistente por la ausencia de la fila de asociación (Repository ya
	// lo traduce a UnassignOutcomeNotFound): no necesita ProfessionalPort.
	repo := &fakeAssignmentRepository{
		unassignFn: func(context.Context, string, string, string) (catalog.UnassignResult, error) {
			return catalog.UnassignResult{Outcome: catalog.UnassignOutcomeDeleted}, nil
		},
	}
	professionals := &fakeProfessionalPort{existsFn: func(context.Context, string, string) (bool, error) {
		t.Fatal("ProfessionalPort.Exists should not be called by Unassign")
		return false, nil
	}}
	svc := catalog.NewAssignmentService(repo, professionals)

	if _, err := svc.Unassign(context.Background(), fakeShop, fakeProfessional, fakeService); err != nil {
		t.Fatalf("Unassign: %v", err)
	}
}
