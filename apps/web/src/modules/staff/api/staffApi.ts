// Único punto del módulo `staff` que llama al cliente HTTP tipado
// (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md §6). Traduce las respuestas
// reales de GET/POST /private/professionals y GET/PATCH /private/professionals/{id} a
// los outcomes discriminados que la página consume; ningún componente ve
// `Problem`, `status` HTTP crudo ni cabeceras.
import { httpClient } from '@/shared/api/httpClient'
import type {
  Professional,
  ProfessionalPage,
  NumberedProfessionalPage,
} from '../model/professional'
import type {
  CreateProfessionalOutcome,
  FetchProfessionalsOutcome,
  FetchMyProfessionalOutcome,
  LinkMyProfessionalOutcome,
  RemoveProfessionalPhotoOutcome,
  RenameProfessionalOutcome,
  UnlinkMyProfessionalOutcome,
  UploadProfessionalPhotoOutcome,
} from '../model/staffOutcome'

export async function fetchProfessionals(cursor?: string): Promise<FetchProfessionalsOutcome> {
  try {
    const { data, response } = await httpClient.GET('/private/professionals', {
      params: { query: cursor ? { cursor } : {} },
    })

    if (response.ok && data) {
      return { kind: 'success', page: toPage(data) }
    }

    // 401 lo intercepta la coordinación única de installSessionHandling
    // (redirige a acceso); cualquier otro estado no-2xx se trata aquí como
    // un error genérico recuperable.
    return { kind: 'unexpected-error' }
  } catch {
    // `fetch` en sí lanzó (red caída, DNS, CORS bloqueado): no hubo
    // respuesta HTTP que traducir (mismo criterio que settingsApi.ts).
    return { kind: 'network-error' }
  }
}

export async function fetchProfessionalPage(
  page: number,
  pageSize: number,
): Promise<
  | { kind: 'success'; page: NumberedProfessionalPage }
  | { kind: 'network-error' | 'unexpected-error' }
> {
  try {
    const { data, response } = await httpClient.GET('/private/professionals', {
      params: { query: { page, pageSize } },
    })
    if (
      response.ok &&
      data &&
      data.page !== undefined &&
      data.pageSize !== undefined &&
      data.total !== undefined &&
      data.totalPages !== undefined
    ) {
      return {
        kind: 'success',
        page: {
          items: data.items.map(toProfessional),
          page: data.page,
          pageSize: data.pageSize,
          total: data.total,
          totalPages: data.totalPages,
        },
      }
    }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

// `description` es opcional (DEC-127): vacía o ausente equivale a «sin
// descripción» y se omite del cuerpo.
export async function createProfessional(
  fullName: string,
  idempotencyKey: string,
  description?: string,
): Promise<CreateProfessionalOutcome> {
  try {
    const { data, response } = await httpClient.POST('/private/professionals', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body: description?.trim() ? { fullName, description: description.trim() } : { fullName },
    })

    if (response.ok && data) {
      return { kind: 'success', professional: toProfessional(data) }
    }

    switch (response.status) {
      case 409:
        return { kind: 'idempotency-conflict' }
      case 422:
        return { kind: 'validation-error' }
      default:
        return { kind: 'unexpected-error' }
    }
  } catch {
    return { kind: 'network-error' }
  }
}

// PATCH del nombre y, si se pasa `description`, de la descripción (DEC-127):
// `undefined` la deja como está (no viaja en el cuerpo) y una cadena vacía la
// quita (viaja como `null`).
export async function renameProfessional(
  professionalId: string,
  fullName: string,
  description?: string,
): Promise<RenameProfessionalOutcome> {
  try {
    const { data, response } = await httpClient.PATCH('/private/professionals/{professionalId}', {
      params: { path: { professionalId: professionalId } },
      body:
        description === undefined
          ? { fullName }
          : { fullName, description: description.trim() || null },
    })

    if (response.ok && data) {
      return { kind: 'success', professional: toProfessional(data) }
    }

    switch (response.status) {
      case 404:
        return { kind: 'not-found' }
      case 422:
        return { kind: 'validation-error' }
      default:
        return { kind: 'unexpected-error' }
    }
  } catch {
    return { kind: 'network-error' }
  }
}

export { professionalPhotoUrl } from '@/shared/api/professionalPhotoUrl'

export async function uploadProfessionalPhoto(
  professionalId: string,
  photo: Blob,
): Promise<UploadProfessionalPhotoOutcome> {
  try {
    const { data, response } = await httpClient.PUT(
      '/private/professionals/{professionalId}/photo',
      {
        params: { path: { professionalId: professionalId } },
        // openapi-typescript tipa un cuerpo `format: binary` como `string`, pero
        // fetch envía un Blob tal cual: bodySerializer lo deja pasar sin
        // convertirlo a JSON y la cabecera declara el tipo real de la imagen.
        body: photo as unknown as string,
        bodySerializer: (body: unknown) => body as Blob,
        headers: { 'Content-Type': photo.type },
      },
    )

    if (response.ok && data) {
      return { kind: 'success', professional: toProfessional(data) }
    }

    switch (response.status) {
      case 404:
        return { kind: 'not-found' }
      case 422:
        return { kind: 'validation-error' }
      default:
        return { kind: 'unexpected-error' }
    }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function removeProfessionalPhoto(
  professionalId: string,
): Promise<RemoveProfessionalPhotoOutcome> {
  try {
    const { response } = await httpClient.DELETE('/private/professionals/{professionalId}/photo', {
      params: { path: { professionalId: professionalId } },
    })

    if (response.ok) return { kind: 'success' }
    if (response.status === 404) return { kind: 'not-found' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

// Vínculo del usuario autenticado con su profesional (DEC-100). Las tres
// operaciones actúan sobre la sesión: ninguna envía un identificador de usuario.
export async function fetchMyProfessional(): Promise<FetchMyProfessionalOutcome> {
  try {
    const { data, response } = await httpClient.GET('/private/me/professional')
    if (response.ok && data) return { kind: 'linked', professional: toProfessional(data) }
    if (response.status === 404) return { kind: 'none' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function linkMyProfessional(
  professionalId: string,
): Promise<LinkMyProfessionalOutcome> {
  try {
    const { data, response } = await httpClient.PUT('/private/me/professional', {
      body: { professionalId: professionalId },
    })
    if (response.ok && data) return { kind: 'success', professional: toProfessional(data) }
    switch (response.status) {
      case 404:
        return { kind: 'not-found' }
      case 409:
        return { kind: 'taken' }
      default:
        return { kind: 'unexpected-error' }
    }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function unlinkMyProfessional(): Promise<UnlinkMyProfessionalOutcome> {
  try {
    const { response } = await httpClient.DELETE('/private/me/professional')
    if (response.ok) return { kind: 'success' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

interface ProfessionalWire {
  id: string
  fullName: string
  createdAt: string
  updatedAt: string
  // Opcional a propósito: una respuesta de alta repetida por idempotencia que
  // se guardó antes de DEC-104 no lo trae; ausente equivale a "sin fotografía".
  photoUpdatedAt?: string | null
  // Opcional por la misma razón (DEC-127): ausente equivale a "sin descripción".
  description?: string | null
  // Opcional por la misma razón (DEC-128): ausente equivale a «sin reseñas».
  rating?: number | null
  ratingCount?: number
}

function toProfessional(data: ProfessionalWire): Professional {
  return {
    id: data.id,
    fullName: data.fullName,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    photoUpdatedAt: data.photoUpdatedAt ?? null,
    description: data.description ?? null,
    rating: data.rating ?? null,
    ratingCount: data.ratingCount ?? 0,
  }
}

function toPage(data: { items: ProfessionalWire[]; nextCursor: string | null }): ProfessionalPage {
  return { items: data.items.map(toProfessional), nextCursor: data.nextCursor }
}
