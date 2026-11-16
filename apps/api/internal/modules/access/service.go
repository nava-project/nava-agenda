package access

import (
	"context"
	"fmt"

	"system-barbershop/internal/platform/apperr"
)

// Repository lee lo que el control de acceso necesita, siempre dentro del
// tenant de la sesión (RLS, RN-TEN-01).
type Repository interface {
	// RolesAndBarber devuelve los roles del usuario y el barbero vinculado a
	// él (cadena vacía si no tiene).
	RolesAndBarber(ctx context.Context, barbershopID, staffUserID string) (roles []string, barberID string, err error)
	// AppointmentBarber devuelve el barbero del turno; found=false si el turno
	// no existe en esta barbería.
	AppointmentBarber(ctx context.Context, barbershopID, appointmentID string) (barberID string, found bool, err error)
}

// Service resuelve el alcance de una sesión.
type Service struct {
	repo Repository
}

// NewService construye el servicio de acceso.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// ScopeOf resuelve el alcance del usuario autenticado en su barbería.
func (s *Service) ScopeOf(ctx context.Context, barbershopID, staffUserID string) (Scope, error) {
	roles, barberID, err := s.repo.RolesAndBarber(ctx, barbershopID, staffUserID)
	if err != nil {
		return Scope{}, apperr.Internal(fmt.Errorf("access: resolver roles y barbero: %w", err))
	}
	if !IsRestricted(roles) {
		return Scope{}, nil
	}
	return Scope{Restricted: true, BarberID: barberID}, nil
}

// AppointmentBarber expone el barbero de un turno para la regla OwnAppointment.
func (s *Service) AppointmentBarber(ctx context.Context, barbershopID, appointmentID string) (string, bool, error) {
	barberID, found, err := s.repo.AppointmentBarber(ctx, barbershopID, appointmentID)
	if err != nil {
		return "", false, apperr.Internal(fmt.Errorf("access: leer barbero del turno: %w", err))
	}
	return barberID, found, nil
}
