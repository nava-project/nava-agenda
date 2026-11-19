// Pruebas del caso de uso EN AISLAMIENTO, sin PostgreSQL real: cubren el
// rechazo por forma (largo) y la traducción found=false a apperr.NotFound.
// La resolución real vía public_resolve_business_by_slug, el aislamiento
// de tenant y la lectura del perfil público se prueban contra PostgreSQL
// real con dos tenants en
// internal/modules/publicbooking/postgres/repository_test.go
// (nava-docs/agenda/03-desarrollo/estrategia-pruebas.md §2).
package publicbooking_test

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/platform/apperr"
)

type fakeRepository struct {
	profile publicbooking.BusinessProfile
	found   bool
	err     error
	calls   []string

	listResult publicbooking.PublicServiceListResult
	listFound  bool
	listErr    error
	listCalls  []listCall

	professionalsResult publicbooking.PublicProfessionalListResult
	professionalsFound  bool
	professionalsErr    error
	professionalsCalls  []professionalsCall

	photoResult publicbooking.PublicProfessionalPhoto
	photoFound  bool
	photoErr    error
	photoCalls  []photoCall

	withServicesResult publicbooking.PublicProfessionalServicesListResult
	withServicesFound  bool
	withServicesErr    error
	withServicesCalls  []string
}

type photoCall struct {
	slug           string
	professionalID string
}

type listCall struct {
	slug   string
	cursor *publicbooking.ServiceCursor
	limit  int
}

type professionalsCall struct {
	slug      string
	serviceID string
}

func (f *fakeRepository) ResolveBySlug(_ context.Context, slug string) (publicbooking.BusinessProfile, bool, error) {
	f.calls = append(f.calls, slug)
	return f.profile, f.found, f.err
}

func (f *fakeRepository) ListPublicServices(_ context.Context, slug string, cursor *publicbooking.ServiceCursor, limit int) (publicbooking.PublicServiceListResult, bool, error) {
	f.listCalls = append(f.listCalls, listCall{slug: slug, cursor: cursor, limit: limit})
	return f.listResult, f.listFound, f.listErr
}

func (f *fakeRepository) ListPublicProfessionals(_ context.Context, slug string, serviceID string) (publicbooking.PublicProfessionalListResult, bool, error) {
	f.professionalsCalls = append(f.professionalsCalls, professionalsCall{slug: slug, serviceID: serviceID})
	return f.professionalsResult, f.professionalsFound, f.professionalsErr
}

func (f *fakeRepository) GetPublicProfessionalPhoto(_ context.Context, slug string, professionalID string) (publicbooking.PublicProfessionalPhoto, bool, error) {
	f.photoCalls = append(f.photoCalls, photoCall{slug: slug, professionalID: professionalID})
	return f.photoResult, f.photoFound, f.photoErr
}

func (f *fakeRepository) ListPublicProfessionalsWithServices(_ context.Context, slug string) (publicbooking.PublicProfessionalServicesListResult, bool, error) {
	f.withServicesCalls = append(f.withServicesCalls, slug)
	return f.withServicesResult, f.withServicesFound, f.withServicesErr
}

var _ publicbooking.Repository = (*fakeRepository)(nil)

const validServiceID = "11111111-1111-1111-1111-111111111111"

func assertNotFound(t *testing.T, err error) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindNotFound {
		t.Fatalf("expected apperr.KindNotFound, got %v", err)
	}
}

func TestResolveBusiness_Found_ReturnsProfile(t *testing.T) {
	contactEmail := "contacto@ejemplo.test"
	want := publicbooking.BusinessProfile{
		Name:         "Barbería Ejemplo",
		Timezone:     "America/Bogota",
		ContactEmail: &contactEmail,
	}
	repo := &fakeRepository{profile: want, found: true}
	svc := publicbooking.NewService(repo)

	got, err := svc.ResolveBusiness(context.Background(), "barberia-ejemplo")
	if err != nil {
		t.Fatalf("ResolveBusiness: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
	if len(repo.calls) != 1 || repo.calls[0] != "barberia-ejemplo" {
		t.Fatalf("expected exactly one ResolveBySlug call with the trimmed slug, got %v", repo.calls)
	}
}

func TestResolveBusiness_TrimsSurroundingWhitespaceBeforeCallingRepository(t *testing.T) {
	repo := &fakeRepository{found: true}
	svc := publicbooking.NewService(repo)

	if _, err := svc.ResolveBusiness(context.Background(), "  barberia-ejemplo  "); err != nil {
		t.Fatalf("ResolveBusiness: %v", err)
	}
	if len(repo.calls) != 1 || repo.calls[0] != "barberia-ejemplo" {
		t.Fatalf("expected the repository to receive the trimmed slug, got %v", repo.calls)
	}
}

func TestResolveBusiness_NotFound_ReturnsNotFoundWithoutLeakingCause(t *testing.T) {
	repo := &fakeRepository{found: false}
	svc := publicbooking.NewService(repo)

	_, err := svc.ResolveBusiness(context.Background(), "no-existe")
	assertNotFound(t, err)
}

func TestResolveBusiness_EmptySlug_ReturnsNotFoundWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	_, err := svc.ResolveBusiness(context.Background(), "   ")
	assertNotFound(t, err)
	if len(repo.calls) != 0 {
		t.Fatalf("expected zero repository calls for an empty slug, got %v", repo.calls)
	}
}

func TestResolveBusiness_SlugTooLong_ReturnsNotFoundWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	tooLong := strings.Repeat("a", publicbooking.MaxSlugLength+1)
	_, err := svc.ResolveBusiness(context.Background(), tooLong)
	assertNotFound(t, err)
	if len(repo.calls) != 0 {
		t.Fatalf("expected zero repository calls for an overlong slug, got %v", repo.calls)
	}
}

func TestResolveBusiness_RepositoryError_ReturnsInternal(t *testing.T) {
	repo := &fakeRepository{err: errors.New("boom")}
	svc := publicbooking.NewService(repo)

	_, err := svc.ResolveBusiness(context.Background(), "barberia-ejemplo")
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
}

func TestResolveBusiness_ContextCancelled_ReturnsInternalWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := svc.ResolveBusiness(ctx, "barberia-ejemplo")
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
	if len(repo.calls) != 0 {
		t.Fatalf("expected zero repository calls with a cancelled context, got %v", repo.calls)
	}
}

func TestListPublicServices_Found_ReturnsResult(t *testing.T) {
	want := publicbooking.PublicServiceListResult{
		Items: []publicbooking.PublicService{
			{ID: "1", Name: "Corte", DurationMinutes: 30, PriceCents: 3500000, Currency: "COP"},
		},
	}
	repo := &fakeRepository{listResult: want, listFound: true}
	svc := publicbooking.NewService(repo)

	got, err := svc.ListPublicServices(context.Background(), "barberia-ejemplo", "", 0)
	if err != nil {
		t.Fatalf("ListPublicServices: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0] != want.Items[0] {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
	if len(repo.listCalls) != 1 || repo.listCalls[0].slug != "barberia-ejemplo" || repo.listCalls[0].limit != publicbooking.DefaultServiceListLimit {
		t.Fatalf("expected one call with trimmed slug and default limit, got %+v", repo.listCalls)
	}
}

func TestListPublicServices_NotFound_ReturnsNotFoundWithoutLeakingCause(t *testing.T) {
	repo := &fakeRepository{listFound: false}
	svc := publicbooking.NewService(repo)

	_, err := svc.ListPublicServices(context.Background(), "no-existe", "", 0)
	assertNotFound(t, err)
}

func TestListPublicServices_EmptySlug_ReturnsNotFoundWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	_, err := svc.ListPublicServices(context.Background(), "   ", "", 0)
	assertNotFound(t, err)
	if len(repo.listCalls) != 0 {
		t.Fatalf("expected zero repository calls for an empty slug, got %v", repo.listCalls)
	}
}

func TestListPublicServices_SlugTooLong_ReturnsNotFoundWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	tooLong := strings.Repeat("a", publicbooking.MaxSlugLength+1)
	_, err := svc.ListPublicServices(context.Background(), tooLong, "", 0)
	assertNotFound(t, err)
	if len(repo.listCalls) != 0 {
		t.Fatalf("expected zero repository calls for an overlong slug, got %v", repo.listCalls)
	}
}

func TestListPublicServices_LimitClamping(t *testing.T) {
	cases := []struct {
		name  string
		input int
		want  int
	}{
		{"zero uses default", 0, publicbooking.DefaultServiceListLimit},
		{"negative uses default", -5, publicbooking.DefaultServiceListLimit},
		{"above maximum clamps down", publicbooking.MaxServiceListLimit + 100, publicbooking.MaxServiceListLimit},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{listFound: true}
			svc := publicbooking.NewService(repo)
			if _, err := svc.ListPublicServices(context.Background(), "barberia-ejemplo", "", tc.input); err != nil {
				t.Fatalf("ListPublicServices: %v", err)
			}
			if len(repo.listCalls) != 1 || repo.listCalls[0].limit != tc.want {
				t.Fatalf("expected limit %d, got %+v", tc.want, repo.listCalls)
			}
		})
	}
}

func TestListPublicServices_InvalidCursor_ReturnsInvalidWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	_, err := svc.ListPublicServices(context.Background(), "barberia-ejemplo", "no-es-un-cursor-valido", 0)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInvalid {
		t.Fatalf("expected apperr.KindInvalid, got %v", err)
	}
	if len(repo.listCalls) != 0 {
		t.Fatalf("expected zero repository calls for an invalid cursor, got %v", repo.listCalls)
	}
}

func TestListPublicServices_RepositoryError_ReturnsInternal(t *testing.T) {
	repo := &fakeRepository{listErr: errors.New("boom")}
	svc := publicbooking.NewService(repo)

	_, err := svc.ListPublicServices(context.Background(), "barberia-ejemplo", "", 0)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
}

func TestListPublicServices_ContextCancelled_ReturnsInternalWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := svc.ListPublicServices(ctx, "barberia-ejemplo", "", 0)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
	if len(repo.listCalls) != 0 {
		t.Fatalf("expected zero repository calls with a cancelled context, got %v", repo.listCalls)
	}
}

func TestListPublicProfessionals_Found_ReturnsResult(t *testing.T) {
	want := publicbooking.PublicProfessionalListResult{
		Items: []publicbooking.PublicProfessional{{ID: "1", FullName: "Juan Pérez"}},
	}
	repo := &fakeRepository{professionalsResult: want, professionalsFound: true}
	svc := publicbooking.NewService(repo)

	got, err := svc.ListPublicProfessionals(context.Background(), "barberia-ejemplo", validServiceID)
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0] != want.Items[0] {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
	if len(repo.professionalsCalls) != 1 || repo.professionalsCalls[0].slug != "barberia-ejemplo" || repo.professionalsCalls[0].serviceID != validServiceID {
		t.Fatalf("expected one call with the trimmed slug and serviceID, got %+v", repo.professionalsCalls)
	}
}

func TestListPublicProfessionals_TrimsSurroundingWhitespaceBeforeCallingRepository(t *testing.T) {
	repo := &fakeRepository{professionalsFound: true}
	svc := publicbooking.NewService(repo)

	if _, err := svc.ListPublicProfessionals(context.Background(), "  barberia-ejemplo  ", validServiceID); err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if len(repo.professionalsCalls) != 1 || repo.professionalsCalls[0].slug != "barberia-ejemplo" {
		t.Fatalf("expected the repository to receive the trimmed slug, got %v", repo.professionalsCalls)
	}
}

// Cero profesionales elegibles (CA-092-03, extremo "0" de la matriz 0/1/N) no es
// un error: el repositorio ya resolvió el negocio, así que el resultado es
// una lista vacía exitosa, indistinguible de un serviceID ajeno o inválido.
func TestListPublicProfessionals_ZeroProfessionals_ReturnsEmptySuccessResult(t *testing.T) {
	repo := &fakeRepository{professionalsResult: publicbooking.PublicProfessionalListResult{Items: []publicbooking.PublicProfessional{}}, professionalsFound: true}
	svc := publicbooking.NewService(repo)

	got, err := svc.ListPublicProfessionals(context.Background(), "barberia-ejemplo", validServiceID)
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if len(got.Items) != 0 {
		t.Fatalf("expected zero items, got %+v", got.Items)
	}
}

func TestListPublicProfessionals_BusinessNotFound_ReturnsNotFoundWithoutLeakingCause(t *testing.T) {
	repo := &fakeRepository{professionalsFound: false}
	svc := publicbooking.NewService(repo)

	_, err := svc.ListPublicProfessionals(context.Background(), "no-existe", validServiceID)
	assertNotFound(t, err)
}

func TestListPublicProfessionals_EmptySlug_ReturnsNotFoundWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	_, err := svc.ListPublicProfessionals(context.Background(), "   ", validServiceID)
	assertNotFound(t, err)
	if len(repo.professionalsCalls) != 0 {
		t.Fatalf("expected zero repository calls for an empty slug, got %v", repo.professionalsCalls)
	}
}

func TestListPublicProfessionals_SlugTooLong_ReturnsNotFoundWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	tooLong := strings.Repeat("a", publicbooking.MaxSlugLength+1)
	_, err := svc.ListPublicProfessionals(context.Background(), tooLong, validServiceID)
	assertNotFound(t, err)
	if len(repo.professionalsCalls) != 0 {
		t.Fatalf("expected zero repository calls for an overlong slug, got %v", repo.professionalsCalls)
	}
}

// Un serviceID malformado SÍ llega al repositorio (que resuelve el negocio
// primero y descarta el formato después, sin tocar la base con un valor no
// UUID): CA-092-03 exige que esta causa sea indistinguible de "ajeno" o "ya
// no asignado" en el nivel de Service, nunca del universo distinto de
// "negocio desconocido".
func TestListPublicProfessionals_MalformedServiceID_StillResolvesBusiness(t *testing.T) {
	repo := &fakeRepository{professionalsFound: true}
	svc := publicbooking.NewService(repo)

	if _, err := svc.ListPublicProfessionals(context.Background(), "barberia-ejemplo", "no-es-un-uuid"); err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if len(repo.professionalsCalls) != 1 || repo.professionalsCalls[0].serviceID != "no-es-un-uuid" {
		t.Fatalf("expected the repository to receive the raw serviceID, got %v", repo.professionalsCalls)
	}
}

func TestListPublicProfessionals_RepositoryError_ReturnsInternal(t *testing.T) {
	repo := &fakeRepository{professionalsErr: errors.New("boom")}
	svc := publicbooking.NewService(repo)

	_, err := svc.ListPublicProfessionals(context.Background(), "barberia-ejemplo", validServiceID)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
}

func TestListPublicProfessionals_ContextCancelled_ReturnsInternalWithoutCallingRepository(t *testing.T) {
	repo := &fakeRepository{}
	svc := publicbooking.NewService(repo)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := svc.ListPublicProfessionals(ctx, "barberia-ejemplo", validServiceID)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
	if len(repo.professionalsCalls) != 0 {
		t.Fatalf("expected zero repository calls with a cancelled context, got %v", repo.professionalsCalls)
	}
}

// --- Fotografía pública del profesional (DEC-127) ----------------------------

func TestPublicProfessionalPhoto_Found_ReturnsPhotoWithTrimmedSlug(t *testing.T) {
	want := publicbooking.PublicProfessionalPhoto{ContentType: "image/png", Data: []byte{1, 2, 3}}
	repo := &fakeRepository{photoResult: want, photoFound: true}
	svc := publicbooking.NewService(repo)

	got, err := svc.PublicProfessionalPhoto(context.Background(), "  barberia-ejemplo  ", validServiceID)
	if err != nil {
		t.Fatalf("PublicProfessionalPhoto: %v", err)
	}
	if got.ContentType != want.ContentType || string(got.Data) != string(want.Data) {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
	if len(repo.photoCalls) != 1 || repo.photoCalls[0].slug != "barberia-ejemplo" || repo.photoCalls[0].professionalID != validServiceID {
		t.Fatalf("expected one call with the trimmed slug, got %+v", repo.photoCalls)
	}
}

func TestPublicProfessionalPhoto_NotFound_ReturnsNotFound(t *testing.T) {
	repo := &fakeRepository{photoFound: false}
	svc := publicbooking.NewService(repo)

	_, err := svc.PublicProfessionalPhoto(context.Background(), "barberia-ejemplo", validServiceID)
	assertNotFound(t, err)
}

// Todas las entradas inválidas producen el mismo NotFound que una foto
// inexistente y nunca llegan al repositorio: la causa no se distingue.
func TestPublicProfessionalPhoto_InvalidInput_ReturnsNotFoundWithoutCallingRepository(t *testing.T) {
	for name, tc := range map[string]struct{ slug, professionalID string }{
		"slug vacío":                    {"   ", validServiceID},
		"slug demasiado largo":          {strings.Repeat("a", publicbooking.MaxSlugLength+1), validServiceID},
		"profesional sin forma de UUID": {"barberia-ejemplo", "no-es-un-uuid"},
	} {
		t.Run(name, func(t *testing.T) {
			repo := &fakeRepository{photoFound: true}
			svc := publicbooking.NewService(repo)

			_, err := svc.PublicProfessionalPhoto(context.Background(), tc.slug, tc.professionalID)
			assertNotFound(t, err)
			if len(repo.photoCalls) != 0 {
				t.Fatalf("expected zero repository calls, got %+v", repo.photoCalls)
			}
		})
	}
}

func TestPublicProfessionalPhoto_RepositoryError_ReturnsInternal(t *testing.T) {
	repo := &fakeRepository{photoErr: errors.New("boom")}
	svc := publicbooking.NewService(repo)

	_, err := svc.PublicProfessionalPhoto(context.Background(), "barberia-ejemplo", validServiceID)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("expected apperr.KindInternal, got %v", err)
	}
}

func TestListPublicProfessionalsWithServices_Found_ReturnsResult(t *testing.T) {
	want := publicbooking.PublicProfessionalServicesListResult{Items: []publicbooking.PublicProfessionalServices{
		{ID: "b1", FullName: "Barbero Uno", ServiceIDs: []string{validServiceID}},
	}}
	repo := &fakeRepository{withServicesFound: true, withServicesResult: want}
	svc := publicbooking.NewService(repo)

	got, err := svc.ListPublicProfessionalsWithServices(context.Background(), "  barberia-ejemplo  ")
	if err != nil {
		t.Fatalf("ListPublicProfessionalsWithServices: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].ID != "b1" || len(got.Items[0].ServiceIDs) != 1 {
		t.Fatalf("resultado inesperado: %+v", got)
	}
	// El slug se recorta antes de llegar al repositorio (mismo criterio que
	// las demás operaciones públicas) y es la única entrada del cliente.
	if len(repo.withServicesCalls) != 1 || repo.withServicesCalls[0] != "barberia-ejemplo" {
		t.Fatalf("llamadas al repositorio = %v, want [barberia-ejemplo]", repo.withServicesCalls)
	}
}

func TestListPublicProfessionalsWithServices_InvalidSlug_ReturnsUniformNotFoundWithoutCallingRepository(t *testing.T) {
	for name, slug := range map[string]string{
		"vacío":           "",
		"solo espacio":    "   ",
		"demasiado largo": strings.Repeat("a", publicbooking.MaxSlugLength+1),
	} {
		t.Run(name, func(t *testing.T) {
			repo := &fakeRepository{withServicesFound: true}
			_, err := publicbooking.NewService(repo).ListPublicProfessionalsWithServices(context.Background(), slug)
			appErr, ok := apperr.As(err)
			if !ok || appErr.Kind != apperr.KindNotFound {
				t.Fatalf("esperaba apperr.KindNotFound, got %v", err)
			}
			if len(repo.withServicesCalls) != 0 {
				t.Fatalf("un slug inválido no debe tocar el repositorio, got %v", repo.withServicesCalls)
			}
		})
	}
}

func TestListPublicProfessionalsWithServices_UnknownBusiness_ReturnsSameNotFoundAsOtherOperations(t *testing.T) {
	svc := publicbooking.NewService(&fakeRepository{withServicesFound: false})
	_, err := svc.ListPublicProfessionalsWithServices(context.Background(), "no-existe")
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindNotFound {
		t.Fatalf("esperaba apperr.KindNotFound, got %v", err)
	}
	_, resolveErr := svc.ResolveBusiness(context.Background(), "")
	resolveAppErr, _ := apperr.As(resolveErr)
	if appErr.Message != resolveAppErr.Message {
		t.Fatalf("el 404 debe ser el uniforme de HU-090: %q vs %q", appErr.Message, resolveAppErr.Message)
	}
}

func TestListPublicProfessionalsWithServices_RepositoryError_IsInternal(t *testing.T) {
	svc := publicbooking.NewService(&fakeRepository{withServicesErr: errors.New("boom")})
	_, err := svc.ListPublicProfessionalsWithServices(context.Background(), "barberia-ejemplo")
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("esperaba apperr.KindInternal, got %v", err)
	}
}

func TestListPublicProfessionalsWithServices_CancelledContext_IsInternal(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	repo := &fakeRepository{withServicesFound: true}
	_, err := publicbooking.NewService(repo).ListPublicProfessionalsWithServices(ctx, "barberia-ejemplo")
	appErr, ok := apperr.As(err)
	if !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("esperaba apperr.KindInternal, got %v", err)
	}
	if len(repo.withServicesCalls) != 0 {
		t.Fatal("un contexto cancelado no debe tocar el repositorio")
	}
}
