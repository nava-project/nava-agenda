/**
 * Ayudas puras de la vista previa de la política de reserva (HU-093).
 */
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_MAX_DAYS,
  formatDuration,
  latestBookableInstant,
  previewStarts,
} from '../bookingPolicy'

describe('formatDuration', () => {
  it('writes minutes, hours and days compactly', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(90)).toBe('1 h 30 min')
    expect(formatDuration(1440)).toBe('1 día')
    expect(formatDuration(2 * 1440 + 3 * 60)).toBe('2 días 3 h')
  })

  it('treats a half-typed or invalid value as zero', () => {
    expect(formatDuration(Number.NaN)).toBe('0 min')
    expect(formatDuration(-5)).toBe('0 min')
  })
})

describe('previewStarts', () => {
  // Jueves 19 de noviembre de 2026, 15:36 en la zona del dispositivo.
  const now = new Date(2026, 10, 19, 15, 36)
  const policy = { minAdvanceMinutes: 0, maxAdvanceDays: 2, slotGridMinutes: 15 }
  const local = (iso: string) => {
    const d = new Date(iso)
    return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  it('offers the grid minutes of each hour of the sample opening', () => {
    const starts = previewStarts({ ...policy, slotGridMinutes: 30 }, now).map((s) =>
      local(s.startsAt),
    )
    expect(starts).toContain('20 09:00')
    expect(starts).toContain('20 09:30')
    expect(starts).not.toContain('20 09:15')
    // El último inicio deja sitio al servicio de muestra antes del cierre.
    expect(starts).toContain('20 18:30')
    expect(starts).not.toContain('20 19:00')
  })

  it('drops the starts of today that fall inside the minimum advance', () => {
    const none = previewStarts(policy, now).map((s) => local(s.startsAt))
    expect(none[0]).toBe('19 15:45')
    const hour = previewStarts({ ...policy, minAdvanceMinutes: 60 }, now).map((s) =>
      local(s.startsAt),
    )
    expect(hour[0]).toBe('19 16:45')
  })

  it('stops at now plus the maximum window in days', () => {
    const starts = previewStarts(policy, now).map((s) => local(s.startsAt))
    expect(starts[starts.length - 1]).toBe('21 15:30')
    expect(latestBookableInstant(2, now)?.getDate()).toBe(21)
  })

  it('caps the painted days and ignores half-typed values', () => {
    const many = previewStarts({ ...policy, maxAdvanceDays: 90 }, now)
    const days = new Set(many.map((s) => new Date(s.startsAt).toDateString()))
    expect(days.size).toBe(PREVIEW_MAX_DAYS + 1)
    expect(previewStarts({ ...policy, slotGridMinutes: 0 }, now)).toEqual([])
    expect(previewStarts({ ...policy, slotGridMinutes: Number.NaN }, now)).toEqual([])
    expect(previewStarts({ ...policy, maxAdvanceDays: 0 }, now)).toEqual([])
  })
})
