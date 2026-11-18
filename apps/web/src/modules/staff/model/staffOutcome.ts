// Resultados discriminados de las operaciones de HU-021, tal como los
// recibe la página coordinadora. Ninguno expone `Problem`, `status` HTTP
// crudo ni cabeceras (docs/03-desarrollo/estandar-frontend-vue.md §6),
// mismo criterio que settingsOutcome.ts. Un 401 real de estas rutas ya lo
// intercepta la coordinación única de `installSessionHandling`; todos
// igual declaran `unexpected-error` como frontera defensiva por si esa
// solicitud concreta llegara a resolverse antes de que la redirección
// navegue.
import type { Professional, ProfessionalPage } from './professional'

export type FetchProfessionalsOutcome =
  | { kind: 'success'; page: ProfessionalPage }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type CreateProfessionalOutcome =
  | { kind: 'success'; professional: Professional }
  | { kind: 'validation-error' }
  // RN-IDE-01: la misma clave de idempotencia ya se usó con un contenido
  // distinto, o la operación con esa clave sigue en curso (DEC-043). No es
  // un error de validación de campo: el formulario no cambió, es un
  // reintento el que debe generar una clave nueva.
  | { kind: 'idempotency-conflict' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type RenameProfessionalOutcome =
  | { kind: 'success'; professional: Professional }
  | { kind: 'validation-error' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

// Fotografía (DEC-104). `validation-error` cubre un 422 del servidor (formato,
// tamaño o dimensiones); la página ya prepara la imagen antes de enviarla, así
// que solo lo ve un cliente que se salte esa preparación o una regla que
// cambie en el servidor.
export type UploadProfessionalPhotoOutcome =
  | { kind: 'success'; professional: Professional }
  | { kind: 'validation-error' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type RemoveProfessionalPhotoOutcome =
  | { kind: 'success' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

// Vínculo del usuario con su profesional (DEC-100). `none` en la lectura no es un
// error: el vínculo es opcional (el dueño que no atiende clientes no tiene
// profesional). `taken` es el 409: ese profesional ya pertenece a otro usuario.
export type FetchMyProfessionalOutcome =
  | { kind: 'linked'; professional: Professional }
  | { kind: 'none' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type LinkMyProfessionalOutcome =
  | { kind: 'success'; professional: Professional }
  | { kind: 'taken' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type UnlinkMyProfessionalOutcome =
  { kind: 'success' } | { kind: 'network-error' } | { kind: 'unexpected-error' }
