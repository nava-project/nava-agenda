package staff_test

import (
	"context"
	"errors"
	"testing"

	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/platform/apperr"
)

// TestProfessionalLookup_Exists_KnownProfessional_ReturnsTrue confirma que
// staff.ProfessionalLookup (el puerto que HU-023/catalog consulta) delega en
// Service.Get sin necesitar más que ese único método público.
func TestProfessionalLookup_Exists_KnownProfessional_ReturnsTrue(t *testing.T) {
	repo := &fakeRepository{
		getFn: func(ctx context.Context, businessID, professionalID string) (staff.Professional, bool, error) {
			return staff.Professional{ID: professionalID, FullName: "Alguien"}, true, nil
		},
	}
	svc := staff.NewService(repo)
	lookup := staff.NewProfessionalLookup(svc)

	exists, err := lookup.Exists(context.Background(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("Exists: %v", err)
	}
	if !exists {
		t.Fatal("expected exists=true for a known professional")
	}
}

func TestProfessionalLookup_Exists_UnknownOrCrossTenantProfessional_ReturnsFalseWithoutError(t *testing.T) {
	// CA-023-04: un profesional inexistente o de otro negocio no es un error
	// de infraestructura para quien consulta este puerto, es simplemente
	// "no existe" -- Service.Get ya unifica ambos casos (RN-TEN-01).
	repo := &fakeRepository{
		getFn: func(context.Context, string, string) (staff.Professional, bool, error) {
			return staff.Professional{}, false, nil
		},
	}
	svc := staff.NewService(repo)
	lookup := staff.NewProfessionalLookup(svc)

	exists, err := lookup.Exists(context.Background(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("Exists: %v", err)
	}
	if exists {
		t.Fatal("expected exists=false for an unknown/cross-tenant professional")
	}
}

func TestProfessionalLookup_Exists_MalformedID_ReturnsFalseWithoutError(t *testing.T) {
	// Service.Get ya traduce una forma inválida al mismo apperr.NotFound
	// que "no existe" (staff/service.go); ProfessionalLookup no necesita repetir
	// esa validación.
	svc := staff.NewService(&fakeRepository{})
	lookup := staff.NewProfessionalLookup(svc)

	exists, err := lookup.Exists(context.Background(), "11111111-1111-1111-1111-111111111111", "not-a-uuid")
	if err != nil {
		t.Fatalf("Exists: %v", err)
	}
	if exists {
		t.Fatal("expected exists=false for a malformed id")
	}
}

func TestProfessionalLookup_Exists_InfrastructureError_Propagates(t *testing.T) {
	repo := &fakeRepository{
		getFn: func(context.Context, string, string) (staff.Professional, bool, error) {
			return staff.Professional{}, false, errors.New("boom")
		},
	}
	svc := staff.NewService(repo)
	lookup := staff.NewProfessionalLookup(svc)

	_, err := lookup.Exists(context.Background(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal to propagate, got %v", err)
	}
}
