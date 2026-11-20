/**
 * useCountUp (#743): la cifra cuenta hasta su valor, es finita, arranca en 0
 * sin pasar por negativos y llega en seco con movimiento reducido o donde no
 * hay quien vea la cuenta (sin matchMedia).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { COUNT_UP_MS, useCountUp } from '../useCountUp'

type FrameCallback = (now: number) => void

describe('useCountUp', () => {
  let frames: FrameCallback[] = []
  let clock = 0

  function mockMotion(reduce: boolean) {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia
  }

  /** Corre el siguiente cuadro con un sello `offset` ms después del reloj. */
  function runFrame(offset: number) {
    const callback = frames.shift()
    callback?.(clock + offset)
  }

  beforeEach(() => {
    frames = []
    clock = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    // @ts-expect-error se retira el doble de prueba
    delete window.matchMedia
    delete document.documentElement.dataset.motion
  })

  it('sin matchMedia (jsdom) muestra el valor de inmediato', () => {
    // @ts-expect-error jsdom no trae matchMedia
    delete window.matchMedia
    const shown = useCountUp(() => 72)
    expect(shown.value).toBe(72)
  })

  it('con movimiento reducido llega en seco', () => {
    mockMotion(true)
    const shown = useCountUp(() => 72)
    expect(shown.value).toBe(72)
    expect(frames).toHaveLength(0)
  })

  it('con Configuración en reducido también llega en seco', () => {
    mockMotion(false)
    document.documentElement.dataset.motion = 'reduced'
    expect(useCountUp(() => 6).value).toBe(6)
  })

  it('cuenta desde 0, nunca en negativo, y termina exacto en el valor', () => {
    mockMotion(false)
    const shown = useCountUp(() => 4320)
    expect(shown.value).toBe(0)
    // Un sello de cuadro anterior al inicio no lo lleva a negativo.
    runFrame(-16)
    expect(shown.value).toBe(0)
    runFrame(COUNT_UP_MS / 2)
    expect(shown.value).toBeGreaterThan(2160)
    expect(shown.value).toBeLessThan(4320)
    runFrame(COUNT_UP_MS + 50)
    expect(shown.value).toBe(4320)
    expect(frames).toHaveLength(0)
  })

  it('al cambiar el valor cuenta desde la cifra mostrada', async () => {
    mockMotion(false)
    const target = ref(6)
    const shown = useCountUp(() => target.value)
    runFrame(COUNT_UP_MS)
    expect(shown.value).toBe(6)
    target.value = 3
    await nextTick()
    runFrame(COUNT_UP_MS / 3)
    expect(shown.value).toBeLessThan(6)
    expect(shown.value).toBeGreaterThan(3)
    runFrame(COUNT_UP_MS)
    expect(shown.value).toBe(3)
  })
})
