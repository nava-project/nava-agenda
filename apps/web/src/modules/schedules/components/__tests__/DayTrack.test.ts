import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DayTrack from '../DayTrack.vue'

const scale = { startMinute: 420, endMinute: 1260 }

describe('DayTrack', () => {
  it('is decorative: hidden from assistive technology', () => {
    const wrapper = mount(DayTrack, { props: { segments: [], scale } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('draws one bar per valid tramo, positioned as a percentage of the ruler', () => {
    const wrapper = mount(DayTrack, {
      props: {
        segments: [
          { id: 'a', startsTime: '09:00', durationMinutes: 240 },
          { id: 'b', startsTime: '', durationMinutes: 60 },
          { id: 'c', startsTime: '14:00', durationMinutes: 0 },
        ],
        scale,
      },
    })

    const bars = wrapper.findAll('.day-track__bar')
    expect(bars).toHaveLength(1)
    expect(bars[0]!.attributes('style')).toContain('--bar-from: 14.28')
    expect(bars[0]!.attributes('style')).toContain('--bar-span: 28.57')
  })

  it('highlights the active tramo and mutes context tramos', () => {
    const wrapper = mount(DayTrack, {
      props: {
        segments: [
          { id: 'a', startsTime: '09:00', durationMinutes: 120 },
          { id: 'b', startsTime: '14:00', durationMinutes: 120, muted: true },
        ],
        scale,
        activeId: 'a',
      },
    })

    const [first, second] = wrapper.findAll('.day-track__bar')
    expect(first!.classes()).toContain('day-track__bar--active')
    expect(second!.classes()).toContain('day-track__bar--muted')
  })

  it('draws the now marker only inside the ruler', () => {
    const inside = mount(DayTrack, { props: { segments: [], scale, nowMinute: 840 } })
    const outside = mount(DayTrack, { props: { segments: [], scale, nowMinute: 120 } })

    expect(inside.find('.day-track__now').attributes('style')).toContain('left: 50%')
    expect(outside.find('.day-track__now').exists()).toBe(false)
  })

  it('flags a tramo that crosses midnight', () => {
    const wrapper = mount(DayTrack, {
      props: {
        segments: [{ id: 'n', startsTime: '20:00', durationMinutes: 480 }],
        scale: { startMinute: 420, endMinute: 1440 },
      },
    })

    expect(wrapper.find('.day-track__bar').classes()).toContain('day-track__bar--cut')
  })
})

// #782: cada tramo abre su ventana al cielo de la familia. La imagen del cielo
// mide lo que la pista y se corre hasta la hora del tramo.
describe('DayTrack · cielo de la familia', () => {
  it('paints the sky once for the ruler and frames it per tramo', () => {
    const wrapper = mount(DayTrack, {
      props: { segments: [{ id: 'a', startsTime: '09:00', durationMinutes: 240 }], scale },
    })

    expect(wrapper.attributes('style')).toContain('--track-sky: linear-gradient(90deg')
    const style = wrapper.get('.day-track__bar').attributes('style')
    // span 28,571 % → la imagen mide 100/0,28571 = 350 % de la barra.
    expect(style).toContain('--bar-sky-size: 350.000%')
    // from 14,286 % → X = from / (100 − span) = 20 %.
    expect(style).toContain('--bar-sky-at: 20.000%')
  })

  it('keeps a full-width tramo anchored at the start of the sky', () => {
    const wrapper = mount(DayTrack, {
      props: { segments: [{ id: 'all', startsTime: '07:00', durationMinutes: 840 }], scale },
    })

    const style = wrapper.get('.day-track__bar').attributes('style')
    expect(style).toContain('--bar-sky-size: 100.000%')
    expect(style).toContain('--bar-sky-at: 0.000%')
  })
})
