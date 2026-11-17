package customeraccess

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"system-barbershop/internal/platform/apperr"
	"system-barbershop/internal/platform/idempotency"
)

// Service orquesta HU-098: valida la forma del token recibido, lo hashea y
// delega en Repository la resolución tenant-aware. httpapi nunca calcula el
// hash por su cuenta: solo este paquete toca el valor en claro antes de
// descartarlo (CA-098-02, el valor en claro nunca se registra ni persiste).
type Service struct {
	repo                Repository
	versionToken        VersionTokenEncoder
	appointmentCan      AppointmentCanceller
	rescheduler         AppointmentRescheduler
	rescheduleRemaining func(done int) int
}

// VersionTokenEncoder produce el token opaco de versión del turno (If-Match de
// la cancelación, HU-099). Lo inyecta cmd/api con booking.EncodeVersionToken
// para que ambos lados usen EXACTAMENTE el mismo cálculo sin que este módulo
// importe booking.
type VersionTokenEncoder func(appointmentID string, updatedAt time.Time) string

// Option configura capacidades opcionales del servicio.
type Option func(*Service)

// WithVersionTokens habilita la emisión de versionToken en la lectura.
func WithVersionTokens(encode VersionTokenEncoder) Option {
	return func(s *Service) { s.versionToken = encode }
}

// WithCanceller habilita la cancelación del cliente (HU-099).
func WithCanceller(c AppointmentCanceller) Option {
	return func(s *Service) { s.appointmentCan = c }
}

// WithRescheduler habilita la reprogramación del cliente (HU-104). remaining
// traduce las reprogramaciones ya hechas a las que quedan; lo inyecta cmd/api
// con booking.CustomerRescheduleRemaining para que el límite viva en un solo
// sitio.
func WithRescheduler(r AppointmentRescheduler, remaining func(done int) int) Option {
	return func(s *Service) {
		s.rescheduler = r
		s.rescheduleRemaining = remaining
	}
}

// NewService construye el servicio de acceso del cliente.
func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// hashToken valida la forma del token y devuelve su SHA-256 hexadecimal. ok
// es falso para un token vacío o demasiado largo (mismo 404 uniforme que un
// token inexistente).
func hashToken(tokenRaw string) (hash string, ok bool) {
	token := strings.TrimSpace(tokenRaw)
	if token == "" || len(token) > MaxTokenLength {
		return "", false
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:]), true
}

// GetAppointmentByToken resuelve el turno correspondiente al token en claro
// de la URL (CA-098-01). Un token vacío, demasiado largo, inexistente,
// vencido o revocado produce EXACTAMENTE el mismo error NotFound uniforme
// (CA-098-02, RN-TEN-01): la causa nunca se distingue, mismo criterio que
// publicbooking.errBarbershopNotPublic frente a un slug inválido.
func (s *Service) GetAppointmentByToken(ctx context.Context, tokenRaw string) (AppointmentView, error) {
	if err := ctx.Err(); err != nil {
		return AppointmentView{}, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de resolver token: %w", err))
	}

	tokenHash, ok := hashToken(tokenRaw)
	if !ok {
		return AppointmentView{}, errAppointmentAccessDenied()
	}

	view, found, err := s.repo.ResolveAppointmentByTokenHash(ctx, tokenHash)
	if err != nil {
		return AppointmentView{}, apperr.Internal(fmt.Errorf("customeraccess: resolver turno por token: %w", err))
	}
	if !found {
		return AppointmentView{}, errAppointmentAccessDenied()
	}
	if s.versionToken != nil {
		view.VersionToken = s.versionToken(view.AppointmentID, view.UpdatedAt)
	}
	if s.rescheduleRemaining != nil {
		view.RescheduleRemaining = s.rescheduleRemaining(view.CustomerReschedules)
	}
	return view, nil
}

// CancelAppointment ejecuta la cancelación del cliente (HU-099, T5) con la
// credencial del enlace. Un token inválido, inexistente, vencido o ya revocado
// produce el mismo 404 uniforme que la lectura (CA-099-05): este método nunca
// distingue la causa. Todo lo demás (versión, estado, política, idempotencia)
// lo decide booking dentro de una sola transacción con la fila bloqueada.
func (s *Service) CancelAppointment(
	ctx context.Context,
	tokenRaw, expectedVersionToken, reason string,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (idempotency.Decision, idempotency.StoredResponse, error) {
	if err := ctx.Err(); err != nil {
		return idempotency.Decision{}, idempotency.StoredResponse{}, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de cancelar: %w", err))
	}
	if s.appointmentCan == nil {
		return idempotency.Decision{}, idempotency.StoredResponse{}, apperr.Internal(fmt.Errorf("customeraccess: cancelación no configurada"))
	}

	tokenHash, ok := hashToken(tokenRaw)
	if !ok {
		return idempotency.Decision{}, idempotency.StoredResponse{}, errAppointmentAccessDenied()
	}
	target, found, err := s.repo.ResolveCancellationTarget(ctx, tokenHash)
	if err != nil {
		return idempotency.Decision{}, idempotency.StoredResponse{}, apperr.Internal(fmt.Errorf("customeraccess: resolver turno por token: %w", err))
	}
	if !found {
		return idempotency.Decision{}, idempotency.StoredResponse{}, errAppointmentAccessDenied()
	}
	return s.appointmentCan.CancelAppointment(ctx, target.BarbershopID, target.AppointmentID, expectedVersionToken, reason, key, fingerprint)
}

// RescheduleSlots son los inicios a los que el cliente puede mover su turno
// (HU-104), con la zona de la barbería para agruparlos por fecha civil.
type RescheduleSlots struct {
	Timezone string
	Starts   []time.Time
}

// ListRescheduleSlots resuelve el token y pide las franjas a booking. Mismo
// 404 uniforme que la lectura ante cualquier token no vigente.
func (s *Service) ListRescheduleSlots(ctx context.Context, tokenRaw string) (RescheduleSlots, error) {
	target, err := s.resolveRescheduleTarget(ctx, tokenRaw)
	if err != nil {
		return RescheduleSlots{}, err
	}
	starts, err := s.rescheduler.ListRescheduleStarts(ctx, target.BarbershopID, target.AppointmentID)
	if err != nil {
		return RescheduleSlots{}, err
	}
	return RescheduleSlots{Timezone: target.Timezone, Starts: starts}, nil
}

// RescheduleAppointment ejecuta la reprogramación del cliente (HU-104) con la
// credencial del enlace. Versión, estado, plazo, límite, franja e idempotencia
// los decide booking; este método solo resuelve el token.
func (s *Service) RescheduleAppointment(
	ctx context.Context,
	tokenRaw, startsAt, expectedVersionToken string,
	key idempotency.Key,
	fingerprint idempotency.Fingerprint,
) (idempotency.Decision, idempotency.StoredResponse, error) {
	target, err := s.resolveRescheduleTarget(ctx, tokenRaw)
	if err != nil {
		return idempotency.Decision{}, idempotency.StoredResponse{}, err
	}
	return s.rescheduler.RescheduleAppointment(ctx, target.BarbershopID, target.AppointmentID, startsAt, expectedVersionToken, key, fingerprint)
}

func (s *Service) resolveRescheduleTarget(ctx context.Context, tokenRaw string) (CancellationTarget, error) {
	if err := ctx.Err(); err != nil {
		return CancellationTarget{}, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de reprogramar: %w", err))
	}
	if s.rescheduler == nil {
		return CancellationTarget{}, apperr.Internal(fmt.Errorf("customeraccess: reprogramación no configurada"))
	}
	tokenHash, ok := hashToken(tokenRaw)
	if !ok {
		return CancellationTarget{}, errAppointmentAccessDenied()
	}
	target, found, err := s.repo.ResolveCancellationTarget(ctx, tokenHash)
	if err != nil {
		return CancellationTarget{}, apperr.Internal(fmt.Errorf("customeraccess: resolver turno por token: %w", err))
	}
	if !found {
		return CancellationTarget{}, errAppointmentAccessDenied()
	}
	return target, nil
}

// errAppointmentAccessDenied cubre las tres causas de CA-098-02 (token
// inexistente, vencido o revocado) con un único 404 uniforme, mismo
// criterio que publicbooking.errBarbershopNotPublic.
func errAppointmentAccessDenied() error {
	return apperr.NotFound("no existe un turno accesible con ese enlace")
}
