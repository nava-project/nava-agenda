import { describe, expect, it } from 'vitest'
import { DEFAULT_BRAND, buildVocabulary } from '@/shared/model/vocabulary'
import { historyChangeValue, historyFieldLabel } from '../appointmentDetail'

describe('historyFieldLabel', () => {
  const v = buildVocabulary(DEFAULT_BRAND)

  it('professional_id usa el término de profesional del negocio', () => {
    expect(historyFieldLabel('professional_id', v)).toBe(v.Professional)
  })

  it('los campos fijos conservan su etiqueta y los desconocidos su nombre', () => {
    expect(historyFieldLabel('starts_at', v)).toBe('Hora de inicio')
    expect(historyFieldLabel('campo_nuevo', v)).toBe('campo_nuevo')
  })
})

describe('historyChangeValue', () => {
  const v = buildVocabulary(DEFAULT_BRAND)

  it('translates a status value instead of showing the API enum (#757)', () => {
    expect(historyChangeValue('status', 'confirmed', v, 'America/Bogota')).toBe('Confirmado')
    expect(historyChangeValue('status', 'no_show', v, null)).toBe('No asistió')
  })

  it('formats a start time in the business timezone', () => {
    const text = historyChangeValue('starts_at', '2026-11-21T14:00:00Z', v, 'America/Bogota')
    expect(text).toMatch(/21/)
    expect(text).toMatch(/9:00/)
  })

  it('keeps free text and marks a missing value with a dash', () => {
    expect(historyChangeValue('cancellation_reason', 'Lluvia', v, null)).toBe('Lluvia')
    expect(historyChangeValue('status', null, v, null)).toBe('—')
  })
})
