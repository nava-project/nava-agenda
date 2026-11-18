package shops

import (
	"context"
	"fmt"

	"nava-agenda/internal/platform/apperr"
)

// LoginOTPChannel es el canal por el que el negocio recibe el código del reto
// adicional de acceso (HU-007, DEC-139). Los valores son los del CHECK
// `business_login_otp_channel_ck`.
type LoginOTPChannel string

const (
	// LoginOTPChannelEmail entrega el código por correo; es el valor de las
	// negocios nuevos (DEC-081).
	LoginOTPChannelEmail LoginOTPChannel = "email"
	// LoginOTPChannelWhatsApp lo entrega por WhatsApp oficial al teléfono
	// verificado de la cuenta.
	LoginOTPChannelWhatsApp LoginOTPChannel = "whatsapp"
	// LoginOTPChannelBoth lo entrega por ambos canales con el mismo código.
	LoginOTPChannelBoth LoginOTPChannel = "both"
)

// Valid informa si c es uno de los tres canales admitidos.
func (c LoginOTPChannel) Valid() bool {
	switch c {
	case LoginOTPChannelEmail, LoginOTPChannelWhatsApp, LoginOTPChannelBoth:
		return true
	default:
		return false
	}
}

// LoginOTPRepository es el puerto de persistencia del canal del código de
// acceso. El núcleo no importa internal/platform/database ni pgx (CA-002-06).
type LoginOTPRepository interface {
	// Get lee el canal de businessID dentro de una transacción tenant-aware.
	// found=false cubre una fila no visible en el tenant vigente (defensivo).
	Get(ctx context.Context, businessID string) (channel LoginOTPChannel, found bool, err error)
	// Update escribe el canal y devuelve el valor guardado; found=false cubre una
	// fila no visible. Sin versión de concurrencia: es una preferencia de la
	// negocio y la última escritura gana (mismo criterio que la marca).
	Update(ctx context.Context, businessID string, channel LoginOTPChannel) (stored LoginOTPChannel, found bool, err error)
}

// LoginOTPService implementa leer y cambiar el canal del código de acceso de la
// negocio de la sesión (DEC-139). El negocio llega siempre de un
// auth.Principal: no existe forma de leer o cambiar la de otra (RN-TEN-01).
type LoginOTPService struct {
	repo LoginOTPRepository
}

// NewLoginOTPService construye el servicio.
func NewLoginOTPService(repo LoginOTPRepository) *LoginOTPService {
	return &LoginOTPService{repo: repo}
}

// Get lee el canal vigente.
func (s *LoginOTPService) Get(ctx context.Context, businessID string) (LoginOTPChannel, error) {
	if err := ctx.Err(); err != nil {
		return "", apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de leer el canal del código de acceso: %w", err))
	}
	channel, found, err := s.repo.Get(ctx, businessID)
	if err != nil {
		return "", apperr.Internal(fmt.Errorf("shops: leer canal del código de acceso: %w", err))
	}
	if !found {
		return "", apperr.NotFound("negocio no encontrado")
	}
	return channel, nil
}

// Update valida el canal y lo guarda. Un valor fuera de la lista cerrada se
// rechaza con 422 sin tocar la base de datos.
func (s *LoginOTPService) Update(ctx context.Context, businessID string, channel LoginOTPChannel) (LoginOTPChannel, error) {
	if err := ctx.Err(); err != nil {
		return "", apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de actualizar el canal del código de acceso: %w", err))
	}
	if !channel.Valid() {
		return "", apperr.Validation("channel debe ser email, whatsapp o both")
	}
	stored, found, err := s.repo.Update(ctx, businessID, channel)
	if err != nil {
		return "", apperr.Internal(fmt.Errorf("shops: actualizar canal del código de acceso: %w", err))
	}
	if !found {
		return "", apperr.NotFound("negocio no encontrado")
	}
	return stored, nil
}
