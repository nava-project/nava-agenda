package customeraccess

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"strings"
	"time"
)

// maxAppointmentRefLength acota la referencia recibida antes de descifrarla: la
// real mide 70 caracteres y una más larga nunca puede ser válida.
const maxAppointmentRefLength = 128

// appointmentRefPayloadLength es el contenido cifrado: el identificador del turno
// (16 bytes) y el vencimiento en segundos Unix (8 bytes).
const appointmentRefPayloadLength = 24

// sealAppointmentRef cifra, con AES-256-GCM, el turno y el vencimiento de la
// referencia que Odin recibe en `lookup`. Es opaca (HU-106, DEC-179): no deja ver
// el identificador interno, no necesita una tabla y no sirve en otra barbería,
// porque el slug va como dato autenticado. La clave sale del secreto de
// despliegue con su propio dominio.
func sealAppointmentRef(appointmentID, slug string, expires time.Time, secret []byte) (string, error) {
	id, err := hex.DecodeString(strings.ReplaceAll(appointmentID, "-", ""))
	if err != nil || len(id) != 16 {
		return "", errInvalidAppointmentID
	}
	payload := make([]byte, appointmentRefPayloadLength)
	copy(payload, id)
	binary.BigEndian.PutUint64(payload[16:], uint64(expires.Unix()))

	gcm, err := appointmentRefCipher(secret)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, payload, []byte(slug))
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

// openAppointmentRef devuelve el turno de una referencia propia, para esa barbería
// y todavía vigente. Cualquier otra cosa (forma, firma, barbería o vencimiento)
// devuelve ok=false sin distinguir la causa.
func openAppointmentRef(ref, slug string, now time.Time, secret []byte) (appointmentID string, ok bool) {
	ref = strings.TrimSpace(ref)
	if ref == "" || len(ref) > maxAppointmentRefLength {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(ref)
	if err != nil {
		return "", false
	}
	gcm, err := appointmentRefCipher(secret)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", false
	}
	nonce, sealed := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	payload, err := gcm.Open(nil, nonce, sealed, []byte(slug))
	if err != nil || len(payload) != appointmentRefPayloadLength {
		return "", false
	}
	if !now.Before(time.Unix(int64(binary.BigEndian.Uint64(payload[16:])), 0)) {
		return "", false
	}
	h := hex.EncodeToString(payload[:16])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32], true
}

func appointmentRefCipher(secret []byte) (cipher.AEAD, error) {
	key := sha256.Sum256(append([]byte("customer-access:appointment-ref:"), secret...))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

type refError string

func (e refError) Error() string { return string(e) }

const errInvalidAppointmentID = refError("customeraccess: identificador de turno inválido")

// hashAccessRef valida la forma de la referencia del enlace y devuelve su SHA-256
// en hexadecimal. ok es falso para una vacía o demasiado larga: se descarta sin
// tocar la base.
func hashAccessRef(ref string) (hash string, ok bool) {
	ref = strings.TrimSpace(ref)
	if ref == "" || len(ref) > maxAccessRefLength {
		return "", false
	}
	sum := sha256.Sum256([]byte(ref))
	return hex.EncodeToString(sum[:]), true
}
