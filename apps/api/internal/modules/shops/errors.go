package shops

import (
	"fmt"

	"nava-agenda/internal/platform/apperr"
)

// Mensajes de campo de CA-020-03/CA-020-06: cada uno describe un único
// campo, seguros para el cliente (nunca SQL ni el valor crudo enviado,
// CA-003-02). PATCH evalúa los campos en el orden fijo de la firma del
// contrato (name, timezone, contactEmail, contactPhone) y devuelve el
// primer error de campo que encuentra, igual que LoginService hace con la
// forma del request.
func errNameRequired() error {
	return apperr.Validation("el nombre del negocio es obligatorio")
}

func errNameTooLong() error {
	return apperr.Validation("el nombre del negocio excede el largo máximo")
}

func errTimezoneRequired() error {
	return apperr.Validation("la zona horaria es obligatoria")
}

func errTimezoneTooLong() error {
	return apperr.Validation("la zona horaria excede el largo máximo")
}

// errTimezoneInvalid es el error de CA-020-03: el texto no corresponde a
// ninguna zona de pg_timezone_names. Se construye después de que el
// repositorio confirma la ausencia dentro de la misma transacción que
// intentó el UPDATE (cero escritura), no antes.
func errTimezoneInvalid() error {
	return apperr.Validation("la zona horaria no es una zona IANA reconocida")
}

func errContactEmailInvalid() error {
	return apperr.Validation("el correo de contacto no tiene un formato válido")
}

func errContactPhoneInvalid() error {
	return apperr.Validation("el teléfono de contacto no tiene un formato E.164 válido")
}

// errBookingPolicyVersionTokenRequired cubre HU-093 (CA-093-02): la
// cabecera If-Match (precondición de versión) es obligatoria para
// actualizar la política de reserva, mismo criterio que
// booking.errVersionTokenRequired.
func errBookingPolicyVersionTokenRequired() error {
	return apperr.Invalid("falta la cabecera If-Match con el token de versión de la política de reserva")
}

// errBookingPolicyVersionConflict cubre HU-093 (CA-093-02): el token de
// versión que el cliente envió (cabecera If-Match) ya no coincide con la
// representación vigente porque otra escritura tocó el negocio primero.
func errBookingPolicyVersionConflict() error {
	return apperr.VersionConflict("la política de reserva cambió desde que se leyó; recarga antes de reintentar")
}

// errBookingPolicyFieldOutOfRange cubre HU-093 (CA-093-02): field está fuera
// del rango permitido por DEC-083. Nunca revela el rango ni el valor
// enviado en el mensaje (mismo criterio de mensajes seguros de errNameTooLong
// y similares): el cliente ya conoce el rango porque el formulario lo
// muestra (CA-093-05).
func errBookingPolicyFieldOutOfRange(field string) error {
	return apperr.Validation(fmt.Sprintf("%s está fuera del rango permitido", field))
}

// errBookingPolicyIncoherentCancellationPolicy cubre HU-093 (CA-093-02):
// exigir motivo para una cancelación tardía que el cliente ni siquiera
// puede hacer es una combinación incoherente (DEC-083).
func errBookingPolicyIncoherentCancellationPolicy() error {
	return apperr.Validation("no se puede exigir motivo de cancelación tardía si el cliente no puede cancelar tarde")
}

// errBookingPolicyAdvanceExceedsWindow cubre HU-093 (CA-093-02,
// business_min_advance_vs_window_ck): la anticipación mínima no puede
// alcanzar ni superar toda la ventana pública de reserva, o ninguna franja
// quedaría reservable.
func errBookingPolicyAdvanceExceedsWindow() error {
	return apperr.Validation("la anticipación mínima no puede alcanzar ni superar la ventana máxima de reserva")
}

// Errores de campo de la marca y el vocabulario (issue #292, DEC-110). Cada
// mensaje nombra un único campo y nunca devuelve el valor crudo enviado
// (CA-003-02), igual que los de HU-020 y HU-093.
func errBrandAccentInvalid() error {
	return apperr.Validation("accent no es uno de los colores permitidos")
}

func errBrandTermInvalid(field string) error {
	return apperr.Validation(fmt.Sprintf(
		"%s debe tener entre %d y %d caracteres y usar solo letras, espacios, guion o apóstrofo",
		field, TermMinLength, TermMaxLength))
}

func errBrandGenderInvalid(field string) error {
	return apperr.Validation(fmt.Sprintf("%s debe ser masculine o feminine", field))
}

func errAddressTooLong() error {
	return apperr.Validation(fmt.Sprintf("address no puede superar %d caracteres", MaxAddressLength))
}

// errAddressUnresolvable es el 422 de CA-102-01: la dirección no se pudo ubicar
// con precisión suficiente y NO se guardó nada.
func errAddressUnresolvable() error {
	return apperr.Validation(
		"no pudimos ubicar esa dirección en el mapa; escríbela completa (calle, número y ciudad)")
}

// errPinIncomplete, errPinWithoutAddress y errPinOutOfRange cubren el punto
// elegido a mano (DEC-170): llega completo, dentro de rango y con una dirección
// que lo acompañe, o no se guarda nada.
func errPinIncomplete() error {
	return apperr.Validation("latitude y longitude se envían juntas o ninguna")
}

func errPinWithoutAddress() error {
	return apperr.Validation("el punto del mapa necesita una dirección escrita (address)")
}

func errPinOutOfRange() error {
	return apperr.Validation("latitude debe estar entre -90 y 90 y longitude entre -180 y 180")
}

// errGeocoderUnavailable cubre un fallo ajeno a la dirección (sin credencial,
// cuota, red). El catálogo de errores no tiene un 503: se responde 422 con un
// mensaje distinto para que la persona reintente, y la causa real solo se
// registra en el servidor.
func errGeocoderUnavailable() error {
	return apperr.Validation(
		"no pudimos verificar la dirección en este momento; inténtalo de nuevo en unos minutos")
}

// errProfessionalForPolicyNotFound cubre DEC-169: el profesional de la ventana propia no
// existe en el negocio activo (o su identificador no tiene forma de uuid).
// Mismo 404 uniforme que staff, sin revelar si existe en otro negocio
// (RN-TEN-01).
func errProfessionalForPolicyNotFound() error {
	return apperr.NotFound("profesional no encontrado")
}
