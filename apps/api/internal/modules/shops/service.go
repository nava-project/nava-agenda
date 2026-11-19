package shops

import (
	"context"
	"fmt"
	"regexp"
	"unicode/utf8"

	"nava-agenda/internal/platform/apperr"
)

// contactEmailShapePattern refleja la misma forma mínima que
// business_contact_email_ck exige en la base (al menos un carácter antes
// y después de '@', un '.' con al menos un carácter después): sin
// espacios, con '@' y con un '.' posterior. No es una validación RFC 5322
// completa a propósito (nava-docs/agenda/06-api/estandar-openapi.md: "no crear reglas
// más restrictivas que las fuentes"); la normalización a minúsculas ocurre
// antes, en [NormalizeContactEmail].
var contactEmailShapePattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// contactPhoneE164Pattern es EXACTAMENTE la misma expresión que
// business_contact_phone_ck y staff_user_phone_ck ya aplican en la base
// (20260817180000_create_login_throttle_and_phone_challenge.sql): '+',
// indicativo sin cero inicial, 8 a 15 dígitos en total. Validar aquí evita
// que un valor mal formado llegue a producir una violación de CHECK sin
// traducir (500) en vez de un 422 de campo.
var contactPhoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// contactEmailMaxLength coincide con business_contact_email_ck
// (char_length <= 254), mismo límite que staff_user.email.
const contactEmailMaxLength = 254

// Service implementa el caso de uso de HU-020: leer y actualizar la
// configuración básica del negocio activo.
type Service struct {
	repo Repository
}

// NewService construye el servicio.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// Get lee la configuración del negocio businessID. businessID llega
// siempre de un auth.Principal ya autenticado (CA-020-01); este método no
// acepta ni valida ningún identificador que el cliente pueda controlar.
func (s *Service) Get(ctx context.Context, businessID string) (Business, error) {
	if err := ctx.Err(); err != nil {
		return Business{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de leer negocio: %w", err))
	}

	business, found, err := s.repo.Get(ctx, businessID)
	if err != nil {
		return Business{}, apperr.Internal(fmt.Errorf("shops: leer negocio: %w", err))
	}
	if !found {
		return Business{}, apperr.NotFound("negocio no encontrado")
	}
	return business, nil
}

// UpdateInput es la entrada cruda del caso de uso de actualización, tal
// como llega del handler HTTP: sin normalizar ni validar todavía.
type Input struct {
	Name         string
	Timezone     string
	ContactEmail string
	ContactPhone string
}

// Update normaliza y valida input y, si pasa todas las comprobaciones de
// campo, delega en el repositorio la confirmación final de la zona IANA y
// la escritura atómica (CA-020-02, CA-020-03, CA-020-06). businessID
// llega siempre de un auth.Principal ya autenticado, nunca de un campo del
// cuerpo (CA-020-05: el contrato ni siquiera declara un campo
// businessId). Los campos se evalúan en el orden fijo del contrato
// (name, timezone, contactEmail, contactPhone): el primer error de campo
// encontrado es el que se devuelve, sin ejecutar ninguna escritura.
func (s *Service) Update(ctx context.Context, businessID string, input Input) (Business, error) {
	if err := ctx.Err(); err != nil {
		return Business{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de actualizar negocio: %w", err))
	}

	name := NormalizeName(input.Name)
	switch {
	case name == "":
		return Business{}, errNameRequired()
	case utf8.RuneCountInString(name) > NameMaxLength:
		return Business{}, errNameTooLong()
	}

	timezone := NormalizeName(input.Timezone) // mismo recorte que el nombre; sin normalización de mayúsculas (un identificador IANA es sensible a caso).
	switch {
	case timezone == "":
		return Business{}, errTimezoneRequired()
	case utf8.RuneCountInString(timezone) > TimezoneMaxLength:
		return Business{}, errTimezoneTooLong()
	}

	contactEmail := NormalizeContactEmail(input.ContactEmail)
	if contactEmail != nil {
		switch {
		case utf8.RuneCountInString(*contactEmail) > contactEmailMaxLength:
			return Business{}, errContactEmailInvalid()
		case !contactEmailShapePattern.MatchString(*contactEmail):
			return Business{}, errContactEmailInvalid()
		}
	}

	contactPhone := NormalizeContact(input.ContactPhone)
	if contactPhone != nil && !contactPhoneE164Pattern.MatchString(*contactPhone) {
		return Business{}, errContactPhoneInvalid()
	}

	result, err := s.repo.Update(ctx, businessID, UpdateInput{
		Name:         name,
		Timezone:     timezone,
		ContactEmail: contactEmail,
		ContactPhone: contactPhone,
	})
	if err != nil {
		return Business{}, apperr.Internal(fmt.Errorf("shops: actualizar negocio: %w", err))
	}
	if !result.TimezoneValid {
		return Business{}, errTimezoneInvalid()
	}
	if !result.Found {
		return Business{}, apperr.NotFound("negocio no encontrado")
	}
	return result.Business, nil
}
