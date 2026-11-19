// Espejo tipado del cuerpo real del contrato (HU-093, CA-093-01):
// exactamente los seis campos de configuración más versionToken, el único
// dato de concurrencia expuesto.
export interface BookingPolicy {
  minAdvanceMinutes: number
  maxAdvanceDays: number
  slotGridMinutes: number
  cancellationDeadlineMinutes: number
  lateCancellationClientAllowed: boolean
  lateCancellationReasonRequired: boolean
  versionToken: string
}

/** Forma editable del formulario: los seis campos de configuración, sin
 * versionToken (viaja aparte, como precondición de la siguiente
 * escritura, nunca como un campo editable del formulario). */
export interface BookingPolicyFormValues {
  minAdvanceMinutes: number
  maxAdvanceDays: number
  slotGridMinutes: number
  cancellationDeadlineMinutes: number
  lateCancellationClientAllowed: boolean
  lateCancellationReasonRequired: boolean
}

export function toFormValues(policy: BookingPolicy): BookingPolicyFormValues {
  return {
    minAdvanceMinutes: policy.minAdvanceMinutes,
    maxAdvanceDays: policy.maxAdvanceDays,
    slotGridMinutes: policy.slotGridMinutes,
    cancellationDeadlineMinutes: policy.cancellationDeadlineMinutes,
    lateCancellationClientAllowed: policy.lateCancellationClientAllowed,
    lateCancellationReasonRequired: policy.lateCancellationReasonRequired,
  }
}

/** Duración legible para la vista previa: «45 min», «1 h 30 min», «2 días 3 h». */
export function formatDuration(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const mins = total % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} ${days === 1 ? 'día' : 'días'}`)
  if (hours > 0) parts.push(`${hours} h`)
  if (mins > 0) parts.push(`${mins} min`)
  return parts.length > 0 ? parts.join(' ') : '0 min'
}

/** Horario de muestra de la vista previa: abre de 9:00 a. m. a 7:00 p. m. todos los días y
 * el servicio dura 30 min. Es un ejemplo fijo, no el horario real del negocio:
 * la vista previa no consulta la API. */
export const PREVIEW_OPENS_MINUTES = 9 * 60
export const PREVIEW_CLOSES_MINUTES = 19 * 60
export const PREVIEW_SERVICE_MINUTES = 30
/** Días que se pintan como mucho: la ventana real puede durar meses, pero en la
 * muestra solo se ven los primeros (y cada tecla la recalcula); el último día
 * se dice en texto. */
export const PREVIEW_MAX_DAYS = 14

/** Un inicio de muestra, con la misma forma que la disponibilidad pública. */
export interface PreviewStart {
  professionalId: string
  startsAt: string
}

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** El último instante que se puede reservar: `now` más la ventana máxima, igual
 * que el servidor (`now.AddDate(0, 0, maxAdvanceDays)`). */
export function latestBookableInstant(maxAdvanceDays: number, now: Date): Date | null {
  if (!Number.isFinite(maxAdvanceDays) || maxAdvanceDays < 1) return null
  return new Date(now.getTime() + Math.floor(maxAdvanceDays) * DAY_MS)
}

/**
 * Los inicios que vería el cliente con la política del formulario sobre el
 * horario de muestra, en la zona del dispositivo (la vista previa la usa para
 * todo, así que es coherente consigo misma):
 * - la rejilla decide los minutos de cada hora (15 → :00 :15 :30 :45);
 * - la anticipación mínima quita lo que empieza antes de `now` + anticipación;
 * - la ventana máxima quita lo que empieza después de `now` + días.
 * Un valor a medio escribir o fuera de rango no inventa horas: devuelve `[]`.
 */
export function previewStarts(
  policy: Pick<BookingPolicyFormValues, 'minAdvanceMinutes' | 'maxAdvanceDays' | 'slotGridMinutes'>,
  now: Date,
): PreviewStart[] {
  const grid = policy.slotGridMinutes
  if (!Number.isInteger(grid) || grid < 1 || grid > 60) return []
  const latest = latestBookableInstant(policy.maxAdvanceDays, now)
  if (!latest) return []
  const advance = Number.isFinite(policy.minAdvanceMinutes)
    ? Math.max(0, policy.minAdvanceMinutes)
    : 0
  const earliest = now.getTime() + advance * MINUTE_MS
  const lastDay = Math.min(Math.floor(policy.maxAdvanceDays), PREVIEW_MAX_DAYS)
  const starts: PreviewStart[] = []
  for (let day = 0; day <= lastDay; day++) {
    for (
      let minutes = PREVIEW_OPENS_MINUTES;
      minutes + PREVIEW_SERVICE_MINUTES <= PREVIEW_CLOSES_MINUTES;
      minutes += grid
    ) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, 0, minutes)
      const time = at.getTime()
      if (time < earliest || time > latest.getTime()) continue
      starts.push({ professionalId: 'muestra', startsAt: at.toISOString() })
    }
  }
  return starts
}
