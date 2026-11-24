/**
 * Desplazamiento al navegar (H7, #824): atrás/adelante restauran la posición y,
 * en los pasos de la reserva, la vuelven a aplicar cuando el paso se destapa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

const restoreWhenStepReady = vi.hoisted(() => vi.fn())
const cancelStepScrollRestore = vi.hoisted(() => vi.fn())
vi.mock('@/modules/public-booking', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/public-booking')>()),
  cancelStepScrollRestore,
  restoreWhenStepReady,
}))

const { router } = await import('../index')
const scrollBehavior = router.options.scrollBehavior!
// Las rutas que este archivo resuelve tienen nombre: ninguna es la de «no encontrada».
const at = (path: string) => router.resolve(path) as RouteLocationNormalized

describe('scrollBehavior', () => {
  beforeEach(() => restoreWhenStepReady.mockClear())

  it('restores the saved position of a booking step and re-applies it when the step uncovers', () => {
    const to = at('/reservar/negocio-ejemplo/servicios/s1/horario')
    const from = at(
      '/reservar/negocio-ejemplo/servicios/s1/profesional/p1/horario/2026-11-24T14:15:00Z/cliente',
    )
    expect(to.meta.bookingStep).toBeTruthy()
    const saved = { left: 0, top: 977 }
    expect(scrollBehavior(to, from, saved)).toEqual(saved)
    expect(restoreWhenStepReady).toHaveBeenCalledWith(saved)
  })

  it('restores other screens as before, without waiting for anything', () => {
    const to = at('/acceso')
    const from = at('/reservar/negocio-ejemplo')
    expect(scrollBehavior(to, from, { left: 0, top: 120 })).toEqual({ left: 0, top: 120 })
    expect(restoreWhenStepReady).not.toHaveBeenCalled()
  })

  it('starts a new screen at the top', () => {
    const to = at('/reservar/negocio-ejemplo/servicios/s1/horario')
    const from = at('/reservar/negocio-ejemplo')
    expect(scrollBehavior(to, from, null)).toEqual({ top: 0 })
    expect(restoreWhenStepReady).not.toHaveBeenCalled()
  })

  it('cancels a pending booking restore on every navigation', async () => {
    cancelStepScrollRestore.mockClear()
    await router.push('/acceso')
    expect(cancelStepScrollRestore).toHaveBeenCalled()
  })
})
