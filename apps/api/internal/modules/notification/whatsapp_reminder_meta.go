package notification

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
)

// DefaultReminderTemplateName y DefaultReminderLanguageCode identifican la
// plantilla UTILITY del recordatorio creada en la cuenta de WhatsApp Business
// (DEC-175). Se pueden cambiar por entorno sin recompilar.
const (
	DefaultReminderTemplateName = "nava_recordatorio_turno"
	DefaultReminderLanguageCode = "es_CO"
)

// MetaReminderConfig es lo propio de la plantilla del recordatorio; el número
// emisor, el token y la versión de la API son los del código de acceso.
type MetaReminderConfig struct {
	TemplateName string
	LanguageCode string
}

// MetaReminderSender satisface appointmentnotice.WhatsAppReminderSender con la
// plantilla `nava_recordatorio_turno`, de forma estructural (este paquete no
// importa la cola de avisos): cinco parámetros de cuerpo (nombre,
// negocio, cuándo, servicio y quién atiende), sin botones.
type MetaReminderSender struct {
	meta MetaWhatsAppSender
	cfg  MetaReminderConfig
}

// NewMetaReminderSender construye el adaptador sobre el emisor de Meta ya
// configurado. Sin nombre o idioma usa los de la plantilla aprobada.
func NewMetaReminderSender(meta MetaWhatsAppSender, cfg MetaReminderConfig) MetaReminderSender {
	if cfg.TemplateName == "" {
		cfg.TemplateName = DefaultReminderTemplateName
	}
	if cfg.LanguageCode == "" {
		cfg.LanguageCode = DefaultReminderLanguageCode
	}
	return MetaReminderSender{meta: meta, cfg: cfg}
}

// permanentError marca un rechazo que no se arregla reintentando: el
// despachador cierra el aviso como fallido sin repetirlo.
type permanentError struct{ err error }

func (e permanentError) Error() string   { return e.err.Error() }
func (e permanentError) Unwrap() error   { return e.err }
func (e permanentError) Permanent() bool { return true }

// SendReminder satisface appointmentnotice.WhatsAppReminderSender. Un número
// inválido, inalcanzable o fuera de la lista de pruebas es permanente; un
// límite de Meta, una falla de red o la plantilla aún sin aprobar se
// reintentan con la espera del despachador.
func (s MetaReminderSender) SendReminder(
	ctx context.Context,
	phoneE164, attendeeName, businessName, when, serviceName, professionalName string,
) error {
	if !e164Pattern.MatchString(phoneE164) {
		return permanentError{ErrInvalidRecipient}
	}
	if len(s.meta.cfg.TestRecipients) > 0 && !slices.Contains(s.meta.cfg.TestRecipients, phoneE164) {
		return permanentError{ErrRecipientNotAuthorized}
	}
	params := []string{attendeeName, businessName, when, serviceName, professionalName}
	_, err := s.meta.post(ctx, s.buildMessage(strings.TrimPrefix(phoneE164, "+"), params))
	if err != nil && (errors.Is(err, ErrRecipientUnreachable) || errors.Is(err, ErrRecipientNotAllowed)) {
		return permanentError{err}
	}
	return err
}

// buildMessage arma la plantilla; params va en el orden {{1}}…{{5}} del cuerpo.
func (s MetaReminderSender) buildMessage(to string, params []string) metaMessage {
	body := make([]metaParameter, len(params))
	for i, p := range params {
		body[i] = metaParameter{Type: "text", Text: templateText(p)}
	}
	return metaMessage{
		MessagingProduct: "whatsapp",
		RecipientType:    "individual",
		To:               to,
		Type:             "template",
		Template: &metaTemplate{
			Name:       s.cfg.TemplateName,
			Language:   metaLanguage{Code: s.cfg.LanguageCode},
			Components: []metaComponent{{Type: "body", Parameters: body}},
		},
	}
}

var templateSpace = regexp.MustCompile(`\s+`)

// maxTemplateParam deja cada parámetro muy por debajo del límite de Meta.
const maxTemplateParam = 120

// templateText adapta un valor a lo que Meta admite en un parámetro de
// plantilla: sin saltos de línea, tabulaciones ni espacios repetidos, y nunca
// vacío (Meta rechaza un parámetro vacío).
func templateText(v string) string {
	v = strings.TrimSpace(templateSpace.ReplaceAllString(v, " "))
	if r := []rune(v); len(r) > maxTemplateParam {
		v = strings.TrimSpace(string(r[:maxTemplateParam-1])) + "…"
	}
	if v == "" {
		return "—"
	}
	return v
}
