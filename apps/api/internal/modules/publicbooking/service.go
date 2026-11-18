package publicbooking

import (
	"context"
	"fmt"
	"strings"
	"time"

	"nava-agenda/internal/platform/apperr"
)

// Service implementa el caso de uso de HU-090: resolver el enlace público
// de reservas de un negocio a partir de un identificador (slug) no
// confiado, sin sesión y sin que el cliente pueda fijar businessId.
type Service struct {
	repo    Repository
	now     func() time.Time
	holiday HolidayLookup
}

// NewService construye el servicio. Sin WithOpeningCalendar usa el reloj del
// sistema y no conoce festivos.
func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

// WithOpeningCalendar fija el reloj y el calendario de festivos con que se
// calcula el horario de hoy del perfil público (DEC-182). now nil conserva el
// reloj del sistema.
func (s *Service) WithOpeningCalendar(now func() time.Time, holiday HolidayLookup) *Service {
	if now != nil {
		s.now = now
	}
	s.holiday = holiday
	return s
}

// ResolveBusiness resuelve rawSlug -tal como llega del parámetro de ruta,
// sin decodificar de más ni confiar en su forma- al negocio público
// correspondiente. Un slug vacío, demasiado largo, mal formado, desconocido
// o de un negocio no publicable produce EXACTAMENTE el mismo
// apperr.NotFound (CA-090-02): esta función nunca distingue la causa ni en
// el valor de retorno ni en cuánto tarda en decidir "demasiado largo" (se
// rechaza antes de tocar la base, igual de rápido que cualquier otro
// rechazo por forma).
func (s *Service) ResolveBusiness(ctx context.Context, rawSlug string) (BusinessProfile, error) {
	if err := ctx.Err(); err != nil {
		return BusinessProfile{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de resolver slug: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return BusinessProfile{}, errBusinessNotPublic()
	}

	profile, found, err := s.repo.ResolveBySlug(ctx, slug)
	if err != nil {
		return BusinessProfile{}, apperr.Internal(fmt.Errorf("publicbooking: resolver slug: %w", err))
	}
	if !found {
		return BusinessProfile{}, errBusinessNotPublic()
	}
	// La zona viene de business.timezone, validada al guardarla; si aun así no
	// carga, el perfil sale sin «hoy» en vez de fallar entero.
	if loc, err := time.LoadLocation(profile.Timezone); err == nil {
		profile.Today = TodayOpening(profile.OpeningHours, profile.ClosedOnHolidays, s.now(), loc, s.holiday)
	}
	return profile, nil
}

// errBusinessNotPublic es el único apperr.NotFound que este servicio
// devuelve (CA-090-02): mismo mensaje seguro para forma inválida,
// desconocido y no publicable, sin revelar cuál de los tres ocurrió.
func errBusinessNotPublic() error {
	return apperr.NotFound("no existe un negocio público con ese enlace")
}

// ListPublicServices resuelve rawSlug -mismo criterio de recorte y forma
// que ResolveBusiness- y devuelve una página de los servicios activos y
// asignados de ese negocio (HU-091, CA-091-01). Un slug inválido,
// desconocido o de un negocio no publicable produce el mismo
// apperr.NotFound uniforme que ResolveBusiness (CA-090-02, reutilizado
// también aquí porque la causa es indistinguible en ambas operaciones).
func (s *Service) ListPublicServices(ctx context.Context, rawSlug string, cursorToken string, limit int) (PublicServiceListResult, error) {
	if err := ctx.Err(); err != nil {
		return PublicServiceListResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de listar servicios públicos: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return PublicServiceListResult{}, errBusinessNotPublic()
	}

	switch {
	case limit <= 0:
		limit = DefaultServiceListLimit
	case limit < MinServiceListLimit:
		limit = MinServiceListLimit
	case limit > MaxServiceListLimit:
		limit = MaxServiceListLimit
	}

	var cursor *ServiceCursor
	if cursorToken != "" {
		decoded, err := DecodeServiceCursor(cursorToken)
		if err != nil {
			return PublicServiceListResult{}, err
		}
		cursor = &decoded
	}

	result, found, err := s.repo.ListPublicServices(ctx, slug, cursor, limit)
	if err != nil {
		return PublicServiceListResult{}, apperr.Internal(fmt.Errorf("publicbooking: listar servicios públicos: %w", err))
	}
	if !found {
		return PublicServiceListResult{}, errBusinessNotPublic()
	}
	return result, nil
}

// ListPublicProfessionals resuelve rawSlug -mismo criterio de recorte y forma que
// ResolveBusiness- y devuelve los profesionales con asignación vigente al
// servicio activo rawServiceID (HU-092, CA-092-02). Un slug inválido,
// desconocido o de un negocio no publicable produce el mismo
// apperr.NotFound uniforme que ResolveBusiness. rawServiceID sin forma de
// UUID, ajeno a este negocio, inexistente o de un servicio inactivo NUNCA
// produce un error distinto (CA-092-03): en todos esos casos el resultado es
// una lista vacía, exactamente igual que un servicio sin ningún profesional
// asignado hoy -la causa no se distingue ni en el valor ni en el tiempo de
// respuesta.
func (s *Service) ListPublicProfessionals(ctx context.Context, rawSlug string, rawServiceID string) (PublicProfessionalListResult, error) {
	if err := ctx.Err(); err != nil {
		return PublicProfessionalListResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de listar profesionales públicos: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return PublicProfessionalListResult{}, errBusinessNotPublic()
	}

	// rawServiceID sin forma de UUID nunca llega a la base de datos (evita
	// un error de tipo de PostgreSQL sobre una columna `uuid`), pero SÍ deja
	// que el repositorio resuelva el negocio primero: CA-092-03 exige que
	// esta causa sea indistinguible de "ajeno" o "ya no asignado" -lista
	// vacía-, nunca del universo distinto de "negocio desconocido"
	// (CA-090-02, errBusinessNotPublic), que sigue dependiendo solo del
	// slug.
	result, found, err := s.repo.ListPublicProfessionals(ctx, slug, rawServiceID)
	if err != nil {
		return PublicProfessionalListResult{}, apperr.Internal(fmt.Errorf("publicbooking: listar profesionales públicos: %w", err))
	}
	if !found {
		return PublicProfessionalListResult{}, errBusinessNotPublic()
	}
	return result, nil
}

// ListPublicProfessionalsWithServices resuelve rawSlug -mismo criterio de recorte y
// forma que ResolveBusiness- y devuelve, en una sola lectura, todos los
// profesionales con al menos una asignación vigente a un servicio activo, cada
// uno con los ids de esos servicios (DEC-162). Sustituye a N llamadas de
// ListPublicProfessionals (una por servicio) para quien necesita el mapa completo.
// Un slug inválido, desconocido o de un negocio no publicable produce el
// mismo apperr.NotFound uniforme que las demás operaciones públicas
// (CA-090-02). No recibe ningún otro dato del cliente: el tenant lo fija el
// slug resuelto en el repositorio, nunca un businessId.
func (s *Service) ListPublicProfessionalsWithServices(ctx context.Context, rawSlug string) (PublicProfessionalServicesListResult, error) {
	if err := ctx.Err(); err != nil {
		return PublicProfessionalServicesListResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de listar profesionales con servicios: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return PublicProfessionalServicesListResult{}, errBusinessNotPublic()
	}

	result, found, err := s.repo.ListPublicProfessionalsWithServices(ctx, slug)
	if err != nil {
		return PublicProfessionalServicesListResult{}, apperr.Internal(fmt.Errorf("publicbooking: listar profesionales con servicios: %w", err))
	}
	if !found {
		return PublicProfessionalServicesListResult{}, errBusinessNotPublic()
	}
	return result, nil
}

// PublicProfessionalPhoto devuelve la fotografía de un profesional visible en la reserva
// pública (DEC-127). Un slug inválido, un profesional con forma inválida, ajeno,
// inexistente, sin fotografía o no elegible producen el MISMO
// apperr.NotFound: la causa no se distingue (mismo criterio que CA-090-02 y
// CA-092-03).
func (s *Service) PublicProfessionalPhoto(ctx context.Context, rawSlug string, rawProfessionalID string) (PublicProfessionalPhoto, error) {
	if err := ctx.Err(); err != nil {
		return PublicProfessionalPhoto{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de leer la fotografía pública: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength || !LooksLikePublicProfessionalID(rawProfessionalID) {
		return PublicProfessionalPhoto{}, errPublicProfessionalPhotoNotFound()
	}

	photo, found, err := s.repo.GetPublicProfessionalPhoto(ctx, slug, rawProfessionalID)
	if err != nil {
		return PublicProfessionalPhoto{}, apperr.Internal(fmt.Errorf("publicbooking: leer fotografía pública: %w", err))
	}
	if !found {
		return PublicProfessionalPhoto{}, errPublicProfessionalPhotoNotFound()
	}
	return photo, nil
}

// errPublicProfessionalPhotoNotFound es el único apperr.NotFound de la fotografía
// pública: no revela si falló el negocio, el profesional o la imagen.
func errPublicProfessionalPhotoNotFound() error {
	return apperr.NotFound("no existe una fotografía pública con ese identificador")
}
