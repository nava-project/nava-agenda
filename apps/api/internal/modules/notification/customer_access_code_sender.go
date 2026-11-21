package notification

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
)

// customerAccessEmailSubject es el asunto fijo del correo con el código con el que
// el cliente entra a su turno (HU-105, DEC-178). Habla de entrar al turno, no de
// cambiar la hora: con el código también se cancela (#753).
const customerAccessEmailSubject = "Tu código para entrar a tu turno"

// ErrUnknownAccessChannel indica un canal que este adaptador no entrega. Es un
// defecto de cableado, no un fallo del proveedor.
var ErrUnknownAccessChannel = errors.New("notification: canal de acceso desconocido")

// customerAccessWhatsAppSender es lo que el adaptador necesita del remitente de
// Meta: la plantilla de autenticación ya viene en su configuración.
type customerAccessWhatsAppSender interface {
	Send(ctx context.Context, phoneE164, code string) error
}

// CustomerAccessCodeSender entrega el código de acceso al turno por el canal
// elegido: correo por Resend o WhatsApp por Meta con la plantilla de autenticación
// propia (HU-105). Satisface customeraccess.AccessCodeSender sin que ese módulo
// conozca a ningún proveedor (CA-002-06).
type CustomerAccessCodeSender struct {
	httpClient *http.Client
	email      ResendEmailConfig
	whatsapp   customerAccessWhatsAppSender
}

// NewCustomerAccessCodeSender construye el adaptador. whatsapp puede ser nil si el
// despliegue no tiene Meta: entonces el canal «whatsapp» falla sin enviar nada.
// httpClient nil usa http.DefaultClient. Subject de email se ignora: es fijo.
func NewCustomerAccessCodeSender(email ResendEmailConfig, whatsapp customerAccessWhatsAppSender, httpClient *http.Client) CustomerAccessCodeSender {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return CustomerAccessCodeSender{httpClient: httpClient, email: email, whatsapp: whatsapp}
}

// SendCode entrega code a destination. businessName nombra al negocio en el
// correo (#753); WhatsApp lo ignora porque su plantilla de autenticación es fija.
// Los errores no incluyen el destinatario ni el código (RN-DAT-02).
func (s CustomerAccessCodeSender) SendCode(ctx context.Context, channel, destination, businessName, code string) error {
	switch channel {
	case "email":
		return postResendEmail(ctx, s.httpClient, s.email, destination, customerAccessEmailSubject, customerAccessEmail(businessName, code))
	case "whatsapp":
		if s.whatsapp == nil {
			return fmt.Errorf("%w: WhatsApp no está configurado", errDeliveryFailed)
		}
		return s.whatsapp.Send(ctx, destination, code)
	default:
		return ErrUnknownAccessChannel
	}
}

// LoggingCustomerAccessCodeSender es el remitente de local/test sin credenciales:
// solo deja constancia del canal, nunca el destinatario ni el código.
type LoggingCustomerAccessCodeSender struct {
	logger *slog.Logger
}

// NewLoggingCustomerAccessCodeSender construye el remitente que solo registra.
func NewLoggingCustomerAccessCodeSender(logger *slog.Logger) LoggingCustomerAccessCodeSender {
	return LoggingCustomerAccessCodeSender{logger: logger}
}

// SendCode registra el envío simulado.
func (s LoggingCustomerAccessCodeSender) SendCode(ctx context.Context, channel, _, _, _ string) error {
	s.logger.InfoContext(ctx, "customeraccess: envío de código simulado (proveedor no configurado)", slog.String("channel", channel))
	return nil
}

// customerAccessEmail es el correo del código de mi turno: el mismo título que la
// pantalla donde se escribe («Escribe tu código», #753) y el negocio que lo envía.
func customerAccessEmail(businessName, code string) emailContent {
	lead := "Escríbelo en la pantalla para entrar a tu turno. Vence en 10 minutos y sirve una sola vez."
	preheader := "Tu código para entrar a tu turno."
	if businessName != "" {
		lead = "Escríbelo en la pantalla para entrar a tu turno en " + businessName + ". Vence en 10 minutos y sirve una sola vez."
		preheader = "Tu código para entrar a tu turno en " + businessName + "."
	}
	return emailContent{
		Preheader:  preheader,
		Brand:      businessName,
		Kicker:     "Tu turno",
		Title:      "Escribe tu código",
		Paragraphs: []string{lead},
		Code:       code,
		Footnotes:  []string{"Si no lo pediste, ignora este mensaje: nadie puede entrar a tu turno sin el código."},
	}
}
