import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import WeeklyBoard from '../WeeklyBoard.vue'

// El tablero desplazable revela el control enfocado cuando queda bajo el eje
// fijo o recortado abajo (#769). La suite E2E solo corre en Chromium, que ya lo
// resuelve con scroll-padding; esto cubre el caso de Firefox, que no desplaza si
// el control asoma en parte.

const days = [1, 2, 3, 4, 5, 6, 7].map((value) => ({
  value,
  label: `Día ${value}`,
  items: [],
}))

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function mountBoard({ scrollable = true } = {}) {
  const wrapper = mount(WeeklyBoard, {
    attachTo: document.body,
    props: {
      days,
      scale: { startMinute: 420, endMinute: 1260 },
      todayIsoWeekday: null,
      nowMinute: null,
      pendingDeleteIds: new Set<string>(),
      regionLabel: 'Semana de Barbero de prueba',
    },
  })
  const board = wrapper.get('.week-board').element as HTMLElement
  const axis = wrapper.get('.week-board__axis').element as HTMLElement
  // Tablero visible de 100 a 600 (sin borde); el eje fijo termina en 126.
  Object.defineProperty(board, 'clientHeight', { configurable: true, value: 500 })
  Object.defineProperty(board, 'clientTop', { configurable: true, value: 0 })
  Object.defineProperty(board, 'scrollHeight', {
    configurable: true,
    value: scrollable ? 1200 : 500,
  })
  board.getBoundingClientRect = () => rect(100, 500)
  axis.getBoundingClientRect = () => rect(100, 26)
  return wrapper
}

function focusAddAt(wrapper: ReturnType<typeof mountBoard>, top: number) {
  const add = wrapper.get('.week-board__add').element as HTMLElement
  add.getBoundingClientRect = () => rect(top, 36)
  add.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  return add
}

describe('WeeklyBoard · foco dentro del tablero desplazable', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reveals a control that sits under the sticky axis', () => {
    const wrapper = mountBoard()
    const add = focusAddAt(wrapper, 121) // 121 − 4 de anillo < 126 del eje
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.contexts[0]).toBe(add)
    wrapper.unmount()
  })

  it('reveals a control whose focus ring is clipped at the bottom edge', () => {
    const wrapper = mountBoard()
    focusAddAt(wrapper, 562) // 562 + 36 + 4 de anillo > 600
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    wrapper.unmount()
  })

  it('leaves a fully visible control alone', () => {
    const wrapper = mountBoard()
    focusAddAt(wrapper, 130) // de 126 + 4 a 600 − 4 cabe entero
    focusAddAt(wrapper, 560)
    expect(scrollIntoView).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does nothing when the board does not scroll (narrow layout: the page grows)', () => {
    const wrapper = mountBoard({ scrollable: false })
    focusAddAt(wrapper, 20)
    expect(scrollIntoView).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('WeeklyBoard · región desplazable', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is a named region only while it scrolls on its own (Firefox makes it focusable)', async () => {
    const wrapper = mountBoard()
    // Las medidas simuladas llegan después del montaje: un cambio de días vuelve a medir.
    await wrapper.setProps({ days: days.map((day) => ({ ...day })) })
    await flushPromises()
    const board = wrapper.get('.week-board')
    expect(board.attributes('role')).toBe('region')
    expect(board.attributes('aria-label')).toBe('Semana de Barbero de prueba')
    wrapper.unmount()
  })

  it('is not a region when it grows with the page (narrow layout)', async () => {
    const wrapper = mountBoard({ scrollable: false })
    await wrapper.setProps({ days: days.map((day) => ({ ...day })) })
    await flushPromises()
    const board = wrapper.get('.week-board')
    expect(board.attributes('role')).toBeUndefined()
    expect(board.attributes('aria-label')).toBeUndefined()
    wrapper.unmount()
  })
})

// #782: el tablero con la familia. El tramo es la pieza (hora en serif con el
// sufijo menudo) y sus acciones conservan los nombres accesibles de antes.
describe('WeeklyBoard · familia (#782)', () => {
  const tramo = {
    id: 'wh-1',
    isoWeekday: 1,
    startsTime: '08:00',
    durationMinutes: 240,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  }

  function mountFamily() {
    return mount(WeeklyBoard, {
      props: {
        days: [
          { value: 1, label: 'Lunes', items: [tramo] },
          { value: 2, label: 'Martes', items: [] },
        ],
        scale: { startMinute: 420, endMinute: 1260 },
        todayIsoWeekday: 1,
        nowMinute: 600,
        pendingDeleteIds: new Set<string>(),
      },
    })
  }

  it('reads the tramo as a 12-hour range with the suffix kept as text', () => {
    const chip = mountFamily().get('.week-board__chip-time')
    expect(chip.text()).toBe('8:00 a. m. – 12:00 p. m.')
    expect(chip.findAll('small').map((s) => s.text())).toEqual(['a. m.', 'p. m.'])
  })

  it('keeps the accessible names of the row actions and the add button', () => {
    const wrapper = mountFamily()
    expect(wrapper.find('[aria-label="Editar tramo de Lunes a las 8:00 a. m."]').exists()).toBe(
      true,
    )
    expect(wrapper.find('[aria-label="Retirar tramo de Lunes a las 8:00 a. m."]').exists()).toBe(
      true,
    )
    expect(wrapper.find('[aria-label="Agregar un tramo el Martes"]').exists()).toBe(true)
  })

  it('marks today with the brass label and a free day with a notebook line', () => {
    const wrapper = mountFamily()
    expect(wrapper.get('.week-board__day--today .week-board__today').text()).toBe('Hoy')
    expect(wrapper.get('.week-board__day--free .week-board__empty').text()).toBe('Sin tramos')
  })

  it('staggers the arrival by passing each day its index', () => {
    const days = mountFamily().findAll('.week-board__day')
    expect(days.map((d) => d.attributes('style'))).toEqual(['--day-index: 0;', '--day-index: 1;'])
  })
})
