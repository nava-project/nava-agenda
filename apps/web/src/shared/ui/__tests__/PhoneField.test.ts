import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import PhoneField from '../PhoneField.vue'

function mountField(props: Partial<{ country: string; national: string; error: string }> = {}) {
  return mount(PhoneField, { props: { country: 'CO', national: '', required: true, ...props } })
}

describe('PhoneField', () => {
  it('usa la variante de papel y oculta el asterisco cuando se pide', () => {
    const ink = mountField()
    expect(ink.classes()).not.toContain('phone-field--paper')
    expect(ink.find('.phone-field__required').exists()).toBe(true)

    const paper = mount(PhoneField, {
      props: {
        country: 'CO',
        national: '',
        required: true,
        tone: 'paper',
        showRequiredMarker: false,
      },
    })
    expect(paper.classes()).toContain('phone-field--paper')
    expect(paper.find('.phone-field__required').exists()).toBe(false)
    expect(paper.get('input[type="tel"]').attributes('aria-required')).toBe('true')
  })

  it('muestra la bandera y el prefijo del país elegido, fuera de la casilla del número', () => {
    const wrapper = mountField({ country: 'MX', national: '5512345678' })

    expect(wrapper.get('.phone-field__flag').text()).toBe('🇲🇽')
    expect(wrapper.get('.phone-field__dial').text()).toBe('+52')
    expect((wrapper.get('input[type="tel"]').element as HTMLInputElement).value).toBe('5512345678')
  })

  it('emite el país al cambiar el selector', async () => {
    const wrapper = mountField()
    await wrapper.get('select').setValue('EC')

    expect(wrapper.emitted('update:country')).toEqual([['EC']])
  })

  it('respeta los espacios y separadores escritos y descarta lo que no es un teléfono', async () => {
    const wrapper = mountField()
    await wrapper.get('input[type="tel"]').setValue('300 12a3-4567')

    expect(wrapper.emitted('update:national')).toEqual([['300 123-4567']])
  })

  it('deja escribir «+57» y elige el país con el primer dígito nacional', async () => {
    const wrapper = mountField({ country: 'MX' })
    const input = wrapper.get('input[type="tel"]')
    await input.setValue('+57')
    expect(wrapper.emitted('update:country')).toBeUndefined()
    expect((input.element as HTMLInputElement).value).toBe('+57')
    await input.setValue('+57 3')
    expect(wrapper.emitted('update:country')).toEqual([['CO']])
    expect(wrapper.emitted('update:national')!.at(-1)).toEqual(['3'])
  })

  it('avisa al salir de la casilla del número', async () => {
    const wrapper = mountField()
    await wrapper.get('input[type="tel"]').trigger('blur')
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })

  it('al pegar un número con prefijo elige el país y deja el número nacional', async () => {
    const wrapper = mountField()
    await wrapper.get('input[type="tel"]').setValue('+52 55 1234 5678')

    expect(wrapper.emitted('update:country')).toEqual([['MX']])
    expect(wrapper.emitted('update:national')).toEqual([['55 1234 5678']])
  })

  it('anuncia el error y lo asocia a la casilla', () => {
    const wrapper = mountField({ error: 'El teléfono es obligatorio.' })
    const input = wrapper.get('input[type="tel"]')

    expect(input.attributes('aria-invalid')).toBe('true')
    const errorId = input.attributes('aria-describedby')!
    expect(wrapper.get(`#${errorId}`).text()).toBe('El teléfono es obligatorio.')
  })

  it('deshabilita el selector y la casilla del número, y pasa el name a la casilla', () => {
    const wrapper = mount(PhoneField, {
      props: { country: 'CO', national: '', disabled: true, name: 'contactPhone' },
    })

    expect(wrapper.get('select').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="tel"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="tel"]').attributes('name')).toBe('contactPhone')
  })

  it('no tiene violaciones de accesibilidad', async () => {
    // Dentro de un landmark, como lo aloja la página real.
    const wrapper = mount({
      render: () =>
        h('main', [
          h(PhoneField, {
            country: 'CO',
            national: '',
            required: true,
            error: 'El teléfono es obligatorio.',
          }),
        ]),
    })
    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })
})
