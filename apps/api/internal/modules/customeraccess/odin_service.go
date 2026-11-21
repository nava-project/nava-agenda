package customeraccess

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/clock"
)

// Política del acceso que pide Odin (DEC-179, HU-106).
const (
	// PurposeCancel y PurposeReschedule atan el acceso a una sola acción: la
	// página abre la cancelación o lleva a «Cambiar la hora» (DEC-179, DEC-180).
	PurposeCancel     = "cancel"
	PurposeReschedule = "reschedule"
	// PurposeManage es el acceso sin acción elegida: Odin ya confirmó el turno con
	// el cliente y la persona decide en el paso 03 si cancela o cambia la hora. Es
	// el propósito por defecto cuando Odin no envía ninguno (DEC-181).
	PurposeManage = "manage"

	// AppointmentRefTTL es lo que vale la referencia de un turno desde que Odin la
	// recibe en `lookup`: el tiempo que el cliente tarda en responder que sí.
	AppointmentRefTTL = 30 * time.Minute

	// ServiceRequestsPerBusiness es el tope de códigos que el servicio de Odin
	// puede pedir por negocio en la ventana. Reemplaza al límite por IP, que no
	// sirve: todo Odin sale de una sola dirección.
	ServiceRequestsPerBusiness = 30

	// maxAccessRefLength acota el valor recibido antes de hashear o consultar.
	maxAccessRefLength = 128
)

// serviceHashValue es la «IP» de las solicitudes de Odin: una constante de
// servicio, para que su límite por negocio no se mezcle con el de las personas.
const serviceHashValue = "service:odin"

// ChangePolicy son las reglas con las que el cliente puede cambiar su turno.
// Las define booking (RN-CAN-01, DEC-178); customeraccess no lo importa
// (CA-002-06), así que el arranque las inyecta.
type ChangePolicy struct {
	// CanCancel dice si hoy el cliente puede cancelar un turno que empieza en
	// startsAt (dentro de plazo, o tardía si el negocio la admite).
	CanCancel func(startsAt, now time.Time, deadlineMinutes int, lateAllowed bool) bool
	// CanReschedule dice si hoy puede cambiar la hora: dentro de plazo y con
	// reprogramaciones propias disponibles.
	CanReschedule func(startsAt, now time.Time, deadlineMinutes, customerReschedules int) bool
}

// AppointmentCandidate es un turno futuro confirmado del cliente con lo necesario
// para decidir qué puede hacer con él.
type AppointmentCandidate struct {
	ID                  string
	StartsAt            time.Time
	ServiceName         string
	ProfessionalName    string
	DeadlineMinutes     int
	LateCancelAllowed   bool
	CustomerReschedules int
}

// LookupOutcome es el resultado de buscar los turnos de un teléfono.
type LookupOutcome struct {
	BusinessFound bool
	Candidates    []AppointmentCandidate
}

// RefChallengeRequest es lo que el repositorio necesita para registrar un reto
// atado a un turno. Eligible lo evalúa con los datos leídos dentro de la misma
// transacción, así que la elegibilidad no puede cambiar entre comprobar y crear.
type RefChallengeRequest struct {
	Slug          string
	Contact       Contact
	ContactHash   string
	ServiceHash   string
	CodeHash      string
	AccessRefHash string
	AppointmentID string
	Purpose       string
	Now           time.Time
	ExpiresAt     time.Time
	Eligible      func(AppointmentCandidate) bool
}

// RefChallengeOutcome es el resultado de registrar el reto.
type RefChallengeOutcome struct {
	BusinessFound bool
	// Available es falso si el turno no es de ese teléfono en ese negocio o ya no
	// es elegible para el propósito.
	Available   bool
	RateLimited bool
	RetryAfter  time.Duration
	// BusinessName es el nombre del negocio para el mensaje del código (#753).
	BusinessName string
}

// VerifyRefRequest es lo que el repositorio necesita para verificar el código de
// una referencia. CodeHashFor calcula el HMAC del código con el contacto del
// propio reto: quien verifica no conoce el teléfono.
type VerifyRefRequest struct {
	Slug          string
	AccessRefHash string
	CodeHashFor   func(contactHash string) string
	Now           time.Time
	TokenTTL      time.Duration
	MaxAttempts   int
}

// VerifyRefOutcome es el resultado de verificar. Cualquier fallo es Valid=false.
type VerifyRefOutcome struct {
	BusinessFound bool
	Valid         bool
	AccessToken   string
	Purpose       string
}

// OdinRepository es el puerto de persistencia del acceso que pide Odin.
type OdinRepository interface {
	LookupUpcoming(ctx context.Context, slug, phone string, now time.Time) (LookupOutcome, error)
	RequestRefChallenge(ctx context.Context, req RefChallengeRequest) (RefChallengeOutcome, error)
	VerifyRef(ctx context.Context, req VerifyRefRequest, mint TokenMinter) (VerifyRefOutcome, error)
}

// OdinAppointment es un turno tal como se le muestra a Odin: sin identificadores
// internos, sin nombre ni contacto del cliente.
type OdinAppointment struct {
	Ref              string
	StartsAt         time.Time
	ServiceName      string
	ProfessionalName string
	CanCancel        bool
	CanReschedule    bool
}

// RefChallengeAccepted es la respuesta de pedir un código atado a un turno.
type RefChallengeAccepted struct {
	AccessRef string
	ExpiresAt time.Time
	// Purpose es el propósito con el que quedó el reto (`manage` si Odin no envió).
	Purpose string
}

// RefVerified es la respuesta de verificar la referencia con su código.
type RefVerified struct {
	AccessToken string
	Purpose     string
}

// RefService implementa el acceso que Odin pide por WhatsApp (HU-106, DEC-179). No
// conoce Chi, net/http ni PostgreSQL.
type RefService struct {
	repo      OdinRepository
	sender    AccessCodeSender
	codes     CodeGenerator
	clock     clock.Clock
	secret    []byte
	policy    ChangePolicy
	logger    *slog.Logger
	deliver   func(func())
	whatsapp  bool
	newAccess TokenMinter
}

// NewRefService construye el servicio. whatsappReady indica si el envío por
// WhatsApp está configurado: sin él, pedir un código responde 503 en vez de
// aceptar un código que nadie recibirá.
func NewRefService(
	repo OdinRepository, sender AccessCodeSender, codes CodeGenerator, clk clock.Clock,
	secret []byte, policy ChangePolicy, whatsappReady bool, logger *slog.Logger,
) *RefService {
	return &RefService{
		repo: repo, sender: sender, codes: codes, clock: clk, secret: secret, policy: policy,
		logger: logger, whatsapp: whatsappReady, newAccess: mintAccessToken,
		deliver: func(fn func()) { go fn() },
	}
}

// WithSynchronousDelivery hace que la entrega ocurra antes de responder; existe
// para las pruebas.
func (s *RefService) WithSynchronousDelivery() *RefService {
	s.deliver = func(fn func()) { fn() }
	return s
}

func (s *RefService) phone(raw string) (Contact, error) {
	contact, err := NormalizeContact(raw)
	if err != nil {
		return Contact{}, err
	}
	if contact.Channel != ChannelWhatsApp {
		return Contact{}, apperr.Validation("escribe un celular válido")
	}
	return contact, nil
}

// Lookup lista los turnos futuros confirmados de un teléfono en ese negocio, con
// una referencia opaca por turno y lo que el cliente puede hacer hoy con él.
func (s *RefService) Lookup(ctx context.Context, slug, rawPhone string) ([]OdinAppointment, error) {
	if err := ctx.Err(); err != nil {
		return nil, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de buscar: %w", err))
	}
	contact, err := s.phone(rawPhone)
	if err != nil {
		return nil, err
	}
	now := s.clock.Now()
	outcome, err := s.repo.LookupUpcoming(ctx, slug, contact.Value, now)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("customeraccess: buscar los turnos: %w", err))
	}
	if !outcome.BusinessFound {
		return nil, apperr.NotFound(businessNotFoundMsg)
	}

	out := make([]OdinAppointment, 0, len(outcome.Candidates))
	for _, c := range outcome.Candidates {
		ref, err := sealAppointmentRef(c.ID, slug, now.Add(AppointmentRefTTL), s.secret)
		if err != nil {
			return nil, apperr.Internal(fmt.Errorf("customeraccess: referencia del turno: %w", err))
		}
		out = append(out, OdinAppointment{
			Ref: ref, StartsAt: c.StartsAt, ServiceName: c.ServiceName, ProfessionalName: c.ProfessionalName,
			CanCancel:     s.eligible(c, PurposeCancel, now),
			CanReschedule: s.eligible(c, PurposeReschedule, now),
		})
	}
	return out, nil
}

func (s *RefService) eligible(c AppointmentCandidate, purpose string, now time.Time) bool {
	switch purpose {
	case PurposeCancel:
		return s.policy.CanCancel != nil && s.policy.CanCancel(c.StartsAt, now, c.DeadlineMinutes, c.LateCancelAllowed)
	case PurposeReschedule:
		return s.policy.CanReschedule != nil && s.policy.CanReschedule(c.StartsAt, now, c.DeadlineMinutes, c.CustomerReschedules)
	case PurposeManage:
		// Basta con que admita una de las dos: el paso 03 apaga la otra con su motivo.
		return s.eligible(c, PurposeCancel, now) || s.eligible(c, PurposeReschedule, now)
	}
	return false
}

// RequestCode crea un reto atado a un turno y a un propósito y manda el código al
// teléfono por WhatsApp. Un propósito vacío es `manage` (DEC-181). Una referencia
// ajena, vencida o de otro negocio, o un turno que ya no es elegible, producen el
// mismo rechazo (CA-106-03).
func (s *RefService) RequestCode(ctx context.Context, slug, rawPhone, ref, purpose string) (RefChallengeAccepted, error) {
	if err := ctx.Err(); err != nil {
		return RefChallengeAccepted{}, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de pedir el código: %w", err))
	}
	if purpose == "" {
		purpose = PurposeManage
	}
	if purpose != PurposeCancel && purpose != PurposeReschedule && purpose != PurposeManage {
		return RefChallengeAccepted{}, apperr.Validation("el propósito debe ser manage, cancel o reschedule")
	}
	contact, err := s.phone(rawPhone)
	if err != nil {
		return RefChallengeAccepted{}, err
	}
	if !s.whatsapp {
		return RefChallengeAccepted{}, apperr.Unavailable("el envío por WhatsApp no está disponible")
	}

	now := s.clock.Now()
	appointmentID, ok := openAppointmentRef(ref, slug, now, s.secret)
	if !ok {
		return RefChallengeAccepted{}, errAppointmentNotAvailable()
	}

	code, err := s.codes.New()
	if err != nil {
		return RefChallengeAccepted{}, apperr.Internal(err)
	}
	accessRef, accessRefHash, err := s.newAccess()
	if err != nil {
		return RefChallengeAccepted{}, apperr.Internal(err)
	}
	cHash := contactHash(contact, s.secret)
	expiresAt := now.Add(AccessCodeTTL)
	outcome, err := s.repo.RequestRefChallenge(ctx, RefChallengeRequest{
		Slug: slug, Contact: contact, ContactHash: cHash,
		ServiceHash:   ipHash(serviceHashValue, s.secret),
		CodeHash:      codeHash(cHash, code, s.secret),
		AccessRefHash: accessRefHash, AppointmentID: appointmentID, Purpose: purpose,
		Now: now, ExpiresAt: expiresAt,
		Eligible: func(c AppointmentCandidate) bool { return s.eligible(c, purpose, now) },
	})
	if err != nil {
		return RefChallengeAccepted{}, apperr.Internal(fmt.Errorf("customeraccess: registrar el reto: %w", err))
	}
	switch {
	case !outcome.BusinessFound:
		return RefChallengeAccepted{}, apperr.NotFound(businessNotFoundMsg)
	case outcome.RateLimited:
		return RefChallengeAccepted{}, apperr.RateLimited(rateLimitedMessage, retryAfterSeconds(outcome.RetryAfter))
	case !outcome.Available:
		return RefChallengeAccepted{}, errAppointmentNotAvailable()
	}

	s.dispatch(contact, outcome.BusinessName, code)
	return RefChallengeAccepted{AccessRef: accessRef, ExpiresAt: expiresAt, Purpose: purpose}, nil
}

// dispatch entrega el código en segundo plano con un contexto propio. Un fallo solo
// deja constancia del canal: el cliente puede pedir otro desde Odin.
func (s *RefService) dispatch(contact Contact, businessName, code string) {
	s.deliver(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := s.sender.SendCode(ctx, string(contact.Channel), contact.Value, businessName, code); err != nil && s.logger != nil {
			s.logger.Error("customeraccess.ref_code.delivery_failed", slog.String("channel", string(contact.Channel)))
		}
	})
}

// VerifyRef valida el código de una referencia y, si es válido, consume el reto y
// emite un acceso de 60 minutos solo a ese turno. Cualquier fallo produce el mismo
// error (CA-106-05).
func (s *RefService) VerifyRef(ctx context.Context, slug, accessRef, rawCode string) (RefVerified, error) {
	if err := ctx.Err(); err != nil {
		return RefVerified{}, apperr.Internal(fmt.Errorf("customeraccess: contexto cancelado antes de verificar: %w", err))
	}
	if !ValidAccessCode(rawCode) {
		return RefVerified{}, apperr.Validation("el código tiene 6 dígitos")
	}
	hash, ok := hashAccessRef(accessRef)
	if !ok {
		return RefVerified{}, apperr.Unauthorized(invalidAccessCodeMessage)
	}

	outcome, err := s.repo.VerifyRef(ctx, VerifyRefRequest{
		Slug: slug, AccessRefHash: hash,
		CodeHashFor: func(contactHash string) string { return codeHash(contactHash, rawCode, s.secret) },
		Now:         s.clock.Now(), TokenTTL: AccessTokenTTL, MaxAttempts: AccessCodeMaxAttempts,
	}, mintAccessToken)
	if err != nil {
		return RefVerified{}, apperr.Internal(fmt.Errorf("customeraccess: verificar la referencia: %w", err))
	}
	switch {
	case !outcome.BusinessFound:
		return RefVerified{}, apperr.NotFound(businessNotFoundMsg)
	case !outcome.Valid:
		return RefVerified{}, apperr.Unauthorized(invalidAccessCodeMessage)
	}
	return RefVerified{AccessToken: outcome.AccessToken, Purpose: outcome.Purpose}, nil
}

func errAppointmentNotAvailable() error {
	return apperr.AppointmentNotAvailable("ese turno no está disponible para este cambio")
}
