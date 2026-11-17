package customeraccess

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"system-barbershop/internal/platform/apperr"
)

// Política del acceso con código (DEC-178, HU-105). Son constantes del dominio
// y no configuración: la historia las fija y un cambio es una decisión nueva.
const (
	// AccessCodeTTL es la vigencia del código.
	AccessCodeTTL = 10 * time.Minute
	// AccessCodeMaxAttempts son los intentos que admite un código antes de quedar
	// inútil.
	AccessCodeMaxAttempts = 5
	// AccessRequestWindow es la ventana de los límites de solicitud.
	AccessRequestWindow = 15 * time.Minute
	// AccessRequestsPerContact son las solicitudes de código que admite un mismo
	// contacto dentro de la ventana.
	AccessRequestsPerContact = 3
	// AccessRequestsPerIP son las solicitudes que admite una misma IP dentro de la
	// ventana, sin importar el contacto.
	AccessRequestsPerIP = 10
	// AccessTokenTTL es la vida de cada acceso al turno que emite la verificación.
	// El enlace del correo sigue valiendo 90 días (DEC-089).
	AccessTokenTTL = 60 * time.Minute
	// AccessResendAfterSeconds es lo que la interfaz espera antes de ofrecer
	// «reenviar». Orienta a la pantalla; el límite real es el de solicitudes.
	AccessResendAfterSeconds = 60
	// MaxAccessAppointments acota los turnos que devuelve una verificación.
	MaxAccessAppointments = 10
	// accessCodeDigits es el largo del código: sencillo de digitar (DEC-178).
	accessCodeDigits = 6
)

// Channel es el medio por el que viaja el código.
type Channel string

const (
	// ChannelEmail entrega por correo.
	ChannelEmail Channel = "email"
	// ChannelWhatsApp entrega por WhatsApp.
	ChannelWhatsApp Channel = "whatsapp"
)

// Contact es el contacto que la persona escribió, ya normalizado. El canal sale
// de su forma: un correo lleva «@»; lo demás es un celular.
type Contact struct {
	Channel Channel
	// Value es el correo en minúsculas o el teléfono en E.164.
	Value string
}

var (
	contactEmailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
	contactPhonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	// colombianPhonePattern endurece el prefijo +57 (DEC-141): 10 dígitos nacionales.
	colombianPhonePattern = regexp.MustCompile(`^\+57[0-9]{10}$`)
	// colombianMobilePattern es un celular colombiano escrito sin prefijo.
	colombianMobilePattern = regexp.MustCompile(`^3[0-9]{9}$`)
	phoneSeparators        = strings.NewReplacer(" ", "", "-", "", ".", "", "(", "", ")", "")
	accessCodePattern      = regexp.MustCompile(`^[0-9]{6}$`)
)

// maxContactLength es el largo máximo de un correo (RFC 5321).
const maxContactLength = 254

// invalidContactMessage es el texto de un contacto con forma inválida. Habla de
// la forma que se escribió, nunca de si el contacto existe.
const invalidContactMessage = "escribe un correo o un celular válido"

// NormalizeContact devuelve el contacto en su forma canónica o un error de
// validación. Acepta el celular colombiano con o sin «+57» (DEC-141).
func NormalizeContact(raw string) (Contact, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(trimmed) > maxContactLength {
		return Contact{}, apperr.Validation(invalidContactMessage)
	}
	if strings.Contains(trimmed, "@") {
		email := strings.ToLower(trimmed)
		if !contactEmailPattern.MatchString(email) {
			return Contact{}, apperr.Validation(invalidContactMessage)
		}
		return Contact{Channel: ChannelEmail, Value: email}, nil
	}

	phone := phoneSeparators.Replace(trimmed)
	switch {
	case colombianMobilePattern.MatchString(phone):
		phone = "+57" + phone
	case strings.HasPrefix(phone, "57") && len(phone) == 12:
		phone = "+" + phone
	}
	if !contactPhonePattern.MatchString(phone) {
		return Contact{}, apperr.Validation(invalidContactMessage)
	}
	if strings.HasPrefix(phone, "+57") && !colombianPhonePattern.MatchString(phone) {
		return Contact{}, apperr.Validation(invalidContactMessage)
	}
	return Contact{Channel: ChannelWhatsApp, Value: phone}, nil
}

// ValidAccessCode indica si code tiene la forma del código: 6 dígitos.
func ValidAccessCode(code string) bool { return accessCodePattern.MatchString(code) }

// CodeGenerator produce el código de 6 dígitos.
type CodeGenerator interface {
	New() (string, error)
}

// CryptoCodeGenerator implementa [CodeGenerator] con crypto/rand: distribución
// uniforme sobre 000000-999999 (mismo criterio que el reto del personal, DEC-062).
type CryptoCodeGenerator struct{}

// New implementa [CodeGenerator]. rand.Int con un límite exacto evita el sesgo
// de módulo que produciría reducir bytes aleatorios.
func (CryptoCodeGenerator) New() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("customeraccess: generar el código de acceso: %w", err)
	}
	return fmt.Sprintf("%0*d", accessCodeDigits, n.Int64()), nil
}

// hmacHex calcula HMAC-SHA256(secret, value) en hexadecimal minúscula (64
// caracteres). Contacto, IP y código son espacios de baja entropía: nunca se
// guardan en claro ni con un SHA-256 simple (DEC-062).
func hmacHex(value string, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

// Cada valor se hashea con su propio dominio para que un hash de IP no pueda
// confundirse con uno de contacto ni de código.
func contactHash(c Contact, secret []byte) string {
	return hmacHex("customer-access:contact:"+string(c.Channel)+":"+c.Value, secret)
}

func ipHash(rawIP string, secret []byte) string {
	return hmacHex("customer-access:ip:"+rawIP, secret)
}

// codeHash ata el código al contacto: el mismo número para otro contacto da otro hash.
func codeHash(contactHash, code string, secret []byte) string {
	return hmacHex("customer-access:code:"+contactHash+":"+code, secret)
}

// mintAccessToken genera un acceso al turno: 256 bits aleatorios en base64 URL
// (mismo formato que el del correo de confirmación, DEC-089) y su SHA-256. Solo
// el hash se persiste.
func mintAccessToken() (plain, hash string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("customeraccess: generar el acceso al turno: %w", err)
	}
	plain = base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(plain))
	return plain, hex.EncodeToString(sum[:]), nil
}
