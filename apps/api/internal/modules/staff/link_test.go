package staff_test

import (
	"context"
	"errors"
	"testing"

	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/platform/apperr"
)

const (
	linkShop         = "11111111-1111-1111-1111-111111111111"
	linkUserID       = "aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaa2"
	linkProfessional = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"
)

type recordingObserver struct {
	released []string
}

func (o *recordingObserver) ProfessionalLinkReleased(_ context.Context, _ string, professionalID string) {
	o.released = append(o.released, professionalID)
}

func requireKind(t *testing.T, err error, want apperr.Kind) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != want {
		t.Fatalf("expected apperr kind %q, got %v", want, err)
	}
}

// Sin vínculo no es un error (DEC-192): el servicio responde found=false sin fallo.
func TestLinkedProfessional_WithoutLink_IsNotFoundButNoError(t *testing.T) {
	repo := &fakeRepository{getLinkedFn: func(context.Context, string, string) (staff.Professional, bool, error) {
		return staff.Professional{}, false, nil
	}}
	_, found, err := staff.NewService(repo).LinkedProfessional(context.Background(), linkShop, linkUserID)
	if err != nil || found {
		t.Fatalf("expected found=false without error, got found=%v err=%v", found, err)
	}
}

func TestLinkedProfessional_ReturnsTheUsersProfessional(t *testing.T) {
	repo := &fakeRepository{getLinkedFn: func(_ context.Context, shop, user string) (staff.Professional, bool, error) {
		if shop != linkShop || user != linkUserID {
			t.Fatalf("la consulta debe usar el principal, recibió %q/%q", shop, user)
		}
		return staff.Professional{ID: linkProfessional, FullName: "Carlos"}, true, nil
	}}
	professional, found, err := staff.NewService(repo).LinkedProfessional(context.Background(), linkShop, linkUserID)
	if err != nil || !found || professional.ID != linkProfessional {
		t.Fatalf("expected the linked professional, got %+v, %v", professional, err)
	}
}

func TestLinkMyProfessional_InvalidID_NeverReachesRepository(t *testing.T) {
	repo := &fakeRepository{linkFn: func(context.Context, string, string, string) (staff.LinkResult, error) {
		t.Fatal("un identificador inválido no debe llegar al repositorio")
		return staff.LinkResult{}, nil
	}}
	_, err := staff.NewService(repo).LinkMyProfessional(context.Background(), linkShop, linkUserID, "no-es-uuid")
	requireKind(t, err, apperr.KindNotFound)
}

func TestLinkMyProfessional_UnknownOrForeignProfessional_IsNotFound(t *testing.T) {
	repo := &fakeRepository{linkFn: func(context.Context, string, string, string) (staff.LinkResult, error) {
		return staff.LinkResult{Found: false}, nil
	}}
	_, err := staff.NewService(repo).LinkMyProfessional(context.Background(), linkShop, linkUserID, linkProfessional)
	requireKind(t, err, apperr.KindNotFound)
}

func TestLinkMyProfessional_TakenByAnotherUser_IsConflictAndNotifiesNobody(t *testing.T) {
	repo := &fakeRepository{linkFn: func(context.Context, string, string, string) (staff.LinkResult, error) {
		return staff.LinkResult{Found: true, Taken: true, ReleasedProfessionalID: "no-debe-avisar"}, nil
	}}
	service := staff.NewService(repo)
	observer := &recordingObserver{}
	service.ObserveLinkReleased(observer)

	_, err := service.LinkMyProfessional(context.Background(), linkShop, linkUserID, linkProfessional)
	requireKind(t, err, apperr.KindConflict)
	if len(observer.released) != 0 {
		t.Fatalf("un conflicto no libera nada, pero avisó %v", observer.released)
	}
}

func TestLinkMyProfessional_Success_NotifiesPreviousProfessionalRelease(t *testing.T) {
	repo := &fakeRepository{linkFn: func(_ context.Context, shop, user, professional string) (staff.LinkResult, error) {
		if shop != linkShop || user != linkUserID || professional != linkProfessional {
			t.Fatalf("argumentos inesperados %q/%q/%q", shop, user, professional)
		}
		return staff.LinkResult{
			Found:                  true,
			Professional:           staff.Professional{ID: linkProfessional, FullName: "Carlos"},
			ReleasedProfessionalID: "previous-professional",
		}, nil
	}}
	service := staff.NewService(repo)
	observer := &recordingObserver{}
	service.ObserveLinkReleased(observer)

	professional, err := service.LinkMyProfessional(context.Background(), linkShop, linkUserID, linkProfessional)
	if err != nil || professional.ID != linkProfessional {
		t.Fatalf("expected the new professional, got %+v, %v", professional, err)
	}
	if len(observer.released) != 1 || observer.released[0] != "previous-professional" {
		t.Fatalf("expected one release notice for the previous professional, got %v", observer.released)
	}
}

func TestLinkMyProfessional_SameProfessionalAgain_IsIdempotentWithoutNotice(t *testing.T) {
	repo := &fakeRepository{linkFn: func(context.Context, string, string, string) (staff.LinkResult, error) {
		return staff.LinkResult{Found: true, Professional: staff.Professional{ID: linkProfessional}}, nil
	}}
	service := staff.NewService(repo)
	observer := &recordingObserver{}
	service.ObserveLinkReleased(observer)

	if _, err := service.LinkMyProfessional(context.Background(), linkShop, linkUserID, linkProfessional); err != nil {
		t.Fatalf("repetir la selección debe ser un éxito: %v", err)
	}
	if len(observer.released) != 0 {
		t.Fatalf("repetir la selección no libera nada, avisó %v", observer.released)
	}
}

func TestUnlinkMyProfessional_NotifiesOnlyWhenSomethingWasReleased(t *testing.T) {
	for name, released := range map[string]string{"con vínculo": linkProfessional, "sin vínculo": ""} {
		t.Run(name, func(t *testing.T) {
			repo := &fakeRepository{unlinkFn: func(context.Context, string, string) (string, error) { return released, nil }}
			service := staff.NewService(repo)
			observer := &recordingObserver{}
			service.ObserveLinkReleased(observer)

			if err := service.UnlinkMyProfessional(context.Background(), linkShop, linkUserID); err != nil {
				t.Fatalf("quitar el vínculo es idempotente: %v", err)
			}
			wantNotices := 0
			if released != "" {
				wantNotices = 1
			}
			if len(observer.released) != wantNotices {
				t.Fatalf("expected %d notices, got %v", wantNotices, observer.released)
			}
		})
	}
}

func TestLinkOperations_RepositoryFailure_IsInternal(t *testing.T) {
	boom := errors.New("boom")
	repo := &fakeRepository{
		getLinkedFn: func(context.Context, string, string) (staff.Professional, bool, error) {
			return staff.Professional{}, false, boom
		},
		linkFn: func(context.Context, string, string, string) (staff.LinkResult, error) {
			return staff.LinkResult{}, boom
		},
		unlinkFn: func(context.Context, string, string) (string, error) { return "", boom },
	}
	service := staff.NewService(repo)

	_, _, err := service.LinkedProfessional(context.Background(), linkShop, linkUserID)
	requireKind(t, err, apperr.KindInternal)
	_, err = service.LinkMyProfessional(context.Background(), linkShop, linkUserID, linkProfessional)
	requireKind(t, err, apperr.KindInternal)
	requireKind(t, service.UnlinkMyProfessional(context.Background(), linkShop, linkUserID), apperr.KindInternal)
}

func TestUserProfessionalLookup_MapsNoLinkToNotFoundFlag(t *testing.T) {
	repo := &fakeRepository{getLinkedFn: func(_ context.Context, _, user string) (staff.Professional, bool, error) {
		if user == linkUserID {
			return staff.Professional{ID: linkProfessional}, true, nil
		}
		return staff.Professional{}, false, nil
	}}
	lookup := staff.NewUserProfessionalLookup(staff.NewService(repo))

	id, found, err := lookup.ProfessionalIDOfUser(context.Background(), linkShop, linkUserID)
	if err != nil || !found || id != linkProfessional {
		t.Fatalf("expected the linked professional, got %q %v %v", id, found, err)
	}
	id, found, err = lookup.ProfessionalIDOfUser(context.Background(), linkShop, "otro-usuario")
	if err != nil || found || id != "" {
		t.Fatalf("un usuario sin profesional no es un error, got %q %v %v", id, found, err)
	}
}
