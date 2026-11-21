import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Sesión, datos y limpieza de los E2E de Horarios y festivos con el API real (#766).
 *
 * Datos: database/testdata/ui_horarios_766.sql (solo BD local de pruebas o CI). Dos
 * negocios sintéticos y un profesional fijo por spec y proyecto: escritorio y móvil
 * corren en paralelo y cada uno trabaja sobre el suyo, así que no se pisan.
 *
 * Sesión: una por cuenta y proyecto, guardada en .auth (ignorado por Git) y
 * reutilizada mientras siga vigente. Un inicio de sesión por prueba escalaba la
 * defensa de abuso de la IP local (HU-007).
 *
 * Limpieza: el fixture deja al profesional como lo encontró aunque la prueba falle
 * (corre en el desmontaje, con tiempo propio). Retira cada tramo y cada excepción
 * creados en la página y devuelve el calendario de festivos a su valor inicial.
 */

/** Contraseña ficticia, exclusiva de las cuentas de ui_horarios_766.sql. */
const PASSWORD = process.env.E2E_HORARIOS_PASSWORD ?? 'PruebaHorarios766!'
const ACCOUNTS = { a: 'horarios.766.1@ejemplo.test', b: 'horarios.766.2@ejemplo.test' } as const
type Tenant = keyof typeof ACCOUNTS

export type ScheduleSpec = 'horarios' | 'festivos'
type Professional = { id: string; name: string }

const PROFESSIONALS: Record<ScheduleSpec, Record<string, Professional>> = {
  horarios: {
    'chromium-desktop': {
      id: '766b0001-0000-4000-8000-000000000001',
      name: 'Horario de prueba escritorio',
    },
    'chromium-mobile': {
      id: '766b0001-0000-4000-8000-000000000002',
      name: 'Horario de prueba móvil',
    },
  },
  festivos: {
    'chromium-desktop': {
      id: '766b0001-0000-4000-8000-000000000003',
      name: 'Festivos de prueba escritorio',
    },
    'chromium-mobile': {
      id: '766b0001-0000-4000-8000-000000000004',
      name: 'Festivos de prueba móvil',
    },
  },
}

/** Profesional real del negocio B: el aislamiento (RN-TEN-01) lo consulta desde A. */
export const PROFESSIONAL_B = '766b0002-0000-4000-8000-000000000001'

const API = '/api/v1/private/professionals'

async function signIn(context: BrowserContext, tenant: Tenant, project: string) {
  const statePath = path.resolve(`.auth/horarios-766-${tenant}-${project}.json`)
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
    data: { email: ACCOUNTS[tenant], password: PASSWORD },
  })
  expect(response.status(), `inicio de sesión de ${ACCOUNTS[tenant]} (ui_horarios_766.sql)`).toBe(
    200,
  )
  mkdirSync(path.dirname(statePath), { recursive: true })
  await context.storageState({ path: statePath })
}

type Fixtures = {
  scheduleSpec: ScheduleSpec
  /** El profesional de esta spec y este proyecto, con la sesión del negocio A abierta. */
  professional: Professional
  /** Una página aparte con la sesión del negocio B. */
  pageB: Page
}

export const test = base.extend<Fixtures>({
  scheduleSpec: ['horarios', { option: true }],

  professional: [
    async ({ page, scheduleSpec }, use, testInfo) => {
      const professional = PROFESSIONALS[scheduleSpec][testInfo.project.name]
      if (!professional)
        throw new Error(`Sin profesional de #766 para el proyecto ${testInfo.project.name}`)
      await signIn(page.context(), 'a', testInfo.project.name)

      const created: string[] = []
      const reading: Promise<void>[] = []
      const holidayPath = `${API}/${professional.id}/holiday-calendar`
      let holidayChanged = false

      page.on('response', (response) => {
        const request = response.request()
        const { pathname } = new URL(response.url())
        if (
          request.method() === 'POST' &&
          response.status() === 201 &&
          /\/(working-hours|schedule-exceptions)$/.test(pathname)
        ) {
          reading.push(
            response
              .json()
              .then((body: { id?: string }) => {
                if (body?.id) created.push(`${pathname}/${body.id}`)
              })
              .catch(() => undefined),
          )
        }
      })
      page.on('request', (request) => {
        if (request.method() === 'PATCH' && new URL(request.url()).pathname === holidayPath)
          holidayChanged = true
      })

      // Valor inicial del calendario de festivos, para devolverlo al terminar.
      const initial = await page.request.get(holidayPath)
      expect(initial.status()).toBe(200)
      const holidayInitial = ((await initial.json()) as { enabled: boolean }).enabled

      await use(professional)

      await Promise.all(reading)
      for (const resource of created.reverse()) {
        const response = await page.request.delete(resource)
        expect([204, 404], `retirar ${resource}`).toContain(response.status())
      }
      if (holidayChanged) {
        const response = await page.request.patch(holidayPath, {
          data: { enabled: holidayInitial },
        })
        expect(response.status(), 'devolver el calendario de festivos').toBe(200)
      }
    },
    { timeout: 30_000 },
  ],

  pageB: async ({ browser, baseURL }, use, testInfo) => {
    const context = await browser.newContext({ baseURL })
    try {
      await signIn(context, 'b', testInfo.project.name)
      await use(await context.newPage())
    } finally {
      await context.close()
    }
  },
})

export { expect }

export async function openSchedules(page: Page) {
  await page.goto('/panel/horarios')
  await expect(page.getByRole('heading', { name: 'Horarios', level: 1 })).toBeVisible()
}
