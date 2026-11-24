/**
 * Tests for ContentReveal (#817): el contenido se monta debajo del esqueleto,
 * el esqueleto saliente queda mudo e inerte, las llegadas finitas del
 * contenido se dan por terminadas al destaparlo y el fundido depende solo de
 * los tokens de movimiento (que base.css anula con movimiento reducido).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { axe } from 'vitest-axe'
import ContentReveal from '../ContentReveal.vue'

const axeOptions = { rules: { region: { enabled: false } } }

function mountReveal(loading: boolean) {
  return mount(ContentReveal, {
    props: { loading },
    slots: {
      default: '<ul class="content"><li>Corte clásico</li></ul>',
      loading: '<div class="skeleton" role="status" aria-live="polite">Cargando…</div>',
    },
    attachTo: document.body,
    // La transición real: sus ganchos de salida son lo que se prueba.
    global: { stubs: { transition: false } },
  })
}

function fakeAnimation(target: Element, endTime: number) {
  return {
    effect: { target, getComputedTiming: () => ({ endTime }) },
    finish: vi.fn(),
  }
}

describe('ContentReveal', () => {
  it('mounts the content underneath while the skeleton covers it', () => {
    const wrapper = mountReveal(true)
    const children = [...wrapper.element.children]
    expect(children.map((el) => el.className)).toEqual(['content', 'content-reveal__cover'])
    expect(wrapper.get('.content-reveal__cover .skeleton').text()).toBe('Cargando…')
    expect(wrapper.get('.content-reveal__cover').attributes('aria-hidden')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps what lies underneath transparent and inert while covered, and releases it as the cover starts to leave', async () => {
    const wrapper = mountReveal(true)
    const content = wrapper.get('.content').element as HTMLElement
    expect(wrapper.classes()).toContain('content-reveal--covered')
    expect(content.hasAttribute('inert')).toBe(true)
    await wrapper.setProps({ loading: false })
    // En el mismo cuadro en que la tapa empieza a irse, aún en el DOM.
    expect(wrapper.find('.content-reveal__cover').exists()).toBe(true)
    expect(wrapper.classes()).not.toContain('content-reveal--covered')
    expect(content.hasAttribute('inert')).toBe(false)
    wrapper.unmount()
  })

  it('makes content mounted later under the cover inert too, and never removes an inert it did not set', async () => {
    const Host = defineComponent({
      props: {
        loading: { type: Boolean, required: true },
        late: { type: Boolean, required: true },
      },
      setup(props) {
        return () =>
          h(
            ContentReveal,
            { loading: props.loading },
            {
              default: () => [
                h('div', { class: 'own', inert: '' }, 'propio'),
                props.late ? h('div', { class: 'late' }, 'tarde') : null,
              ],
              loading: () => h('div', { class: 'skeleton' }, 'Cargando…'),
            },
          )
      },
    })
    const wrapper = mount(Host, {
      props: { loading: true, late: false },
      attachTo: document.body,
      global: { stubs: { transition: false } },
    })
    await wrapper.setProps({ late: true })
    expect(wrapper.get('.late').attributes('inert')).toBe('')

    await wrapper.setProps({ loading: false })
    expect(wrapper.get('.late').attributes('inert')).toBeUndefined()
    // El `inert` propio del contenido sigue en su sitio.
    expect(wrapper.get('.own').attributes('inert')).toBe('')
    wrapper.unmount()
  })

  it('hides the covered content with opacity, which keeps its box and no descendant can undo', () => {
    const source = readFileSync(resolve(__dirname, '../ContentReveal.vue'), 'utf8')
    expect(source).toMatch(
      /\.content-reveal--covered > :deep\(\*:not\(\.content-reveal__cover\)\) \{\s*opacity: 0;/,
    )
  })

  it('shows only the content once loaded', () => {
    const wrapper = mountReveal(false)
    expect(wrapper.find('.content-reveal__cover').exists()).toBe(false)
    expect(wrapper.get('.content').text()).toBe('Corte clásico')
    wrapper.unmount()
  })

  it('silences and disables the leaving skeleton from the first frame of its fade', async () => {
    const wrapper = mountReveal(true)
    const cover = wrapper.get('.content-reveal__cover').element as HTMLElement
    await wrapper.setProps({ loading: false })
    await nextTick()
    // Sigue en el DOM mientras se desvanece, pero ya no se lee ni se enfoca.
    expect(cover.getAttribute('aria-hidden')).toBe('true')
    expect(cover.inert).toBe(true)
    wrapper.unmount()
  })

  it('finishes the finite arrivals of the content when the cover leaves, leaving the rest alone', async () => {
    const wrapper = mountReveal(true)
    const row = wrapper.get('.content li').element
    const skeleton = wrapper.get('.skeleton').element
    const rowArrival = fakeAnimation(row, 180)
    const endless = fakeAnimation(row, Infinity)
    const skeletonPulse = fakeAnimation(skeleton, 1200)
    const stage = wrapper.element as HTMLElement
    // Dobles mínimos: solo lo que ContentReveal lee de cada animación.
    stage.getAnimations = vi.fn(
      () => [rowArrival, endless, skeletonPulse] as unknown as Animation[],
    )

    await wrapper.setProps({ loading: false })
    await nextTick()

    expect(stage.getAnimations).toHaveBeenCalledWith({ subtree: true })
    expect(rowArrival.finish).toHaveBeenCalledTimes(1)
    // `finish()` en una infinita lanza; el pulso del esqueleto se va con él.
    expect(endless.finish).not.toHaveBeenCalled()
    expect(skeletonPulse.finish).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not fail where the Web Animations API is missing', async () => {
    const wrapper = mountReveal(true)
    expect('getAnimations' in wrapper.element).toBe(false)
    await wrapper.setProps({ loading: false })
    await nextTick()
    expect(wrapper.get('.content-reveal__cover').attributes('aria-hidden')).toBe('true')
    wrapper.unmount()
  })

  it('fades only with the motion tokens, which reduced motion neutralises', () => {
    const source = readFileSync(resolve(__dirname, '../ContentReveal.vue'), 'utf8')
    expect(source).toMatch(
      /\.content-reveal-leave-active \{\s*transition: opacity var\(--motion-duration-base\) var\(--motion-easing-standard\);/,
    )
    // Un retardo no lo anula base.css; tampoco hay fundido de entrada.
    expect(source).not.toMatch(/transition-delay|content-reveal-enter/)
  })

  it('has no axe violations while loading', async () => {
    const wrapper = mountReveal(true)
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })
})
