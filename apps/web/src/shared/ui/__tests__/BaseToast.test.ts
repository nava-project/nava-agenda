/**
 * Pruebas de BaseToast (DEC-095): anatomía del acordeón, palabra de estado,
 * roles ARIA por variante y eventos hacia la región.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import BaseToast from '../BaseToast.vue'

// Ver BaseAlert.test.ts: color-contrast se desactiva por la ausencia de
// Canvas2D en jsdom; los pares están fijados en estandar-diseno-visual.md.
const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

const base = { title: 'Servicio guardado', expanded: false, held: false, durationMs: 5000 }

describe('BaseToast', () => {
  it.each([
    ['success', 'Confirmación'],
    ['info', 'Nota'],
    ['warning', 'Atención'],
    ['danger', 'Error'],
  ] as const)('shows the status word for %s besides its colour', (variant, word) => {
    const wrapper = mount(BaseToast, { props: { ...base, variant } })

    expect(wrapper.find('.base-toast__status').text()).toBe(word)
    expect(wrapper.classes()).toContain(`base-toast--${variant}`)
  })

  it('uses role alert only for errors and role status for the rest', () => {
    expect(mount(BaseToast, { props: { ...base, variant: 'danger' } }).attributes('role')).toBe(
      'alert',
    )
    for (const variant of ['success', 'info', 'warning'] as const) {
      expect(mount(BaseToast, { props: { ...base, variant } }).attributes('role')).toBe('status')
    }
  })

  it('declares aria-live and aria-atomic so the whole toast is announced (#794)', () => {
    const danger = mount(BaseToast, { props: { ...base, variant: 'danger' } })
    expect(danger.attributes('aria-live')).toBe('assertive')
    expect(danger.attributes('aria-atomic')).toBe('true')
    for (const variant of ['success', 'info', 'warning'] as const) {
      const toast = mount(BaseToast, { props: { ...base, variant } })
      expect(toast.attributes('aria-live')).toBe('polite')
      expect(toast.attributes('aria-atomic')).toBe('true')
    }
  })

  it('draws the status seal as a rhombus, not a rounded box (#794)', () => {
    const wrapper = mount(BaseToast, { props: { ...base, variant: 'warning' } })
    const mark = wrapper.find('.base-toast__mark')
    expect(mark.attributes('aria-hidden')).toBe('true')
    expect(mark.find('svg').attributes('width')).toBe('12')
  })

  it('exposes the accordion state on the head button', () => {
    const closed = mount(BaseToast, { props: { ...base, variant: 'success', detail: 'Detalle' } })
    const head = closed.find('.base-toast__head')
    expect(head.attributes('aria-expanded')).toBe('false')
    expect(head.attributes('aria-controls')).toBe(
      closed.find('.base-toast__panel').attributes('id'),
    )

    const open = mount(BaseToast, {
      props: { ...base, variant: 'success', detail: 'Detalle', expanded: true },
    })
    expect(open.find('.base-toast__head').attributes('aria-expanded')).toBe('true')
    expect(open.find('.base-toast__panel').classes()).toContain('base-toast__panel--open')
  })

  it('announces the detail to screen readers only while the panel is closed', async () => {
    const wrapper = mount(BaseToast, {
      props: { ...base, variant: 'danger', detail: 'Revisa tu conexión.' },
    })
    expect(wrapper.find('.base-toast__sr').text()).toBe('Revisa tu conexión.')

    await wrapper.setProps({ expanded: true })
    expect(wrapper.find('.base-toast__sr').exists()).toBe(false)
    expect(wrapper.find('.base-toast__detail').text()).toBe('Revisa tu conexión.')
  })

  it('renders the safe reference and the action only when provided', () => {
    const plain = mount(BaseToast, { props: { ...base, variant: 'info' } })
    expect(plain.find('.base-toast__reference').exists()).toBe(false)
    expect(plain.find('.base-toast__action').exists()).toBe(false)

    const full = mount(BaseToast, {
      props: {
        ...base,
        variant: 'danger',
        reference: 'req_8d41c2',
        actionLabel: 'Reintentar',
        actionIcon: 'retry',
        expanded: true,
      },
    })
    expect(full.find('.base-toast__reference').text()).toBe('ID de solicitud · req_8d41c2')
    expect(full.find('.base-toast__action').text()).toBe('Reintentar')
  })

  it('always offers a labelled dismiss control', () => {
    const wrapper = mount(BaseToast, { props: { ...base, variant: 'success', expanded: true } })

    expect(wrapper.find('.base-toast__dismiss').text()).toBe('Descartar')
  })

  it('emits toggle, dismiss and action', async () => {
    const wrapper = mount(BaseToast, {
      props: { ...base, variant: 'danger', actionLabel: 'Reintentar', expanded: true },
    })

    await wrapper.find('.base-toast__head').trigger('click')
    await wrapper.find('.base-toast__action').trigger('click')
    await wrapper.find('.base-toast__dismiss').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.emitted('action')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('reports the cursor entering and leaving the toast', async () => {
    const wrapper = mount(BaseToast, { props: { ...base, variant: 'info' } })

    await wrapper.trigger('mouseenter')
    await wrapper.trigger('mouseleave')

    expect(wrapper.emitted('hover')).toEqual([[true], [false]])
  })

  it('holds the countdown for keyboard focus but not for a mouse click', async () => {
    const wrapper = mount(BaseToast, {
      props: { ...base, variant: 'info' },
      attachTo: document.body,
    })
    const head = wrapper.find('.base-toast__head')
    const matches = vi.spyOn(head.element, 'matches')

    // Un clic deja el foco en el botón pero no es `:focus-visible`.
    matches.mockReturnValue(false)
    await head.trigger('focusin')
    expect(wrapper.emitted('focus')).toBeUndefined()

    matches.mockReturnValue(true)
    await head.trigger('focusin')
    await head.trigger('focusout')
    expect(wrapper.emitted('focus')).toEqual([[true], [false]])
    wrapper.unmount()
  })

  it('does not report leaving when focus moves between its own buttons', async () => {
    const wrapper = mount(BaseToast, {
      props: { ...base, variant: 'danger', actionLabel: 'Reintentar', expanded: true },
      attachTo: document.body,
    })

    await wrapper.find('.base-toast__head').trigger('focusout', {
      relatedTarget: wrapper.find('.base-toast__action').element,
    })

    expect(wrapper.emitted('focus')).toBeUndefined()
    wrapper.unmount()
  })

  it('pauses the time rule while held and sets its duration', () => {
    const running = mount(BaseToast, { props: { ...base, variant: 'info', durationMs: 6000 } })
    const fill = running.find('.base-toast__fill')
    expect(fill.attributes('style')).toContain('animation-duration: 6000ms')
    expect(fill.attributes('style')).toContain('animation-play-state: running')

    const held = mount(BaseToast, { props: { ...base, variant: 'info', held: true } })
    expect(held.find('.base-toast__fill').attributes('style')).toContain('paused')
  })

  it.each(['success', 'info', 'warning', 'danger'] as const)(
    'has no axe violations for %s (closed and open)',
    async (variant) => {
      const closed = mount(BaseToast, {
        props: { ...base, variant, detail: 'Detalle' },
        attachTo: document.body,
      })
      expect(await axe(closed.element, axeOptions)).toHaveNoViolations()
      closed.unmount()

      const open = mount(BaseToast, {
        props: {
          ...base,
          variant,
          detail: 'Detalle',
          reference: 'req_1',
          actionLabel: 'Reintentar',
          expanded: true,
        },
        attachTo: document.body,
      })
      expect(await axe(open.element, axeOptions)).toHaveNoViolations()
      open.unmount()
    },
  )
})

describe('anillo de foco de la cabecera (#794, WCAG 2.4.7)', () => {
  it('va por dentro de la cabecera y le gana a la regla general de botones', () => {
    // El aviso recorta con `overflow: hidden`: con el desplazamiento general de +2 px el anillo
    // queda fuera y no se ve. jsdom no resuelve la cascada, así que se fija el selector.
    const sfc = readFileSync(join(__dirname, '..', 'BaseToast.vue'), 'utf8')
    const css = sfc.slice(sfc.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.base-toast button:focus-visible \{[^}]*outline-offset: 2px;/)
    expect(css).toMatch(/\.base-toast \.base-toast__head:focus-visible \{\s*outline-offset: -4px;/)
    expect(css).not.toMatch(/(^|\})\s*\.base-toast__head:focus-visible \{/)
  })
})
