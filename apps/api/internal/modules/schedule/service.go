package schedule

import (
	"context"
	"fmt"

	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// Service implementa los cinco casos de uso de HU-040: listar, consultar,
// crear, editar y retirar tramos de horario laboral recurrente de un
// profesional del negocio activo.
type Service struct {
	repo          Repository
	professionals ProfessionalPort
}

// NewService construye el servicio de casos de uso. professionals colabora con
// staff exclusivamente a través de este puerto (cmd/api lo conecta con
// staff.NewProfessionalLookup): schedule nunca importa el núcleo ni el
// repositorio de staff.
func NewService(repo Repository, professionals ProfessionalPort) *Service {
	return &Service{repo: repo, professionals: professionals}
}

// List lee una página de tramos del profesional de professionalID dentro de
// businessID (CA-040-01). Un professionalID inexistente o de otro negocio
// produce apperr.NotFound, verificado mediante ProfessionalPort antes de tocar
// el repositorio (mismo criterio que catalog.AssignmentService.List).
func (s *Service) List(ctx context.Context, businessID, professionalID, cursorToken string, limit int) (ListResult, error) {
	if err := ctx.Err(); err != nil {
		return ListResult{}, apperr.Internal(fmt.Errorf("schedule: contexto cancelado antes de listar tramos: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return ListResult{}, errProfessionalNotFound()
	}

	exists, err := s.professionals.Exists(ctx, businessID, professionalID)
	if err != nil {
		return ListResult{}, apperr.Internal(fmt.Errorf("schedule: verificar profesional para listar tramos: %w", err))
	}
	if !exists {
		return ListResult{}, errProfessionalNotFound()
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

	result, err := s.repo.List(ctx, businessID, professionalID, cursor, limit)
	if err != nil {
		return ListResult{}, apperr.Internal(fmt.Errorf("schedule: listar tramos: %w", err))
	}
	return result, nil
}

// Get lee un tramo por id dentro del profesional y negocio activos
// (CA-040-05). Un professionalID/workingHourID inexistente, de otro profesional o de
// otro negocio produce el mismo apperr.NotFound.
func (s *Service) Get(ctx context.Context, businessID, professionalID, workingHourID string) (WorkingHour, error) {
	if err := ctx.Err(); err != nil {
		return WorkingHour{}, apperr.Internal(fmt.Errorf("schedule: contexto cancelado antes de leer tramo: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) || !LooksLikeWorkingHourID(workingHourID) {
		return WorkingHour{}, errWorkingHourNotFound()
	}

	wh, found, err := s.repo.Get(ctx, businessID, professionalID, workingHourID)
	if err != nil {
		return WorkingHour{}, apperr.Internal(fmt.Errorf("schedule: leer tramo: %w", err))
	}
	if !found {
		return WorkingHour{}, errWorkingHourNotFound()
	}
	return wh, nil
}

// Create registra un tramo (CA-040-02), protegido por el protocolo de
// idempotencia reutilizable de HU-004 (RN-IDE-01, DEC-043). isoWeekday,
// startsTimeRaw y durationMinutes son los valores crudos del cuerpo; key y
// fingerprint ya fueron interpretados por la capa HTTP. La validación de
// los tres campos ocurre ANTES de tocar ProfessionalPort o el repositorio: un
// tramo inválido nunca reclama ni consume la clave de idempotencia, porque
// no es el efecto que RN-IDE-01 protege (mismo criterio que
// staff.Service.Create).
func (s *Service) Create(
	ctx context.Context,
	businessID, professionalID string,
	isoWeekday int,
	startsTimeRaw string,
	durationMinutes int,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (CreateResult, error) {
	if err := ctx.Err(); err != nil {
		return CreateResult{}, apperr.Internal(fmt.Errorf("schedule: contexto cancelado antes de crear tramo: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) {
		return CreateResult{}, errProfessionalNotFound()
	}

	input, err := validateInterval(isoWeekday, startsTimeRaw, durationMinutes)
	if err != nil {
		return CreateResult{}, err
	}

	exists, err := s.professionals.Exists(ctx, businessID, professionalID)
	if err != nil {
		return CreateResult{}, apperr.Internal(fmt.Errorf("schedule: verificar profesional para crear tramo: %w", err))
	}
	if !exists {
		return CreateResult{}, errProfessionalNotFound()
	}

	result, err := s.repo.Create(ctx, businessID, professionalID, input, key, fingerprint)
	if err != nil {
		return CreateResult{}, apperr.Internal(fmt.Errorf("schedule: crear tramo: %w", err))
	}
	if result.Conflict {
		return CreateResult{}, errOverlapConflict()
	}
	return result, nil
}

// Update reemplaza el intervalo completo de un tramo existente
// (CA-040-04). Un professionalID/workingHourID inexistente, de otro profesional o de
// otro negocio produce el mismo apperr.NotFound que Get (CA-040-05); un
// intervalo nuevo que se solapa con otro tramo existente del mismo profesional
// y día produce apperr.Conflict.
func (s *Service) Update(
	ctx context.Context,
	businessID, professionalID, workingHourID string,
	isoWeekday int,
	startsTimeRaw string,
	durationMinutes int,
) (WorkingHour, error) {
	if err := ctx.Err(); err != nil {
		return WorkingHour{}, apperr.Internal(fmt.Errorf("schedule: contexto cancelado antes de editar tramo: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) || !LooksLikeWorkingHourID(workingHourID) {
		return WorkingHour{}, errWorkingHourNotFound()
	}

	input, err := validateInterval(isoWeekday, startsTimeRaw, durationMinutes)
	if err != nil {
		return WorkingHour{}, err
	}

	result, err := s.repo.Update(ctx, businessID, professionalID, workingHourID, input)
	if err != nil {
		return WorkingHour{}, apperr.Internal(fmt.Errorf("schedule: editar tramo: %w", err))
	}
	if !result.Found {
		return WorkingHour{}, errWorkingHourNotFound()
	}
	if result.Conflict {
		return WorkingHour{}, errOverlapConflict()
	}
	return result.WorkingHour, nil
}

// Delete retira físicamente un tramo existente (CA-040-05). Un
// professionalID/workingHourID inexistente, de otro profesional, de otro negocio, o
// ya retirado antes, producen el mismo apperr.NotFound; reintentar la
// misma operación tras ese error es seguro.
func (s *Service) Delete(ctx context.Context, businessID, professionalID, workingHourID string) error {
	if err := ctx.Err(); err != nil {
		return apperr.Internal(fmt.Errorf("schedule: contexto cancelado antes de retirar tramo: %w", err))
	}
	if !LooksLikeProfessionalID(professionalID) || !LooksLikeWorkingHourID(workingHourID) {
		return errWorkingHourNotFound()
	}

	found, err := s.repo.Delete(ctx, businessID, professionalID, workingHourID)
	if err != nil {
		return apperr.Internal(fmt.Errorf("schedule: retirar tramo: %w", err))
	}
	if !found {
		return errWorkingHourNotFound()
	}
	return nil
}

// validateInterval valida los tres campos de un intervalo (CA-040-04):
// día fuera de 1-7, hora con formato inválido o duración fuera de
// [1, 1440] se rechazan sin tocar ProfessionalPort ni el repositorio.
func validateInterval(isoWeekday int, startsTimeRaw string, durationMinutes int) (CreateInput, error) {
	if isoWeekday < MinISOWeekday || isoWeekday > MaxISOWeekday {
		return CreateInput{}, errISOWeekdayInvalid()
	}
	startsTime, err := ValidateStartsTime(startsTimeRaw)
	if err != nil {
		return CreateInput{}, err
	}
	if durationMinutes < MinDurationMinutes || durationMinutes > MaxDurationMinutes {
		return CreateInput{}, errDurationInvalid()
	}
	return CreateInput{ISOWeekday: isoWeekday, StartsTime: startsTime, DurationMinutes: durationMinutes}, nil
}
