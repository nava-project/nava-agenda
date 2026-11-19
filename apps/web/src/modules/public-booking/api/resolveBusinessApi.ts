// Único punto del módulo `public-booking` que llama al cliente HTTP tipado
// (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md §6). Traduce la respuesta
// real de `GET /public/businesses/{slug}` a `ResolveBusinessOutcome`: la
// página coordinadora nunca ve `Problem`, `status` HTTP crudo ni cabeceras.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import { DEFAULT_BRAND_ACCENT, isBrandAccentKey } from '@/shared/model'
import { isDayOfWeek, type OpeningSegment } from '@/shared/model/openingHours'
import type { ResolveBusinessOutcome } from '../model/businessProfileOutcome'

/**
 * Resuelve el enlace público `slug` contra el API real (HU-090). Mapea por
 * `status` (nunca por `detail`, trabajo requerido §8): 404 cubre forma
 * inválida, desconocido y no publicable, indistinguibles a propósito
 * (CA-090-02); cualquier otro estado no-2xx es inesperado. Un fallo de
 * `fetch` en sí (sin respuesta HTTP) es error de red, distinto de un 5xx
 * del servidor.
 */
export async function resolveBusiness(slug: string): Promise<ResolveBusinessOutcome> {
  try {
    const { data, error, response } = await httpClient.GET('/public/businesses/{slug}', {
      params: { path: { slug } },
    })

    if (response.ok && data) {
      return {
        kind: 'success',
        profile: {
          name: data.name,
          timezone: data.timezone,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          vocabulary: {
            businessTerm: data.vocabulary.businessTerm,
            businessTermGender: data.vocabulary.businessTermGender,
            professionalTerm: data.vocabulary.professionalTerm,
            professionalTermPlural: data.vocabulary.professionalTermPlural,
            professionalTermGender: data.vocabulary.professionalTermGender,
          },
          location: data.location
            ? {
                address: data.location.address,
                latitude: data.location.latitude,
                longitude: data.location.longitude,
              }
            : null,
          offersHomeService: data.offersHomeService ?? false,
          // DEC-171: una clave que este cliente no conoce (servidor más nuevo) cae
          // en latón, nunca en un color sin contraste comprobado.
          brandAccent: isBrandAccentKey(data.brandAccent) ? data.brandAccent : DEFAULT_BRAND_ACCENT,
          // DEC-182: un servidor anterior al horario no trae estos campos; un día
          // que este cliente no reconoce se descarta en vez de pintarse mal.
          openingHours: (data.openingHours ?? []).filter((seg): seg is OpeningSegment =>
            isDayOfWeek(seg.dayOfWeek),
          ),
          closedOnHolidays: data.closedOnHolidays ?? false,
          today:
            data.today && isDayOfWeek(data.today.dayOfWeek)
              ? {
                  date: data.today.date,
                  dayOfWeek: data.today.dayOfWeek,
                  holiday: data.today.holiday,
                  hours: data.today.hours.map((h) => ({ opens: h.opens, closes: h.closes })),
                }
              : null,
        },
      }
    }

    const requestId = isProblem(error) ? error.requestId : undefined

    switch (response.status) {
      case 404:
        return { kind: 'not-found' }
      default:
        return { kind: 'unexpected-error', requestId }
    }
  } catch {
    // `fetch` en sí lanzó (red caída, DNS, CORS bloqueado): no hubo
    // respuesta HTTP que traducir, así que nunca llega a la rama anterior.
    return { kind: 'network-error' }
  }
}
