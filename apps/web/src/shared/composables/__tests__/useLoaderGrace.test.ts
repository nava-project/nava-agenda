/**
 * Tests for useLoaderGrace (#820): el cargador, o no asoma (respuesta antes de
 * que aparezca), o se queda a la vista al menos LOADER_MIN_VISIBLE_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import {
  LOADER_APPEAR_MS,
  LOADER_FADE_MS,
  LOADER_MIN_VISIBLE_MS,
  useLoaderGrace,
  type LoaderGrace,
  type LoaderGraceOptions,
} from '../useLoaderGrace'

function mountWithGrace(options?: LoaderGraceOptions) {
  let grace!: LoaderGrace
  const wrapper = mount(
    defineComponent({
      setup() {
        grace = useLoaderGrace(options)
        return () => h('div')
      },
    }),
  )
  return { wrapper, grace }
}

async function settledAfter(grace: LoaderGrace, elapsed: number) {
  grace.start()
  vi.advanceTimersByTime(elapsed)
  const done = vi.fn()
  void grace.settled().then(done)
  await Promise.resolve()
  return done
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useLoaderGrace', () => {
  it('matches the appearance delay of DiamondLoader', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const loader = readFileSync(resolve(__dirname, '../../ui/DiamondLoader.vue'), 'utf8')
    expect(loader).toContain(
      `animation: diamond-loader-in 200ms ease-out ${LOADER_APPEAR_MS}ms backwards;`,
    )
  })

  it('does not delay a response that arrives before the loader appears', async () => {
    const { grace } = mountWithGrace()
    const done = await settledAfter(grace, 120)
    expect(done).toHaveBeenCalledOnce()
  })

  it('keeps a loader that could already be seen in view for the minimum time', async () => {
    const { grace } = mountWithGrace()
    const done = await settledAfter(grace, 350)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(LOADER_APPEAR_MS + LOADER_MIN_VISIBLE_MS - 350 - 1)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalledOnce()
  })

  it('treats a response a frame before the appearance as already seen', async () => {
    const { grace } = mountWithGrace()
    const done = await settledAfter(grace, LOADER_APPEAR_MS - 10)
    expect(done).not.toHaveBeenCalled()
  })

  it('adds nothing once the loader has been in view long enough', async () => {
    const { grace } = mountWithGrace()
    const done = await settledAfter(grace, LOADER_APPEAR_MS + LOADER_MIN_VISIBLE_MS + 50)
    expect(done).toHaveBeenCalledOnce()
  })

  it('counts from the last start (a retry shows the loader anew)', async () => {
    const { grace } = mountWithGrace()
    grace.start()
    vi.advanceTimersByTime(2000)
    const done = await settledAfter(grace, 400)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(done).toHaveBeenCalledOnce()
  })

  it('leaves no timer behind when the screen goes away', async () => {
    const { wrapper, grace } = mountWithGrace()
    await settledAfter(grace, 350)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('matches the fade of DiamondLoader', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const loader = readFileSync(resolve(__dirname, '../../ui/DiamondLoader.vue'), 'utf8')
    expect(loader).toContain(`animation: diamond-loader-in ${LOADER_FADE_MS}ms ease-out`)
  })

  it('can keep the loader at full opacity for the minimum, after its fade (#843)', async () => {
    const { grace } = mountWithGrace({ minVisibleMs: LOADER_FADE_MS + LOADER_MIN_VISIBLE_MS })
    const done = await settledAfter(grace, 350)
    await vi.advanceTimersByTimeAsync(
      LOADER_APPEAR_MS + LOADER_FADE_MS + LOADER_MIN_VISIBLE_MS - 350 - 1,
    )
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalledOnce()
  })

  it('counts from when a loader mounted while hidden actually appears (#843)', async () => {
    const { grace } = mountWithGrace()
    grace.start()
    // Montado dentro de un diálogo cerrado: el tiempo oculto no cuenta.
    vi.advanceTimersByTime(5000)
    grace.markAppeared()
    vi.advanceTimersByTime(50)
    const done = vi.fn()
    void grace.settled().then(done)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(LOADER_MIN_VISIBLE_MS - 50)
    expect(done).toHaveBeenCalledOnce()
  })

  it('restarts a pending wait when a hidden loader appears after the data (#843 r1, C2)', async () => {
    const minVisibleMs = LOADER_FADE_MS + LOADER_MIN_VISIBLE_MS
    const { grace } = mountWithGrace({ minVisibleMs })
    // Reprogramar: la espera se monta con la página, en el diálogo cerrado; los
    // datos llegan a los 250 ms y el diálogo se abre a los 150, así que el
    // esqueleto empieza a asomar a los 450, con el settled() ya pendiente.
    const done = await settledAfter(grace, 250)
    await vi.advanceTimersByTimeAsync(200)
    grace.markAppeared()
    // Antes se soltaba a los 800 ms desde start(): 150 ms después de asomar.
    await vi.advanceTimersByTimeAsync(minVisibleMs - 1)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalledOnce()
  })

  it('leaves an already released wait alone when the loader appears later', async () => {
    const { grace } = mountWithGrace()
    const done = await settledAfter(grace, 100)
    expect(done).toHaveBeenCalledOnce()
    grace.markAppeared()
    await vi.advanceTimersByTimeAsync(2000)
    expect(done).toHaveBeenCalledOnce()
  })
})
