package publicbooking

import (
	"context"
	"fmt"
	"strings"
	"time"

	"system-barbershop/internal/platform/apperr"
)

// Service implementa el caso de uso de HU-090: resolver el enlace público
// de reservas de una barbería a partir de un identificador (slug) no
// confiado, sin sesión y sin que el cliente pueda fijar barbershopId.
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

// ResolveBarbershop resuelve rawSlug -tal como llega del parámetro de ruta,
// sin decodificar de más ni confiar en su forma- a la barbería pública
// correspondiente. Un slug vacío, demasiado largo, mal formado, desconocido
// o de una barbería no publicable produce EXACTAMENTE el mismo
// apperr.NotFound (CA-090-02): esta función nunca distingue la causa ni en
// el valor de retorno ni en cuánto tarda en decidir "demasiado largo" (se
// rechaza antes de tocar la base, igual de rápido que cualquier otro
// rechazo por forma).
func (s *Service) ResolveBarbershop(ctx context.Context, rawSlug string) (BarbershopProfile, error) {
	if err := ctx.Err(); err != nil {
		return BarbershopProfile{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de resolver slug: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return BarbershopProfile{}, errBarbershopNotPublic()
	}

	profile, found, err := s.repo.ResolveBySlug(ctx, slug)
	if err != nil {
		return BarbershopProfile{}, apperr.Internal(fmt.Errorf("publicbooking: resolver slug: %w", err))
	}
	if !found {
		return BarbershopProfile{}, errBarbershopNotPublic()
	}
	// La zona viene de barbershop.timezone, validada al guardarla; si aun así no
	// carga, el perfil sale sin «hoy» en vez de fallar entero.
	if loc, err := time.LoadLocation(profile.Timezone); err == nil {
		profile.Today = TodayOpening(profile.OpeningHours, profile.ClosedOnHolidays, s.now(), loc, s.holiday)
	}
	return profile, nil
}

// errBarbershopNotPublic es el único apperr.NotFound que este servicio
// devuelve (CA-090-02): mismo mensaje seguro para forma inválida,
// desconocido y no publicable, sin revelar cuál de los tres ocurrió.
func errBarbershopNotPublic() error {
	return apperr.NotFound("no existe un negocio público con ese enlace")
}

// ListPublicServices resuelve rawSlug -mismo criterio de recorte y forma
// que ResolveBarbershop- y devuelve una página de los servicios activos y
// asignados de esa barbería (HU-091, CA-091-01). Un slug inválido,
// desconocido o de una barbería no publicable produce el mismo
// apperr.NotFound uniforme que ResolveBarbershop (CA-090-02, reutilizado
// también aquí porque la causa es indistinguible en ambas operaciones).
func (s *Service) ListPublicServices(ctx context.Context, rawSlug string, cursorToken string, limit int) (PublicServiceListResult, error) {
	if err := ctx.Err(); err != nil {
		return PublicServiceListResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de listar servicios públicos: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return PublicServiceListResult{}, errBarbershopNotPublic()
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
		return PublicServiceListResult{}, errBarbershopNotPublic()
	}
	return result, nil
}

// ListPublicBarbers resuelve rawSlug -mismo criterio de recorte y forma que
// ResolveBarbershop- y devuelve los barberos con asignación vigente al
// servicio activo rawServiceID (HU-092, CA-092-02). Un slug inválido,
// desconocido o de una barbería no publicable produce el mismo
// apperr.NotFound uniforme que ResolveBarbershop. rawServiceID sin forma de
// UUID, ajeno a esta barbería, inexistente o de un servicio inactivo NUNCA
// produce un error distinto (CA-092-03): en todos esos casos el resultado es
// una lista vacía, exactamente igual que un servicio sin ningún barbero
// asignado hoy -la causa no se distingue ni en el valor ni en el tiempo de
// respuesta.
func (s *Service) ListPublicBarbers(ctx context.Context, rawSlug string, rawServiceID string) (PublicBarberListResult, error) {
	if err := ctx.Err(); err != nil {
		return PublicBarberListResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de listar barberos públicos: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return PublicBarberListResult{}, errBarbershopNotPublic()
	}

	// rawServiceID sin forma de UUID nunca llega a la base de datos (evita
	// un error de tipo de PostgreSQL sobre una columna `uuid`), pero SÍ deja
	// que el repositorio resuelva la barbería primero: CA-092-03 exige que
	// esta causa sea indistinguible de "ajeno" o "ya no asignado" -lista
	// vacía-, nunca del universo distinto de "barbería desconocida"
	// (CA-090-02, errBarbershopNotPublic), que sigue dependiendo solo del
	// slug.
	result, found, err := s.repo.ListPublicBarbers(ctx, slug, rawServiceID)
	if err != nil {
		return PublicBarberListResult{}, apperr.Internal(fmt.Errorf("publicbooking: listar barberos públicos: %w", err))
	}
	if !found {
		return PublicBarberListResult{}, errBarbershopNotPublic()
	}
	return result, nil
}

// ListPublicBarbersWithServices resuelve rawSlug -mismo criterio de recorte y
// forma que ResolveBarbershop- y devuelve, en una sola lectura, todos los
// barberos con al menos una asignación vigente a un servicio activo, cada
// uno con los ids de esos servicios (DEC-162). Sustituye a N llamadas de
// ListPublicBarbers (una por servicio) para quien necesita el mapa completo.
// Un slug inválido, desconocido o de una barbería no publicable produce el
// mismo apperr.NotFound uniforme que las demás operaciones públicas
// (CA-090-02). No recibe ningún otro dato del cliente: el tenant lo fija el
// slug resuelto en el repositorio, nunca un barbershopId.
func (s *Service) ListPublicBarbersWithServices(ctx context.Context, rawSlug string) (PublicBarberServicesListResult, error) {
	if err := ctx.Err(); err != nil {
		return PublicBarberServicesListResult{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de listar barberos con servicios: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength {
		return PublicBarberServicesListResult{}, errBarbershopNotPublic()
	}

	result, found, err := s.repo.ListPublicBarbersWithServices(ctx, slug)
	if err != nil {
		return PublicBarberServicesListResult{}, apperr.Internal(fmt.Errorf("publicbooking: listar barberos con servicios: %w", err))
	}
	if !found {
		return PublicBarberServicesListResult{}, errBarbershopNotPublic()
	}
	return result, nil
}

// PublicBarberPhoto devuelve la fotografía de un barbero visible en la reserva
// pública (DEC-127). Un slug inválido, un barbero con forma inválida, ajeno,
// inexistente, sin fotografía o no elegible producen el MISMO
// apperr.NotFound: la causa no se distingue (mismo criterio que CA-090-02 y
// CA-092-03).
func (s *Service) PublicBarberPhoto(ctx context.Context, rawSlug string, rawBarberID string) (PublicBarberPhoto, error) {
	if err := ctx.Err(); err != nil {
		return PublicBarberPhoto{}, apperr.Internal(fmt.Errorf("publicbooking: contexto cancelado antes de leer la fotografía pública: %w", err))
	}

	slug := strings.TrimSpace(rawSlug)
	if slug == "" || len(slug) > MaxSlugLength || !LooksLikePublicBarberID(rawBarberID) {
		return PublicBarberPhoto{}, errPublicBarberPhotoNotFound()
	}

	photo, found, err := s.repo.GetPublicBarberPhoto(ctx, slug, rawBarberID)
	if err != nil {
		return PublicBarberPhoto{}, apperr.Internal(fmt.Errorf("publicbooking: leer fotografía pública: %w", err))
	}
	if !found {
		return PublicBarberPhoto{}, errPublicBarberPhotoNotFound()
	}
	return photo, nil
}

// errPublicBarberPhotoNotFound es el único apperr.NotFound de la fotografía
// pública: no revela si falló la barbería, el barbero o la imagen.
func errPublicBarberPhotoNotFound() error {
	return apperr.NotFound("no existe una fotografía pública con ese identificador")
}
