package customeraccess

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/clock"
)

// Mensajes uniformes (DEC-062, CA-105-01): ninguno dice si el contacto existe ni
// cuál de los dos límites se superó.
const (
	invalidAccessCodeMessage = "código de verificación inválido o expirado"
	rateLimitedMessage       = "pediste demasiados códigos; espera un momento antes de intentarlo otra vez"
	businessNotFoundMsg      = "negocio no encontrado"
)

// TokenMinter genera un acceso al turno: el valor en claro y su hash. Lo invoca
// el repositorio dentro de la transacción de la verificación.
type TokenMinter func() (plain, hash string, err error)

// ChallengeRequest es lo que el repositorio necesita para registrar una
// solicitud de código. Los valores sensibles viajan ya como HMAC; Contact.Value
// va en claro solo para buscar al cliente y nunca se registra.
type ChallengeRequest struct {
	Slug        string
	Contact     Contact
	ContactHash string
	IPHash      string
	CodeHash    string
	Now         time.Time
	ExpiresAt   time.Time
}

// ChallengeOutcome es el resultado de registrar una solicitud.
type ChallengeOutcome struct {
	// BusinessFound es false con un slug inexistente, mal formado o no publicable.
	BusinessFound bool
	// RateLimited indica que se superó el límite por contacto o por IP; RetryAfter
	// es lo que falta para que deje de aplicar.
	RateLimited bool
	RetryAfter  time.Duration
	// Matched indica que hay un cliente con ese contacto y algún turno futuro
	// confirmado: solo entonces se envía el código. Nunca llega al cliente.
	Matched bool
}

// VerifyRequest es lo que el repositorio necesita para verificar un código.
type VerifyRequest struct {
	Slug        string
	ContactHash string
	CodeHash    string
	Now         time.Time
	TokenTTL    time.Duration
	MaxAttempts int
}

// AccessAppointment es un turno al que la verificación dio acceso: el valor en
// claro del acceso, que viaja una sola vez, y lo mínimo para elegir entre varios.
type AccessAppointment struct {
	AccessToken      string
	StartsAt         time.Time
	ServiceName      string
	ProfessionalName string
}

// VerifyOutcome es el resultado de verificar un código. Un código incorrecto,
// vencido, agotado o inexistente producen el mismo Valid=false.
type VerifyOutcome struct {
	BusinessFound bool
	Valid         bool
	Appointments  []AccessAppointment
	// Timezone es la del negocio, para que la lista de turnos muestre la hora
	// de allí y no la del dispositivo (RN-DIS-07).
	Timezone string
}

// AccessRepository es el puerto de persistencia del acceso con código. Cada
// operación es una sola transacción del negocio.
type AccessRepository interface {
	RequestChallenge(ctx context.Context, req ChallengeRequest) (ChallengeOutcome, error)
	VerifyChallenge(ctx context.Context, req VerifyRequest, mint TokenMinter) (VerifyOutcome, error)
}

// AccessCodeSender entrega el código en claro al contacto ya verificado contra
// el cliente. channel es «email» o «whatsapp». El error devuelto nunca incluye
// el destinatario ni el código (RN-DAT-02).
type AccessCodeSender interface {
	SendCode(ctx context.Context, channel, destination, code string) error
}

// AccessChallengeAccepted es la respuesta de pedir un código: idéntica exista o
// no el contacto.
type AccessChallengeAccepted struct {
	ExpiresInSeconds   int
	ResendAfterSeconds int
}

// AccessVerified es la respuesta de verificar un código.
type AccessVerified struct {
	Timezone     string
	Appointments []AccessAppointment
}

// AccessService implementa el acceso al turno con un código de un solo uso
// (HU-105, DEC-178). No conoce Chi, net/http ni PostgreSQL.
type AccessService struct {
	repo    AccessRepository
	sender  AccessCodeSender
	codes   CodeGenerator
	clock   clock.Clock
	secret  []byte
	logger  *slog.Logger
	deliver func(func())
}

// NewAccessService construye el servicio. secret firma el HMAC del contacto, la
// IP y el código; nunca se registra. La entrega corre en segundo plano para que
// pedir un código tarde lo mismo exista o no el contacto (CA-105-01).
func NewAccessService(repo AccessRepository, sender AccessCodeSender, codes CodeGenerator, clk clock.Clock, secret []byte, logger *slog.Logger) *AccessService {
	return &AccessService{
		repo: repo, sender: sender, codes: codes, clock: clk, secret: secret, logger: logger,
		deliver: func(fn func()) { go fn() },
	}
}

// WithSynchronousDelivery hace que la entrega ocurra antes de responder. Existe
// para las pruebas, que necesitan observar el envío; el arranque real no lo usa.
func (s *AccessService) WithSynchronousDelivery() *AccessService {
	s.deliver = func(fn func()) { fn() }
	return s
}

// RequestCode registra la solicitud y, solo si hay un cliente con ese contacto y
// algún turno futuro confirmado, envía el código. La respuesta es la misma en los
// dos casos (CA-105-01); el único rechazo que depende del uso es el límite (429).
func (s *AccessService) RequestCode(ctx context.Context, slug, rawContact, rawIP string) (AccessChallengeAccepted, error) {
	if err := ctx.Err(); err != nil {
		return AccessChallengeAccepted{}, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de pedir el código: %w", err))
	}
	contact, err := NormalizeContact(rawContact)
	if err != nil {
		return AccessChallengeAccepted{}, err
	}

	// Se genera y se hashea un código también cuando no habrá envío: así las dos
	// ramas hacen el mismo trabajo antes de tocar la base.
	code, err := s.codes.New()
	if err != nil {
		return AccessChallengeAccepted{}, apperr.Internal(err)
	}
	now := s.clock.Now()
	cHash := contactHash(contact, s.secret)
	outcome, err := s.repo.RequestChallenge(ctx, ChallengeRequest{
		Slug:        slug,
		Contact:     contact,
		ContactHash: cHash,
		IPHash:      ipHash(rawIP, s.secret),
		CodeHash:    codeHash(cHash, code, s.secret),
		Now:         now,
		ExpiresAt:   now.Add(AccessCodeTTL),
	})
	if err != nil {
		return AccessChallengeAccepted{}, apperr.Internal(fmt.Errorf("customeraccess: registrar la solicitud de código: %w", err))
	}
	switch {
	case !outcome.BusinessFound:
		return AccessChallengeAccepted{}, apperr.NotFound(businessNotFoundMsg)
	case outcome.RateLimited:
		return AccessChallengeAccepted{}, apperr.RateLimited(rateLimitedMessage, retryAfterSeconds(outcome.RetryAfter))
	}

	if outcome.Matched {
		s.dispatch(contact, code)
	}
	return AccessChallengeAccepted{
		ExpiresInSeconds:   int(AccessCodeTTL / time.Second),
		ResendAfterSeconds: AccessResendAfterSeconds,
	}, nil
}

// dispatch entrega el código en segundo plano con un contexto propio: la
// solicitud HTTP ya respondió y su contexto se cancela. Un fallo solo se registra
// con el canal; la persona puede pedir otro código.
func (s *AccessService) dispatch(contact Contact, code string) {
	s.deliver(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := s.sender.SendCode(ctx, string(contact.Channel), contact.Value, code); err != nil && s.logger != nil {
			s.logger.Error("customeraccess.code.delivery_failed", slog.String("channel", string(contact.Channel)))
		}
	})
}

// VerifyCode valida el código y, si es válido, consume el reto y emite un acceso
// de 60 minutos por cada turno futuro confirmado del cliente. Cualquier fallo del
// código produce el mismo error (CA-105-02).
func (s *AccessService) VerifyCode(ctx context.Context, slug, rawContact, rawCode string) (AccessVerified, error) {
	if err := ctx.Err(); err != nil {
		return AccessVerified{}, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de verificar el código: %w", err))
	}
	contact, err := NormalizeContact(rawContact)
	if err != nil {
		return AccessVerified{}, err
	}
	if !ValidAccessCode(rawCode) {
		return AccessVerified{}, apperr.Validation("el código tiene 6 dígitos")
	}

	cHash := contactHash(contact, s.secret)
	outcome, err := s.repo.VerifyChallenge(ctx, VerifyRequest{
		Slug:        slug,
		ContactHash: cHash,
		CodeHash:    codeHash(cHash, rawCode, s.secret),
		Now:         s.clock.Now(),
		TokenTTL:    AccessTokenTTL,
		MaxAttempts: AccessCodeMaxAttempts,
	}, mintAccessToken)
	if err != nil {
		return AccessVerified{}, apperr.Internal(fmt.Errorf("customeraccess: verificar el código: %w", err))
	}
	switch {
	case !outcome.BusinessFound:
		return AccessVerified{}, apperr.NotFound(businessNotFoundMsg)
	case !outcome.Valid:
		return AccessVerified{}, apperr.Unauthorized(invalidAccessCodeMessage)
	}
	return AccessVerified{Timezone: outcome.Timezone, Appointments: outcome.Appointments}, nil
}

// retryAfterSeconds redondea hacia arriba y nunca devuelve menos de un segundo:
// Retry-After en cero invitaría a reintentar de inmediato.
func retryAfterSeconds(d time.Duration) int {
	seconds := int((d + time.Second - 1) / time.Second)
	if seconds < 1 {
		return 1
	}
	return seconds
}
