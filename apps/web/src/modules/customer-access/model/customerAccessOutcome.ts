// Resultados del acceso al turno con código (HU-105, DEC-178). Discriminados por
// `status`/`code` del problema y nunca por `detail`: la interfaz no necesita ni
// debe saber por qué falló un código (CA-105-02).

/** Un turno al que el código dio acceso: la credencial de 60 minutos y lo mínimo
 * para elegir entre varios. `accessToken` solo vive en memoria y viaja en la ruta
 * de «Cambiar la hora»; nunca se guarda en el navegador. */
export interface AccessibleAppointment {
  accessToken: string
  startsAt: string
  serviceName: string
  barberName: string
}

export interface AccessGrant {
  /** Zona IANA de la barbería: las horas se muestran en ella (RN-DIS-07). */
  timezone: string
  appointments: AccessibleAppointment[]
}

export type RequestAccessCodeOutcome =
  /** `resendAfterSeconds` es la guía de la pantalla para ofrecer «pedir otro». */
  | { kind: 'sent'; expiresInSeconds: number; resendAfterSeconds: number }
  /** 429: demasiados códigos; `retryAfterSeconds` sale de `Retry-After`. */
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  /** 400/422: el contacto no tiene forma de correo ni de celular. */
  | { kind: 'invalid-contact' }
  /** 404: el enlace no corresponde a ninguna barbería publicada. */
  | { kind: 'barbershop-not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }

export type VerifyAccessCodeOutcome =
  | { kind: 'granted'; grant: AccessGrant }
  /** 401 uniforme: incorrecto, vencido, usado, agotado o de un contacto inexistente. */
  | { kind: 'invalid-code' }
  | { kind: 'invalid-contact' }
  | { kind: 'barbershop-not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }
