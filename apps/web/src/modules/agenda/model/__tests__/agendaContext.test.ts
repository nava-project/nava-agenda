/**
 * Lo que la Agenda recuerda entre entradas (#822): profesionales y zona, por
 * negocio, y olvidado tras cualquier escritura que pueda cambiarlos.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { MiddlewareCallbackParams } from 'openapi-fetch'
import {
  agendaContextInvalidation,
  forgetAgendaContext,
  knownAgendaContext,
  rememberAgendaContext,
} from '../agendaContext'

const CONTEXT = {
  professionals: [{ id: 'p-1', fullName: 'Ana Gómez' }],
  timezone: 'America/Bogota',
}

function respond(method: string, schemaPath: string, status = 200) {
  const onResponse = agendaContextInvalidation.onResponse!
  return onResponse({
    request: new Request('https://agenda.ejemplo.test/api/v1/x', { method }),
    response: new Response(null, { status }),
    schemaPath,
  } as MiddlewareCallbackParams & { response: Response })
}

describe('agendaContext', () => {
  beforeEach(() => forgetAgendaContext())

  it('gives back what was read only to the same business', () => {
    rememberAgendaContext('negocio-a', CONTEXT)
    expect(knownAgendaContext('negocio-a')).toEqual(CONTEXT)
    expect(knownAgendaContext('negocio-b')).toBeNull()
    expect(knownAgendaContext(null)).toBeNull()
  })

  it('remembers nothing without a business', () => {
    rememberAgendaContext('negocio-a', CONTEXT)
    rememberAgendaContext(null, CONTEXT)
    expect(knownAgendaContext('negocio-a')).toBeNull()
  })

  it.each([
    ['POST', '/private/professionals'],
    ['PATCH', '/private/professionals/{professionalId}'],
    ['PUT', '/private/professionals/{professionalId}/photo'],
    ['DELETE', '/private/professionals/{professionalId}/photo'],
    ['PUT', '/private/me/professional'],
    ['DELETE', '/private/me/professional'],
    ['PATCH', '/private/settings/business'],
  ])('forgets it after a successful %s %s', async (method, path) => {
    rememberAgendaContext('negocio-a', CONTEXT)
    await respond(method, path)
    expect(knownAgendaContext('negocio-a')).toBeNull()
  })

  it.each([
    ['GET', '/private/professionals', 200],
    ['PATCH', '/private/professionals/{professionalId}', 422],
    ['POST', '/private/appointments', 201],
    ['POST', '/private/services', 201],
  ])('keeps it after %s %s (%i)', async (method, path, status) => {
    rememberAgendaContext('negocio-a', CONTEXT)
    await respond(method, path, status)
    expect(knownAgendaContext('negocio-a')).toEqual(CONTEXT)
  })
})
