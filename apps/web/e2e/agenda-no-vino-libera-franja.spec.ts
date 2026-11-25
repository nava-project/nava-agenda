import { test, expect, type BrowserContext } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { noVinoLiberaFranja, releaseIfConfirmed, startedNowFitsToday } from './no-vino-pasos'

/**
 * Recorrido E2E de #854 (DEC-193) con el API real: un turno que ya empezó se
 * marca «No vino» dentro de su franja, lo que queda de ella vuelve a estar libre,
 * y «Empezó ahora» (#852) registra ahí otro turno sin 409. Antes de DEC-193 el
 * segundo registro chocaba con la exclusión, porque el «No vino» ocupaba su
 * franja entera.
 *
 * Datos: database/testdata/ui_horarios_766.sql (negocio A y su cuenta) y
 * database/testdata/ui_no_show_854.sql (un profesional por proyecto con jornada
 * de 24 h y un servicio de 30 min), solo en la BD local de pruebas o en CI. En los
 * últimos 30 min antes de la medianoche del negocio el turno no cabe en la jornada
 * (422) y la prueba se salta con el motivo (startedNowFitsToday). Corre
 * contra el API local (`go run ./cmd/api`) con las migraciones al día; no forma
 * parte de los checks de CI, que solo corren `test:unit`.
 *
 * Pasos y aserciones: e2e/no-vino-pasos.ts, compartidos con la verificación en
 * el Chromium visible por CDP. Limpieza: todo turno que la prueba deje confirmado
 * se marca «No vino» al terminar, aunque falle (releaseIfConfirmed).
 */

/** Contraseña ficticia de la cuenta de ui_horarios_766.sql (ver horarios-sesion.ts). */
const PASSWORD = process.env.E2E_HORARIOS_PASSWORD ?? 'PruebaHorarios766!'
const EMAIL = 'horarios.766.1@ejemplo.test'
const PROFESSIONALS: Record<string, { id: string; name: string }> = {
  'chromium-desktop': {
    id: '854b0001-0000-4000-8000-000000000001',
    name: 'No vino de prueba escritorio',
  },
  'chromium-mobile': {
    id: '854b0001-0000-4000-8000-000000000002',
    name: 'No vino de prueba móvil',
  },
}

// Una sesión por proyecto, reutilizada mientras siga vigente: un inicio de sesión
// por prueba escala la defensa de abuso de la IP local (HU-007).
async function signIn(context: BrowserContext, project: string) {
  const statePath = path.resolve(`.auth/no-vino-854-${project}.json`)
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Awaited<
      ReturnType<BrowserContext['storageState']>
    >
    await context.addCookies(state.cookies)
    const session = await context.request.get('/api/v1/private/auth/session')
    if (session.status() === 200) return
    await context.clearCookies()
  }
  const response = await context.request.post('/api/v1/public/auth/login', {
    data: { email: EMAIL, password: PASSWORD },
  })
  expect(response.status(), `inicio de sesión de ${EMAIL} (ui_horarios_766.sql)`).toBe(200)
  mkdirSync(path.dirname(statePath), { recursive: true })
  await context.storageState({ path: statePath })
}

test('«No vino» dentro de la franja la libera y «Empezó ahora» la toma (#854)', async ({
  page,
  baseURL,
}, testInfo) => {
  const professional = PROFESSIONALS[testInfo.project.name]
  test.skip(!professional, `sin profesional de #854 para el proyecto ${testInfo.project.name}`)
  await signIn(page.context(), testInfo.project.name)
  const today = await startedNowFitsToday(page, baseURL!)
  test.skip(!today.fits, today.reason)

  const created: string[] = []
  try {
    await noVinoLiberaFranja(page, baseURL!, professional!, created)
  } finally {
    for (const id of created) await releaseIfConfirmed(page, baseURL!, id)
  }
})
