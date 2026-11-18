package staff

import (
	"context"
	"fmt"
	"unicode/utf8"

	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// Service implementa los casos de uso de HU-021: listar, consultar,
// registrar y actualizar (nombre y descripción) profesionales del negocio activo; y, por DEC-104, subir,
// leer y quitar su fotografía opcional.
type Service struct {
	repo      Repository
	observers []LinkObserver
}

// NewService construye el servicio.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// List lee una página de profesionales de businessID. cursorToken es el valor
// opaco que el cliente envió (vacío para la primera página); limit llega
// crudo del parámetro de consulta y se clamped aquí a
// [MinListLimit, MaxListLimit], con DefaultListLimit cuando el cliente no
// lo especifica (limit <= 0). businessID llega siempre de un
// auth.Principal ya autenticado (RN-TEN-01); este método no acepta ni
// valida ningún identificador que el cliente pueda controlar.
func (s *Service) List(ctx context.Context, businessID string, cursorToken string, limit int) (ListResult, error) {
	if err := ctx.Err(); err != nil {
		return ListResult{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de listar profesionales: %w", err))
	}

	switch {
	case limit <= 0:
		limit = DefaultListLimit
	case limit < MinListLimit:
		limit = MinListLimit
	case limit > MaxListLimit:
		limit = MaxListLimit
	}

	var cursor *Cursor
	if cursorToken != "" {
		decoded, err := DecodeCursor(cursorToken)
		if err != nil {
			return ListResult{}, err
		}
		cursor = &decoded
	}

	result, err := s.repo.List(ctx, businessID, cursor, limit)
	if err != nil {
		return ListResult{}, apperr.Internal(fmt.Errorf("staff: listar profesionales: %w", err))
	}
	return result, nil
}

// Get lee un profesional por id dentro del negocio activo. Un identificador
// inexistente o de otro negocio produce el mismo apperr.NotFound
// (CA-021-05).
func (s *Service) Get(ctx context.Context, businessID, professionalID string) (Professional, error) {
	if err := ctx.Err(); err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de leer profesional: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		// Nunca deja que un identificador con forma inválida llegue a
		// PostgreSQL como comparación contra una columna uuid (eso sería un
		// error de tipo, 500, no el 404 uniforme de CA-021-05).
		return Professional{}, errProfessionalNotFound()
	}

	professional, found, err := s.repo.Get(ctx, businessID, professionalID)
	if err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: leer profesional: %w", err))
	}
	if !found {
		return Professional{}, errProfessionalNotFound()
	}
	return professional, nil
}

// Create registra un profesional (CA-021-02), protegido por el protocolo de
// idempotencia reutilizable de HU-004 (RN-IDE-01, DEC-043). fullNameRaw es
// el valor crudo del cuerpo, sin normalizar; key y fingerprint ya fueron
// interpretados por la capa HTTP (httpserver.IdempotencyKeyFromRequest/
// IdempotencyFingerprint). La validación de fullName ocurre ANTES de tocar
// el repositorio: un nombre inválido nunca reclama ni consume la clave de
// idempotencia, porque no es el efecto que RN-IDE-01 protege.
func (s *Service) Create(
	ctx context.Context,
	businessID string,
	fullNameRaw string,
	descriptionRaw *string,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (CreateResult, error) {
	if err := ctx.Err(); err != nil {
		return CreateResult{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de registrar profesional: %w", err))
	}

	fullName, err := validateFullName(fullNameRaw)
	if err != nil {
		return CreateResult{}, err
	}

	description, err := validateDescription(descriptionRaw)
	if err != nil {
		return CreateResult{}, err
	}

	result, err := s.repo.Create(ctx, businessID, fullName, description, key, fingerprint)
	if err != nil {
		return CreateResult{}, apperr.Internal(fmt.Errorf("staff: registrar profesional: %w", err))
	}
	return result, nil
}

// Update cambia el nombre y, si viene en el cuerpo, la descripción de un
// profesional existente del negocio activo (CA-021-04, DEC-127). fullNameRaw y
// description son los valores crudos del cuerpo, sin normalizar. Un
// identificador inexistente o de otro negocio produce el mismo
// apperr.NotFound que Get (CA-021-05); nombres duplicados dentro de la
// mismo negocio son válidos (esta historia no impone unicidad).
func (s *Service) Update(ctx context.Context, businessID, professionalID, fullNameRaw string, description DescriptionPatch) (Professional, error) {
	if err := ctx.Err(); err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de actualizar profesional: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return Professional{}, errProfessionalNotFound()
	}

	fullName, err := validateFullName(fullNameRaw)
	if err != nil {
		return Professional{}, err
	}

	if description.Set {
		value, err := validateDescription(description.Value)
		if err != nil {
			return Professional{}, err
		}
		description.Value = value
	}

	result, err := s.repo.Update(ctx, businessID, professionalID, fullName, description)
	if err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: actualizar profesional: %w", err))
	}
	if !result.Found {
		return Professional{}, errProfessionalNotFound()
	}
	return result.Professional, nil
}

// SetPhoto sube o reemplaza la fotografía de un profesional (DEC-104). declaredType
// es el Content-Type ya normalizado del cliente y data el cuerpo crudo: la
// validación (formato real, tamaño, dimensiones) ocurre ANTES de tocar el
// repositorio, así que una imagen inválida nunca llega a la base. Un profesional
// inexistente o de otro negocio produce el mismo apperr.NotFound que Get.
func (s *Service) SetPhoto(ctx context.Context, businessID, professionalID, declaredType string, data []byte) (Professional, error) {
	if err := ctx.Err(); err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de guardar la fotografía: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return Professional{}, errProfessionalNotFound()
	}

	photo, err := ValidatePhoto(declaredType, data)
	if err != nil {
		return Professional{}, err
	}

	result, err := s.repo.PutPhoto(ctx, businessID, professionalID, photo)
	if err != nil {
		return Professional{}, apperr.Internal(fmt.Errorf("staff: guardar fotografía: %w", err))
	}
	if !result.Found {
		return Professional{}, errProfessionalNotFound()
	}
	return result.Professional, nil
}

// Photo lee la fotografía de un profesional. Un profesional inexistente, de otra
// negocio o sin fotografía produce el mismo apperr.NotFound (CA-021-05).
func (s *Service) Photo(ctx context.Context, businessID, professionalID string) (StoredPhoto, error) {
	if err := ctx.Err(); err != nil {
		return StoredPhoto{}, apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de leer la fotografía: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return StoredPhoto{}, errProfessionalNotFound()
	}

	photo, found, err := s.repo.GetPhoto(ctx, businessID, professionalID)
	if err != nil {
		return StoredPhoto{}, apperr.Internal(fmt.Errorf("staff: leer fotografía: %w", err))
	}
	if !found {
		return StoredPhoto{}, errProfessionalNotFound()
	}
	return photo, nil
}

// RemovePhoto quita la fotografía de un profesional. Es idempotente: quitar una
// fotografía inexistente no es un error mientras el profesional exista.
func (s *Service) RemovePhoto(ctx context.Context, businessID, professionalID string) error {
	if err := ctx.Err(); err != nil {
		return apperr.Internal(fmt.Errorf("staff: contexto cancelado antes de quitar la fotografía: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return errProfessionalNotFound()
	}

	found, err := s.repo.DeletePhoto(ctx, businessID, professionalID)
	if err != nil {
		return apperr.Internal(fmt.Errorf("staff: quitar fotografía: %w", err))
	}
	if !found {
		return errProfessionalNotFound()
	}
	return nil
}

// validateFullName recorta y valida fullNameRaw contra CA-021-03: vacío,
// solo espacios o mayor de FullNameMaxLength caracteres se rechaza sin
// tocar el repositorio. utf8.RuneCountInString cuenta caracteres Unicode,
// no bytes, para que un nombre con tildes o ñ no se rechace de forma
// prematura por el tamaño en bytes de su codificación UTF-8.
func validateFullName(raw string) (string, error) {
	fullName := NormalizeFullName(raw)
	switch {
	case fullName == "":
		return "", errFullNameRequired()
	case utf8.RuneCountInString(fullName) > FullNameMaxLength:
		return "", errFullNameTooLong()
	}
	return fullName, nil
}

// validateDescription normaliza y valida la descripción opcional (DEC-127):
// vacía o de solo espacios equivale a no tener descripción (nil); más de
// DescriptionMaxLength caracteres se rechaza sin tocar el repositorio. Cuenta
// caracteres Unicode, no bytes, por la misma razón que validateFullName.
func validateDescription(raw *string) (*string, error) {
	description := NormalizeDescription(raw)
	if description != nil && utf8.RuneCountInString(*description) > DescriptionMaxLength {
		return nil, errDescriptionTooLong()
	}
	return description, nil
}

// ListPage permite saltar a una página de la tabla sin descargar todo el equipo.
func (s *Service) ListPage(ctx context.Context, shop string, page, size int) (PageResult, error) {
	if err := ctx.Err(); err != nil {
		return PageResult{}, apperr.Internal(err)
	}
	if page < 1 {
		page = 1
	}
	if size <= 0 {
		size = DefaultListLimit
	}
	if size > MaxListLimit {
		size = MaxListLimit
	}
	result, err := s.repo.ListPage(ctx, shop, page, size)
	if err != nil {
		return PageResult{}, apperr.Internal(fmt.Errorf("staff: listar página: %w", err))
	}
	return result, nil
}
