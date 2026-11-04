import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import HomeLocationField from '../HomeLocationField.vue'
import type { PlaceSelection } from '@/shared/model/placesAutocomplete'

function mountIt(modelValue: PlaceSelection | null = null, error?: string, details = '') {
  return mount(HomeLocationField, {
    attachTo: document.body,
    props: { modelValue, details, error, start: { latitude: 4.7, longitude: -74.07 } },
  })
}

describe('HomeLocationField', () => {
  it('ya no ofrece buscar una dirección: el mapa y los detalles (DEC-155)', async () => {
    const wrapper = mountIt()
    await flushPromises()

    expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Busca tu dirección')
    expect(wrapper.text()).toContain('Mueve el mapa hasta que el pin quede sobre el lugar')
    expect(wrapper.find('[aria-label="Mover el mapa al norte"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Detalles de la dirección (opcional)')
    expect(wrapper.text()).toContain('Torre, apartamento, casa o una referencia')
  })

  it('emite el punto marcado en el mapa', async () => {
    const wrapper = mountIt()
    await flushPromises()
    await wrapper.get('[aria-label="Mover el mapa al norte"]').trigger('click')
    await flushPromises()

    const all = wrapper.emitted('update:modelValue')!
    expect(all[0]![0]).toMatchObject({
      address: 'Ubicación marcada en el mapa',
      latitude: 4.701,
      longitude: -74.07,
    })
  })

  it('emite los detalles que escribe la persona sin tocar el punto', async () => {
    const chosen: PlaceSelection = { address: 'Punto marcado', latitude: 4.7, longitude: -74.07 }
    const wrapper = mountIt(chosen)
    await flushPromises()
    await wrapper.get('input[type="text"]').setValue('Torre 2, apto 304')

    expect(wrapper.emitted('update:details')).toEqual([['Torre 2, apto 304']])
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('limita los detalles a 80 caracteres', async () => {
    const wrapper = mountIt()
    await flushPromises()
    expect(wrapper.get('input[type="text"]').attributes('maxlength')).toBe('80')
  })

  it('muestra el error de validación bajo el mapa', async () => {
    const wrapper = mountIt(null, 'Marca tu ubicación en el mapa.')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Marca tu ubicación en el mapa.')
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const wrapper = mountIt({ address: 'Calle 9', latitude: 4.6, longitude: -74.1 })
    await flushPromises()
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })
})
