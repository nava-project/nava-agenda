package staff_test

import (
	"context"
	"errors"
	"testing"

	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/platform/apperr"
)

// TestProfessionalNameLookup_Name_KnownProfessional_ReturnsFullName confirma que
// staff.ProfessionalNameLookup (el puerto que HU-064/booking consulta) delega en
// Service.Get sin necesitar más que ese único método público, mismo
// criterio que ProfessionalLookup.Exists.
func TestProfessionalNameLookup_Name_KnownProfessional_ReturnsFullName(t *testing.T) {
	repo := &fakeRepository{
		getFn: func(ctx context.Context, businessID, professionalID string) (staff.Professional, bool, error) {
			return staff.Professional{ID: professionalID, FullName: "Ana Gómez"}, true, nil
		},
	}
	svc := staff.NewService(repo)
	lookup := staff.NewProfessionalNameLookup(svc)

	name, found, err := lookup.Name(context.Background(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("Name: %v", err)
	}
	if !found || name != "Ana Gómez" {
		t.Fatalf("Name = %q, found = %v, want %q/true", name, found, "Ana Gómez")
	}
}

func TestProfessionalNameLookup_Name_UnknownOrCrossTenantProfessional_ReturnsFoundFalseWithoutError(t *testing.T) {
	repo := &fakeRepository{
		getFn: func(context.Context, string, string) (staff.Professional, bool, error) {
			return staff.Professional{}, false, nil
		},
	}
	svc := staff.NewService(repo)
	lookup := staff.NewProfessionalNameLookup(svc)

	name, found, err := lookup.Name(context.Background(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("Name: %v", err)
	}
	if found || name != "" {
		t.Fatalf("Name = %q, found = %v, want vacío/false", name, found)
	}
}

func TestProfessionalNameLookup_Name_InfrastructureError_Propagates(t *testing.T) {
	repo := &fakeRepository{
		getFn: func(context.Context, string, string) (staff.Professional, bool, error) {
			return staff.Professional{}, false, errors.New("boom")
		},
	}
	svc := staff.NewService(repo)
	lookup := staff.NewProfessionalNameLookup(svc)

	_, _, err := lookup.Name(context.Background(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal to propagate, got %v", err)
	}
}
