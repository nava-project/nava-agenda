/**
 * Tests for BaseButton component
 * Verifies: variants, sizes, states, accessibility, events
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import BaseButton from '../BaseButton.vue'

// axe-core (vía vitest-axe) es la herramienta de verificación accesible
// automatizada elegida en la auditoría HU-009 para nava-docs/agenda/03-desarrollo/estrategia-pruebas.md
// §5.4: motor WCAG 2.1/2.2 de referencia, MIT, mantenimiento activo, ya
// integrable con Vitest sin un navegador real. No sustituye la revisión
// manual por teclado que este mismo archivo ya cubre.
// color-contrast se desactiva: jsdom no implementa Canvas2D, así que ese
// chequeo de axe-core no puede medir contraste real aquí (falla o cuelga
// con "HTMLCanvasElement.prototype.getContext"). El contraste ya está
// verificado por la tabla aprobada de estandar-diseno-visual.md §4.3 para
// cada combinación de tokens que estos componentes usan.
const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

describe('BaseButton', () => {
  describe('Rendering', () => {
    it('renders as button element', () => {
      const wrapper = mount(BaseButton, { slots: { default: 'Click me' } })
      expect(wrapper.element.tagName).toBe('BUTTON')
    })

    it('renders slot content', () => {
      const wrapper = mount(BaseButton, { slots: { default: 'Click me' } })
      expect(wrapper.text()).toContain('Click me')
    })

    it('applies variant classes', () => {
      const variants = ['primary', 'secondary', 'soft', 'ghost', 'danger'] as const
      variants.forEach((variant) => {
        const wrapper = mount(BaseButton, { props: { variant }, slots: { default: 'Test' } })
        expect(wrapper.classes()).toContain(`base-button--${variant}`)
      })
    })

    it('applies size classes', () => {
      // 'sm' se eliminó en la auditoría HU-009: el estándar visual no
      // define un tamaño de botón por debajo de 44px (CA-009-03).
      const sizes = ['md', 'lg'] as const
      sizes.forEach((size) => {
        const wrapper = mount(BaseButton, { props: { size }, slots: { default: 'Test' } })
        expect(wrapper.classes()).toContain(`base-button--${size}`)
      })
    })
  })

  describe('States', () => {
    it('applies disabled class and attributes when disabled', () => {
      const wrapper = mount(BaseButton, { props: { disabled: true }, slots: { default: 'Test' } })
      expect(wrapper.classes()).toContain('base-button--disabled')
      expect(wrapper.attributes('disabled')).toBeDefined()
      expect(wrapper.attributes('aria-disabled')).toBe('true')
    })

    it('applies loading class and attributes when loading', () => {
      const wrapper = mount(BaseButton, { props: { loading: true }, slots: { default: 'Test' } })
      expect(wrapper.classes()).toContain('base-button--loading')
      expect(wrapper.attributes('disabled')).toBeDefined()
      expect(wrapper.attributes('aria-disabled')).toBe('true')
      expect(wrapper.attributes('aria-busy')).toBe('true')
      expect(wrapper.find('.base-button__spinner').exists()).toBe(true)
    })

    it('applies pressed class when pressed', () => {
      const wrapper = mount(BaseButton, { props: { pressed: true }, slots: { default: 'Test' } })
      expect(wrapper.classes()).toContain('base-button--pressed')
      expect(wrapper.attributes('aria-pressed')).toBe('true')
    })

    it('sets type attribute', () => {
      const types = ['button', 'submit', 'reset'] as const
      types.forEach((type) => {
        const wrapper = mount(BaseButton, { props: { type }, slots: { default: 'Test' } })
        expect(wrapper.attributes('type')).toBe(type)
      })
    })
  })

  describe('Events', () => {
    it('emits click event when clicked', async () => {
      const wrapper = mount(BaseButton, { slots: { default: 'Test' } })
      await wrapper.trigger('click')
      expect(wrapper.emitted('click')).toBeTruthy()
    })

    it('does not emit click when disabled', async () => {
      const wrapper = mount(BaseButton, { props: { disabled: true }, slots: { default: 'Test' } })
      await wrapper.trigger('click')
      expect(wrapper.emitted('click')).toBeFalsy()
    })

    it('does not emit click when loading', async () => {
      const wrapper = mount(BaseButton, { props: { loading: true }, slots: { default: 'Test' } })
      await wrapper.trigger('click')
      expect(wrapper.emitted('click')).toBeFalsy()
    })

    it('passes native event to click handler', async () => {
      const wrapper = mount(BaseButton, { slots: { default: 'Test' } })
      await wrapper.trigger('click')
      const clickEvent = wrapper.emitted('click')?.[0]?.[0]
      expect(clickEvent).toBeInstanceOf(MouseEvent)
    })
  })

  describe('Accessibility', () => {
    it('has native button role', () => {
      const wrapper = mount(BaseButton, { slots: { default: 'Test' } })
      // button element has implicit role="button"
      expect(wrapper.element.tagName).toBe('BUTTON')
    })

    it('has aria-disabled when disabled', () => {
      const wrapper = mount(BaseButton, { props: { disabled: true }, slots: { default: 'Test' } })
      expect(wrapper.attributes('aria-disabled')).toBe('true')
    })

    it('has aria-pressed when pressed', () => {
      const wrapper = mount(BaseButton, { props: { pressed: true }, slots: { default: 'Test' } })
      expect(wrapper.attributes('aria-pressed')).toBe('true')
    })

    it('has aria-busy when loading', () => {
      const wrapper = mount(BaseButton, { props: { loading: true }, slots: { default: 'Test' } })
      expect(wrapper.attributes('aria-busy')).toBe('true')
    })

    it('spinner has aria-hidden', () => {
      const wrapper = mount(BaseButton, { props: { loading: true }, slots: { default: 'Test' } })
      const spinner = wrapper.find('.base-button__spinner')
      expect(spinner.attributes('aria-hidden')).toBe('true')
    })

    it('waits with the diamond in the sun, centered over the hidden label (#735)', () => {
      const wrapper = mount(BaseButton, {
        props: { loading: true, loadingLabel: 'Confirmando…' },
        slots: { default: 'Confirmar turno' },
      })
      // El texto sigue en su sitio, invisible: guarda el ancho y el nombre accesible.
      const content = wrapper.get('.base-button__content')
      expect(content.classes()).toContain('base-button__content--waiting')
      expect(content.text()).toBe('Confirmar turno')
      // Encima, fuera del contenido: la marca y el gerundio, ocultos al lector.
      const spinner = wrapper.get('.base-button__spinner')
      expect(spinner.element.parentElement).toBe(wrapper.element)
      expect(spinner.find('svg.sun-diamond').exists()).toBe(true)
      expect(spinner.get('.base-button__wait-label').text()).toBe('Confirmando…')
    })

    it('does not look disabled while it waits', () => {
      const css = readFileSync(resolve(__dirname, '../BaseButton.vue'), 'utf-8')
      expect(css).toMatch(/\.base-button--loading:disabled \{\s*opacity: 1;/)
      expect(css).toMatch(/\.base-button__content--waiting \{\s*opacity: 0;/)
    })
  })

  describe('Accesibilidad automatizada (axe-core, CA-009-05)', () => {
    it('sin violaciones en estado normal', async () => {
      const wrapper = mount(BaseButton, {
        props: { variant: 'primary' },
        slots: { default: 'Confirmar' },
      })
      expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    })

    it('sin violaciones en estado cargando', async () => {
      const wrapper = mount(BaseButton, {
        props: { loading: true },
        slots: { default: 'Confirmando…' },
      })
      expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    })

    it('sin violaciones en estado deshabilitado', async () => {
      const wrapper = mount(BaseButton, {
        props: { disabled: true },
        slots: { default: 'No disponible' },
      })
      expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    })
  })

  describe('Fallthrough de clase', () => {
    // class ya no es un prop propio (auditoría HU-009: un prop de clase
    // libre elude el sistema semántico). Un consumidor sigue pudiendo
    // agregar una clase de layout mediante el fallthrough automático de
    // Vue hacia el único elemento raíz.
    it('hereda una clase pasada por el consumidor', () => {
      const wrapper = mount(BaseButton, {
        attrs: { class: 'my-custom-class' },
        slots: { default: 'Test' },
      })
      expect(wrapper.classes()).toContain('my-custom-class')
    })
  })
})

// jsdom no resuelve la cascada, así que se protege la regla en la fuente: si el
// hover/active del primario recupera la especificidad plena de `:hover:not()`,
// vuelve a pisar el acento de marca que las pantallas sobre tinta aplican
// (1.16:1, campaña #301, HALL-CAT-04). Verificado además con axe en navegador real.
describe('BaseButton primary state rules', () => {
  const source = readFileSync(resolve(__dirname, '../BaseButton.vue'), 'utf-8')

  it.each(['hover', 'active'])(
    'keeps the %s background at the specificity of the variant',
    (state) => {
      expect(source).toContain(
        `.base-button--primary:where(:${state}:not(:disabled):not(.base-button--loading)) {`,
      )
      expect(source).not.toMatch(
        new RegExp(
          `^\\.base-button--primary:${state}:not\\(:disabled\\)[^{]*\\{\\s*background-color`,
          'm',
        ),
      )
    },
  )

  // #511: jsdom no calcula el layout, así que la alineación se protege leyendo la regla: con un
  // icono dentro (svg o aria-hidden que no sea el spinner) el contenido es una fila centrada.
  describe('Icon alignment (#511)', () => {
    const css = readFileSync(resolve(__dirname, '../BaseButton.vue'), 'utf-8')
    const rule = /\.base-button__content:has\(([^)]*\)?[^)]*)\)\s*\{([^}]*)\}/.exec(css)

    it('centers the icon and the label on the same axis when the content has an icon', () => {
      expect(rule).not.toBeNull()
      expect(rule![0]).toContain('> svg')
      expect(rule![0]).toContain(':not(.base-button__spinner)')
      expect(rule![2]).toContain('display: inline-flex')
      expect(rule![2]).toContain('align-items: center')
    })

    it('renders icon and label as siblings inside the content, spinner excluded', () => {
      const wrapper = mount(BaseButton, {
        slots: { default: '<svg aria-hidden="true"></svg>Reprogramar' },
      })
      const content = wrapper.get('.base-button__content')
      expect(content.element.firstElementChild?.tagName.toLowerCase()).toBe('svg')
      expect(content.text()).toBe('Reprogramar')
    })
  })
})
