package access

import (
	"context"
	"fmt"

	"nava-agenda/internal/platform/apperr"
)

// Repository lee lo que el control de acceso necesita, siempre dentro del
// tenant de la sesión (RLS, RN-TEN-01).
type Repository interface {
	// RolesAndProfessional devuelve los roles del usuario y el profesional vinculado a
	// él (cadena vacía si no tiene).
	RolesAndProfessional(ctx context.Context, businessID, staffUserID string) (roles []string, professionalID string, err error)
	// AppointmentProfessional devuelve el profesional del turno; found=false si el turno
	// no existe en este negocio.
	AppointmentProfessional(ctx context.Context, businessID, appointmentID string) (professionalID string, found bool, err error)
}

// Service resuelve el alcance de una sesión.
type Service struct {
	repo Repository
}

// NewService construye el servicio de acceso.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// ScopeOf resuelve el alcance del usuario autenticado en su negocio.
func (s *Service) ScopeOf(ctx context.Context, businessID, staffUserID string) (Scope, error) {
	roles, professionalID, err := s.repo.RolesAndProfessional(ctx, businessID, staffUserID)
	if err != nil {
		return Scope{}, apperr.Internal(fmt.Errorf("access: resolver roles y profesional: %w", err))
	}
	if !IsRestricted(roles) {
		return Scope{}, nil
	}
	return Scope{Restricted: true, ProfessionalID: professionalID}, nil
}

// AppointmentProfessional expone el profesional de un turno para la regla OwnAppointment.
func (s *Service) AppointmentProfessional(ctx context.Context, businessID, appointmentID string) (string, bool, error) {
	professionalID, found, err := s.repo.AppointmentProfessional(ctx, businessID, appointmentID)
	if err != nil {
		return "", false, apperr.Internal(fmt.Errorf("access: leer profesional del turno: %w", err))
	}
	return professionalID, found, nil
}
