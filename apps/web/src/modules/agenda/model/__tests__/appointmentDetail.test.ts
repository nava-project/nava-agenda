import { describe, expect, it } from 'vitest'
import { DEFAULT_BRAND, buildVocabulary } from '@/shared/model/vocabulary'
import { historyFieldLabel } from '../appointmentDetail'

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
