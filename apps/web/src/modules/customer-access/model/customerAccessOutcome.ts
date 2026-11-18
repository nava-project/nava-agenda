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
  professionalName: string
}

export interface AccessGrant {
  /** Zona IANA del negocio: las horas se muestran en ella (RN-DIS-07). */
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
  /** 404: el enlace no corresponde a ningún negocio publicado. */
  | { kind: 'business-not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }

export type VerifyAccessCodeOutcome =
  | { kind: 'granted'; grant: AccessGrant }
  /** 401 uniforme: incorrecto, vencido, usado, agotado o de un contacto inexistente. */
  | { kind: 'invalid-code' }
  | { kind: 'invalid-contact' }
  | { kind: 'business-not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }

/** Para qué se pidió el acceso desde Odin (HU-106): decide a qué pantalla lleva. */
/**
 * Para qué pidió Odin el acceso (DEC-179, DEC-181): `manage` deja elegir en el paso 03;
 * `cancel` abre la cancelación y `reschedule` lleva a «Cambiar la hora».
 */
export type AccessPurpose = 'manage' | 'cancel' | 'reschedule'

export type VerifyAccessRefOutcome =
  /** `accessToken` es el acceso de 60 minutos a ese turno; solo vive en memoria. */
  | { kind: 'granted'; accessToken: string; purpose: AccessPurpose }
  /** 401 uniforme: código incorrecto, vencido, usado o agotado, o enlace ajeno/vencido. */
  | { kind: 'invalid-code' }
  /** 400/422: el código no tiene forma de 6 dígitos. */
  | { kind: 'invalid-input' }
  | { kind: 'business-not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }
