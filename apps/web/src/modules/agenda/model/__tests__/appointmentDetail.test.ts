import { describe, expect, it } from 'vitest'
import { DEFAULT_BRAND, buildVocabulary } from '@/shared/model/vocabulary'
import { historyFieldLabel } from '../appointmentDetail'

describe('historyFieldLabel', () => {
  const v = buildVocabulary(DEFAULT_BRAND)

  // El historial es inmutable: un cambio guardado como `barber_id` antes de
  // DEC-183 (#662) se sigue rotulando con el término del negocio.
  it.each(['professional_id', 'barber_id'])('%s usa el término de profesional', (field) => {
    expect(historyFieldLabel(field, v)).toBe(v.Professional)
  })

  it('los campos fijos conservan su etiqueta y los desconocidos su nombre', () => {
    expect(historyFieldLabel('starts_at', v)).toBe('Hora de inicio')
    expect(historyFieldLabel('campo_nuevo', v)).toBe('campo_nuevo')
  })
})
