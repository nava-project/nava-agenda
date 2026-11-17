import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INITIAL_VOCABULARY } from './fixtures/vocabularioInicial'

/**
 * HU-104 (DEC-178): el cliente cambia la hora de su turno desde el enlace.
 *
 * Recorridos con el API simulado:
 * - de «Mi turno» a «Cambiar la hora», elegir con el teclado, confirmar y volver;
 * - la hora elegida se ocupa: se recargan las franjas y se avisa;
 * - el servidor rechaza por límite: se explica y se ofrece el contacto.
 *
 * Evidencia responsiva y accesible (estandar-diseno-visual.md §16) en
 * 320/360/768/1280 px y zoom 200 % aproximado: selector con hora elegida, hora
 * cambiada y cambio no disponible. Sin mockup asignado (DEC-078). Las capturas
 * van a `e2e/evidence/cliente-reprogramacion/`.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'cliente-reprogramacion')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

const TOKEN = '7kQ2mZ9xR4tW1vB8nC3pL6yH0sD5fG2jA9eU4iO7rT1'
const APPOINTMENT_URL = `**/api/v1/customer/appointments/${TOKEN}`
const SLOTS_URL = `**/api/v1/customer/appointments/${TOKEN}/reschedule-slots`
const RESCHEDULE_URL = `**/api/v1/customer/appointments/${TOKEN}/reschedule`

// Lunes 15 de marzo de 2027, 10:00 en Bogotá; plazo de 60 minutos.
const APPOINTMENT_VIEW = {
  barbershopName: 'Barbería Ejemplo',
  timezone: 'America/Bogota',
  attendeeName: 'Cliente Ejemplo',
  serviceName: 'Corte clásico',
  durationMinutes: 30,
  barberName: 'Barbero Ejemplo',
  startsAt: '2027-03-15T15:00:00Z',
  endsAt: '2027-03-15T15:30:00Z',
  status: 'confirmed',
  cancellationDeadlineMinutes: 60,
  lateCancellationClientAllowed: false,
  lateCancellationReasonRequired: false,
  versionToken: 'version-token-1',
  barbershopContactEmail: 'contacto@barberia-ejemplo.test',
  barbershopContactPhone: '+573001234567',
  vocabulary: INITIAL_VOCABULARY,
  canReview: false,
  review: null,
  rescheduleRemaining: 2,
}

// Cinco días hábiles con horas cada media hora en la mañana y la tarde.
function buildStarts(): string[] {
  const starts: string[] = []
  for (const day of ['15', '16', '17', '18', '19']) {
    for (const hourUtc of [14, 15, 16, 19, 20, 21, 22]) {
      for (const minute of ['00', '30']) {
        starts.push(`2027-03-${day}T${hourUtc}:${minute}:00Z`)
      }
    }
  }
  return starts
}
const STARTS = buildStarts()

const json = (route: Route, status: number, body: unknown, contentType = 'application/json') =>
  route.fulfill({ status, contentType, body: JSON.stringify(body) })

const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: `e2e-hu104-${code}`,
})

async function mockReads(
  page: Page,
  options: { appointment?: Record<string, unknown>; starts?: () => string[] } = {},
) {
  await page.route(APPOINTMENT_URL, (route) =>
    json(route, 200, { ...APPOINTMENT_VIEW, ...options.appointment }),
  )
  await page.route(SLOTS_URL, (route) =>
    json(route, 200, { timezone: 'America/Bogota', starts: (options.starts ?? (() => STARTS))() }),
  )
}

async function assertNoAxeViolations(page: Page) {
  await page.addScriptTag({ path: axeScriptPath })
  const results = (await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axeGlobal = (window as any).axe
    // color-contrast se desactiva: la paleta ya está verificada en la tabla
    // aprobada de estandar-diseno-visual.md §4.3 (mismo criterio que mi-turno).
    return axeGlobal.run(document, { rules: { 'color-contrast': { enabled: false } } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as { violations: any[] }
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
}

test.use({ contextOptions: { reducedMotion: 'reduce' } })

test.describe('HU-104 · cambiar la hora del turno', () => {
  test('desde «Mi turno» cambia la hora con el teclado y vuelve al turno', async ({ page }) => {
    await mockReads(page)
    let sent: { headers: Record<string, string>; body: unknown } | null = null
    await page.route(RESCHEDULE_URL, async (route) => {
      sent = { headers: route.request().headers(), body: route.request().postDataJSON() }
      await json(route, 200, { startsAt: '2027-03-16T14:30:00Z', endsAt: '2027-03-16T15:00:00Z' })
    })

    await page.goto(`/mi-turno/${TOKEN}`)
    const entry = page.getByRole('link', { name: /Cambiar la hora/ })
    await expect(entry).toContainText('Puedes cambiarla hasta 2 veces')
    await entry.click()
    await expect(page).toHaveURL(new RegExp(`/mi-turno/${TOKEN}/reprogramar$`))

    await page.getByRole('button', { name: /martes, 16 de marzo/ }).click()
    const group = page.getByRole('radiogroup')
    await page.getByRole('radio', { name: /^9:00\sa/ }).focus()
    await group.press('ArrowRight')
    await expect(page.getByRole('radio', { name: /^9:30\sa/ })).toBeFocused()
    await group.press('Enter')
    await expect(page.getByRole('radio', { name: /^9:30\sa/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await page.getByRole('button', { name: /^Cambiar a mar 16, 9:30/ }).click()
    await expect(page.getByText(/Listo\. Tu turno quedó para el martes, 16 de marzo/)).toBeVisible()
    expect(sent).not.toBeNull()
    expect(sent!.headers['if-match']).toBe('version-token-1')
    expect(sent!.headers['idempotency-key']).toBeTruthy()
    expect(sent!.body).toEqual({ startsAt: '2027-03-16T14:30:00Z' })

    await page.getByRole('link', { name: 'Ver mi turno' }).click()
    await expect(page).toHaveURL(new RegExp(`/mi-turno/${TOKEN}$`))
  })

  test('si la hora se ocupa, recarga las franjas del mismo día y avisa', async ({ page }) => {
    let taken = false
    await mockReads(page, {
      starts: () => (taken ? STARTS.filter((s) => s !== '2027-03-17T15:00:00Z') : STARTS),
    })
    await page.route(RESCHEDULE_URL, async (route) => {
      taken = true
      await json(route, 409, problem(409, 'slot-conflict'), 'application/problem+json')
    })

    await page.goto(`/mi-turno/${TOKEN}/reprogramar`)
    await page.getByRole('button', { name: /miércoles, 17 de marzo/ }).click()
    await page.getByRole('radio', { name: /^10:00\sa/ }).click()
    await page.getByRole('button', { name: /^Cambiar a/ }).click()

    await expect(page.getByText('Esa hora se acaba de ocupar')).toBeVisible()
    await expect(page.getByRole('button', { name: /miércoles, 17 de marzo/ })).toHaveAttribute(
      'aria-current',
      'date',
    )
    await expect(page.getByRole('radio', { name: /^10:00\sa/ })).toHaveCount(0)
  })

  test('si el servidor dice que ya no quedan cambios, lo explica con el contacto', async ({
    page,
  }) => {
    await mockReads(page)
    await page.route(RESCHEDULE_URL, (route) =>
      json(route, 422, problem(422, 'reschedule-limit-reached'), 'application/problem+json'),
    )

    await page.goto(`/mi-turno/${TOKEN}/reprogramar`)
    await page.getByRole('radio', { name: /^11:00\sa/ }).click()
    await page.getByRole('button', { name: /^Cambiar a/ }).click()

    await expect(page.getByText('Ya usaste los cambios de este turno')).toBeVisible()
    await expect(page.getByRole('radiogroup')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '+573001234567' })).toBeVisible()
  })
})

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
  // Aproximación de zoom 200 % sobre 1280: mitad de ancho.
  { name: '1280-zoom200', width: 640, height: 450 },
]

for (const viewport of viewports) {
  test.describe(`Evidencia HU-104 ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test(`selector con hora elegida (${viewport.name}px)`, async ({ page }) => {
      await mockReads(page)
      await page.goto(`/mi-turno/${TOKEN}/reprogramar`)
      await page.getByRole('button', { name: /martes, 16 de marzo/ }).click()
      await page.getByRole('radio', { name: /^9:30\sa/ }).click()
      await expect(page.getByRole('button', { name: /^Cambiar a mar 16/ })).toBeEnabled()

      await expectNoHorizontalScroll(page)
      await page.screenshot({ path: path.join(evidenceDir, viewport.name, 'selector.png') })
      await page.screenshot({
        path: path.join(evidenceDir, viewport.name, 'selector-completo.png'),
        fullPage: true,
      })
      await assertNoAxeViolations(page)
    })

    test(`hora cambiada (${viewport.name}px)`, async ({ page }) => {
      await mockReads(page)
      await page.route(RESCHEDULE_URL, (route) =>
        json(route, 200, { startsAt: '2027-03-16T14:30:00Z', endsAt: '2027-03-16T15:00:00Z' }),
      )
      await page.goto(`/mi-turno/${TOKEN}/reprogramar`)
      await page.getByRole('button', { name: /martes, 16 de marzo/ }).click()
      await page.getByRole('radio', { name: /^9:30\sa/ }).click()
      await page.getByRole('button', { name: /^Cambiar a/ }).click()
      await expect(page.getByText(/Listo\. Tu turno quedó para el/)).toBeVisible()

      await expectNoHorizontalScroll(page)
      await page.screenshot({
        path: path.join(evidenceDir, viewport.name, 'hora-cambiada.png'),
        fullPage: true,
      })
      await assertNoAxeViolations(page)
    })

    test(`entrada desde «Mi turno» (${viewport.name}px)`, async ({ page }) => {
      await mockReads(page)
      await page.goto(`/mi-turno/${TOKEN}`)
      const entry = page.getByRole('link', { name: /Cambiar la hora/ })
      await expect(entry).toBeVisible()

      await expectNoHorizontalScroll(page)
      await page.screenshot({
        path: path.join(evidenceDir, viewport.name, 'entrada-mi-turno.png'),
        fullPage: true,
      })
      await assertNoAxeViolations(page)
    })

    test(`cambio no disponible (${viewport.name}px)`, async ({ page }) => {
      await mockReads(page, { appointment: { rescheduleRemaining: 0 } })
      await page.goto(`/mi-turno/${TOKEN}/reprogramar`)
      await expect(page.getByText('Ya usaste los cambios de este turno')).toBeVisible()

      await expectNoHorizontalScroll(page)
      await page.screenshot({
        path: path.join(evidenceDir, viewport.name, 'sin-cambios.png'),
        fullPage: true,
      })
      await assertNoAxeViolations(page)
    })
  })
}
