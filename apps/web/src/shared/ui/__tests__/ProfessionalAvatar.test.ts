/**
 * Tests for ProfessionalAvatar component (issue #189, atlas panel-agenda-eventos
 * evento 12). Verifies: monogram algorithm (1-word and 3-word names, middle
 * word ignored), sizes, photo branch, decorative aria-hidden.
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import ProfessionalAvatar from '../ProfessionalAvatar.vue'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

describe('ProfessionalAvatar', () => {
  it('derives a single-letter monogram from a one-word name', () => {
    const wrapper = mount(ProfessionalAvatar, { props: { fullName: 'Cher' } })
    expect(wrapper.get('.professional-avatar__monogram').text()).toBe('C')
  })

  it('derives a two-letter monogram from first+last word, ignoring middle words', () => {
    const wrapper = mount(ProfessionalAvatar, { props: { fullName: 'Ana María Gómez' } })
    expect(wrapper.get('.professional-avatar__monogram').text()).toBe('AG')
  })

  it('derives a two-letter monogram from a two-word name', () => {
    const wrapper = mount(ProfessionalAvatar, { props: { fullName: 'Julián Rodríguez' } })
    expect(wrapper.get('.professional-avatar__monogram').text()).toBe('JR')
  })

  it.each(['closed', 'option', 'row', 'portrait', 'hero'] as const)(
    'applies the %s size class',
    (size) => {
      const wrapper = mount(ProfessionalAvatar, { props: { fullName: 'Julián Rodríguez', size } })
      expect(wrapper.classes()).toContain(`professional-avatar--${size}`)
    },
  )

  it('renders a decorative photo and suppresses the monogram when photoUrl is set', () => {
    const wrapper = mount(ProfessionalAvatar, {
      props: { fullName: 'Andrés Beltrán', photoUrl: 'https://example.test/andres.jpg' },
    })
    const img = wrapper.get('.professional-avatar__photo')
    expect(img.attributes('src')).toBe('https://example.test/andres.jpg')
    expect(img.attributes('alt')).toBe('')
    expect(wrapper.find('.professional-avatar__monogram').exists()).toBe(false)
  })

  it('falls back to the monogram when the photo fails to load, and retries with a new version', async () => {
    const wrapper = mount(ProfessionalAvatar, {
      props: { fullName: 'Andrés Beltrán', photoUrl: '/photo?v=1' },
    })
    await wrapper.get('.professional-avatar__photo').trigger('error')
    await nextTick()
    expect(wrapper.find('.professional-avatar__photo').exists()).toBe(false)
    expect(wrapper.get('.professional-avatar__monogram').text()).toBe('AB')

    await wrapper.setProps({ photoUrl: '/photo?v=2' })
    expect(wrapper.get('.professional-avatar__photo').attributes('src')).toBe('/photo?v=2')
  })

  it('es el retrato de latón compartido: rombo desde el tamaño de fila, no en los selectores (#799)', () => {
    const row = mount(ProfessionalAvatar, { props: { fullName: 'Julián Rodríguez', size: 'row' } })
    expect(row.classes()).toEqual(
      expect.arrayContaining(['brass-monogram', 'brass-monogram--pendant']),
    )
    const closed = mount(ProfessionalAvatar, {
      props: { fullName: 'Julián Rodríguez', size: 'closed' },
    })
    expect(closed.classes()).toContain('brass-monogram')
    expect(closed.classes()).not.toContain('brass-monogram--pendant')
    const forced = mount(ProfessionalAvatar, {
      props: { fullName: 'Julián Rodríguez', size: 'option', pendant: true },
    })
    expect(forced.classes()).toContain('brass-monogram--pendant')
  })

  it('serif solo en retrato y héroe; sans en filas y selectores (#726)', () => {
    for (const size of ['portrait', 'hero'] as const) {
      expect(
        mount(ProfessionalAvatar, { props: { fullName: 'Ana Gómez', size } }).classes(),
      ).toContain('brass-monogram--serif')
    }
    for (const size of ['closed', 'option', 'row'] as const) {
      expect(
        mount(ProfessionalAvatar, { props: { fullName: 'Ana Gómez', size } }).classes(),
      ).toContain('brass-monogram--sans')
    }
  })

  it('con foto marca la variante para el paspartú dentro del filete', () => {
    const wrapper = mount(ProfessionalAvatar, {
      props: { fullName: 'Andrés Beltrán', photoUrl: '/photo?v=1', size: 'row' },
    })
    expect(wrapper.classes()).toContain('professional-avatar--photo')
  })

  it('is always decorative: the adjacent visible name carries the accessible name', () => {
    const wrapper = mount(ProfessionalAvatar, { props: { fullName: 'Julián Rodríguez' } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('has no obvious accessibility violations next to a visible name', async () => {
    const wrapper = mount(
      {
        components: { ProfessionalAvatar },
        template: `<span><ProfessionalAvatar full-name="Julián Rodríguez" /> Julián Rodríguez</span>`,
      },
      {},
    )
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
  })
})
