/**
 * Proveedores globales que viajan con la sesión (#822): lo que la Agenda
 * recuerda se olvida en cuanto la sesión deja de estar autenticada, y el
 * cliente HTTP lo invalida tras las escrituras que lo cambian.
 */
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const status = vi.hoisted(() => ({ value: null as unknown as ReturnType<typeof ref<string>> }))
const forgetAgendaContext = vi.hoisted(() => vi.fn())
const agendaContextInvalidation = vi.hoisted(() => ({ onResponse: vi.fn() }))
const use = vi.hoisted(() => vi.fn())

vi.mock('@/modules/auth', async () => {
  const { ref: vueRef } = await import('vue')
  status.value = vueRef('checking')
  return { installSessionHandling: vi.fn(), sessionStatus: status.value }
})
vi.mock('@/modules/agenda', () => ({ agendaContextInvalidation, forgetAgendaContext }))
vi.mock('@/modules/settings', () => ({ loadWorkspaceBrand: vi.fn() }))
vi.mock('@/shared/model', () => ({ resetBrand: vi.fn() }))
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { use } }))
vi.mock('@/app/router', () => ({ router: { install: vi.fn() } }))
vi.mock('@/App.vue', () => ({ default: { render: () => null } }))

const { createApplication } = await import('../createApp')

describe('createApplication', () => {
  it('installs the agenda invalidation and forgets the agenda context whenever the session is not authenticated', async () => {
    createApplication()
    expect(use).toHaveBeenCalledWith(agendaContextInvalidation)
    // Arranca comprobando: nada que recordar todavía.
    expect(forgetAgendaContext).toHaveBeenCalledTimes(1)

    status.value!.value = 'authenticated'
    await nextTick()
    expect(forgetAgendaContext).toHaveBeenCalledTimes(1)

    status.value!.value = 'unauthenticated'
    await nextTick()
    expect(forgetAgendaContext).toHaveBeenCalledTimes(2)

    // Entrar con otra cuenta pasa por «comprobando».
    status.value!.value = 'checking'
    await nextTick()
    expect(forgetAgendaContext).toHaveBeenCalledTimes(3)
  })
})
