import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INITIAL_VOCABULARY } from './fixtures/vocabularioInicial'

/**
 * HU-106 (DEC-179): el enlace que Odin entrega por WhatsApp abre directo en el código y lleva
 * a la cancelación en la misma página (cancelar, #647) o a «Cambiar la hora» (reprogramar).
 *
 * Recorridos con el API simulado: cancelar, reprogramar, código incorrecto con bloqueo a los
 * cinco intentos y enlace sin negocio. Evidencia responsiva y accesible (estandar-diseno-
 * visual.md §16) en 320/360/768/1280 px y zoom 200 % aproximado. Sin mockup asignado
 * (DEC-078). Las capturas van a `e2e/evidence/cliente-acceso-enlace/`.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'cliente-acceso-enlace')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

const SLUG = 'barberia-ejemplo'
const ACCESS_REF = '3vNq8Yt1KsM6wZc2HbJ9xRfE4uLaP7dG0iO5TnXyhBk'
const LINK = `/reservar/${SLUG}/mi-turno/${ACCESS_REF}`
const VERIFY_REF_URL = `**/api/v1/public/businesses/${SLUG}/customer-access/verify-ref`

const TOKEN = '7kQ2mZ9xR4tW1vB8nC3pL6yH0sD5fG2jA9eU4iO7rT1'
const APPOINTMENT_URL = `**/api/v1/customer/appointments/${TOKEN}`
const SLOTS_URL = `**/api/v1/customer/appointments/${TOKEN}/reschedule-slots`
const GOOD_CODE = '482913'

const json = (route: Route, status: number, body: unknown, contentType = 'application/json') =>
  route.fulfill({ status, contentType, body: JSON.stringify(body) })

const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: `e2e-hu106-${code}`,
})

const APPOINTMENT_VIEW = {
  businessName: 'Barbería Ejemplo',
  timezone: 'America/Bogota',
  attendeeName: 'Cliente Ejemplo',
  serviceName: 'Corte clásico',
  durationMinutes: 30,
  professionalName: 'Barbero Ejemplo',
  startsAt: '2027-03-15T15:00:00Z',
  endsAt: '2027-03-15T15:30:00Z',
  status: 'confirmed',
  cancellationDeadlineMinutes: 60,
  lateCancellationClientAllowed: false,
  lateCancellationReasonRequired: false,
  versionToken: 'version-token-1',
  businessContactEmail: 'contacto@barberia-ejemplo.test',
  businessContactPhone: '+573001234567',
  vocabulary: INITIAL_VOCABULARY,
  canReview: false,
  review: null,
  rescheduleRemaining: 2,
}

async function mockTargetAppointment(page: Page) {
  await page.route(APPOINTMENT_URL, (route) => json(route, 200, APPOINTMENT_VIEW))
  await page.route(SLOTS_URL, (route) =>
    json(route, 200, {
      timezone: 'America/Bogota',
      starts: ['2027-03-16T14:00:00Z', '2027-03-16T14:30:00Z', '2027-03-17T15:00:00Z'],
    }),
  )
}

/** Mismo criterio que mi-turno: color-contrast se verifica en la tabla aprobada del §4.3. */
async function assertNoAxeViolations(page: Page) {
  await page.addScriptTag({ path: axeScriptPath })
  const results = (await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axeGlobal = (window as any).axe
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

/** Escribe el código en las seis casillas, una por una (como con el teclado). */
async function typeCode(page: Page, code: string) {
  const slots = page.getByRole('group', { name: 'Código de 6 dígitos' }).getByRole('textbox')
  for (let i = 0; i < code.length; i++) await slots.nth(i).fill(code[i]!)
}

test.use({ contextOptions: { reducedMotion: 'reduce' } })

test.describe('HU-106 · el enlace de Odin', () => {
  test('abre directo en el código, sin pedir el contacto', async ({ page }) => {
    await page.goto(LINK)

    await expect(page.getByRole('heading', { level: 1, name: 'Escribe tu código' })).toBeFocused()
    await expect(page.getByText('Te enviamos allí un código de 6 dígitos')).toBeVisible()
    await expect(page.getByLabel('Correo o celular')).toHaveCount(0)
    // DEC-181: el contacto ya lo resolvió Odin; el paso actual es el 02.
    const steps = page.getByRole('list', { name: 'Pasos para entrar a tu turno' })
    await expect(steps.getByRole('listitem')).toHaveCount(3)
    await expect(steps.locator('[aria-current="step"]')).toContainText('Código')
    // La referencia viaja en la ruta pero nunca se pinta en la pantalla.
    await expect(page.getByText(ACCESS_REF)).toHaveCount(0)
  })

  test('elegir (manage): el código abre el paso 03 con las dos opciones', async ({ page }) => {
    await mockTargetAppointment(page)
    await page.route(VERIFY_REF_URL, (route) =>
      json(route, 200, { accessToken: TOKEN, purpose: 'manage' }),
    )

    await page.goto(LINK)
    await typeCode(page, GOOD_CODE)

    await expect(page.getByRole('heading', { level: 1, name: '¿Qué quieres hacer?' })).toBeFocused()
    await expect(page).toHaveURL(new RegExp(`/reservar/${SLUG}/mi-turno/${ACCESS_REF}$`))
    await expect(page.getByRole('link', { name: /Cambiar la hora/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Cancelar turno/ })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Código de 6 dígitos' })).toHaveCount(0)

    // Cancelar desde aquí abre la confirmación sin salir de la página.
    await page.getByRole('button', { name: /Cancelar turno/ }).click()
    await expect(page.getByRole('button', { name: 'Sí, cancelar mi turno' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/reservar/${SLUG}/mi-turno/${ACCESS_REF}$`))
  })

  test('cancelar: el código abre la cancelación en la misma página', async ({ page }) => {
    await mockTargetAppointment(page)
    let body: unknown = null
    await page.route(VERIFY_REF_URL, async (route) => {
      body = route.request().postDataJSON()
      await json(route, 200, { accessToken: TOKEN, purpose: 'cancel' })
    })

    await page.goto(LINK)
    await typeCode(page, GOOD_CODE)

    await expect(page.getByRole('heading', { name: 'Cancelar turno' })).toBeFocused()
    await expect(page.getByRole('heading', { level: 1, name: 'Cancelar tu turno' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/reservar/${SLUG}/mi-turno/${ACCESS_REF}$`))
    // El código ya se gastó: no vuelve a pedirse.
    await expect(page.getByRole('group', { name: 'Código de 6 dígitos' })).toHaveCount(0)
    expect(body).toEqual({ accessRef: ACCESS_REF, code: GOOD_CODE })

    // «Mantener mi turno» vuelve a las opciones, donde también está cambiar la hora.
    await page.getByRole('button', { name: 'Mantener mi turno' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '¿Qué quieres hacer?' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Cambiar la hora/ })).toBeVisible()
  })

  test('reprogramar: el código lleva a «Cambiar la hora»', async ({ page }) => {
    await mockTargetAppointment(page)
    await page.route(VERIFY_REF_URL, (route) =>
      json(route, 200, { accessToken: TOKEN, purpose: 'reschedule' }),
    )

    await page.goto(LINK)
    await typeCode(page, GOOD_CODE)

    await expect(page).toHaveURL(new RegExp(`/mi-turno/${TOKEN}/reprogramar$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Cambiar la hora' })).toBeVisible()
    await expect(page.getByRole('banner')).toContainText('Barbería Ejemplo')
  })

  test('código incorrecto: error uniforme, se limpia y a los cinco se bloquea', async ({
    page,
  }) => {
    let calls = 0
    await page.route(VERIFY_REF_URL, (route) => {
      calls += 1
      return json(route, 401, problem(401, 'unauthorized'), 'application/problem+json')
    })
    await page.goto(LINK)

    await typeCode(page, '111111')
    await expect(page.getByText(/no es válido o ya venció/)).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Código de 6 dígitos' }).getByRole('textbox').first(),
    ).toHaveValue('')

    for (let i = 0; i < 4; i++) await typeCode(page, '111111')
    await expect(page.getByText(/Ese código ya no sirve/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    expect(calls).toBe(5)
  })

  test('enlace sin negocio: estado propio', async ({ page }) => {
    await page.route(VERIFY_REF_URL, (route) =>
      json(route, 404, problem(404, 'not-found'), 'application/problem+json'),
    )
    await page.goto(LINK)
    await typeCode(page, GOOD_CODE)
    await expect(page.getByText('No encontramos este enlace')).toBeVisible()
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

async function capture(page: Page, viewportName: string, file: string) {
  await expectNoHorizontalScroll(page)
  await page.screenshot({
    path: path.join(evidenceDir, viewportName, `${file}.png`),
    fullPage: true,
  })
  await assertNoAxeViolations(page)
}

for (const viewport of viewports) {
  test.describe(`Evidencia HU-106 ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test(`código (${viewport.name}px)`, async ({ page }) => {
      await page.goto(LINK)
      await expect(page.getByRole('heading', { level: 1, name: 'Escribe tu código' })).toBeVisible()
      await capture(page, viewport.name, '1-codigo')
    })

    test(`código incorrecto (${viewport.name}px)`, async ({ page }) => {
      await page.route(VERIFY_REF_URL, (route) =>
        json(route, 401, problem(401, 'unauthorized'), 'application/problem+json'),
      )
      await page.goto(LINK)
      await typeCode(page, '111111')
      await expect(page.getByText(/no es válido o ya venció/)).toBeVisible()
      await capture(page, viewport.name, '2-codigo-incorrecto')
    })

    test(`bloqueado tras cinco intentos (${viewport.name}px)`, async ({ page }) => {
      await page.route(VERIFY_REF_URL, (route) =>
        json(route, 401, problem(401, 'unauthorized'), 'application/problem+json'),
      )
      await page.goto(LINK)
      for (let i = 0; i < 5; i++) await typeCode(page, '111111')
      await expect(page.getByText(/Ese código ya no sirve/)).toBeVisible()
      await capture(page, viewport.name, '3-bloqueado')
    })

    test(`paso 03 con las dos opciones (${viewport.name}px)`, async ({ page }) => {
      await mockTargetAppointment(page)
      await page.route(VERIFY_REF_URL, (route) =>
        json(route, 200, { accessToken: TOKEN, purpose: 'manage' }),
      )
      await page.goto(LINK)
      await typeCode(page, GOOD_CODE)
      await expect(page.getByRole('link', { name: /Cambiar la hora/ })).toBeVisible()
      await capture(page, viewport.name, '7-opciones')
    })

    test(`cancelación a la vista (${viewport.name}px)`, async ({ page }) => {
      await mockTargetAppointment(page)
      await page.route(VERIFY_REF_URL, (route) =>
        json(route, 200, { accessToken: TOKEN, purpose: 'cancel' }),
      )
      await page.goto(LINK)
      await typeCode(page, GOOD_CODE)
      await expect(page.getByRole('heading', { name: 'Cancelar turno' })).toBeFocused()
      await capture(page, viewport.name, '4-cancelar')

      await page.route(`**/api/v1/customer/appointments/${TOKEN}/cancel`, (route) =>
        json(route, 200, {}),
      )
      await page.getByRole('button', { name: 'Sí, cancelar mi turno' }).click()
      await expect(page.getByText('Tu turno quedó cancelado')).toBeVisible()
      await capture(page, viewport.name, '6-cancelado')
    })

    test(`enlace sin negocio (${viewport.name}px)`, async ({ page }) => {
      await page.route(VERIFY_REF_URL, (route) =>
        json(route, 404, problem(404, 'not-found'), 'application/problem+json'),
      )
      await page.goto(LINK)
      await typeCode(page, GOOD_CODE)
      await expect(page.getByText('No encontramos este enlace')).toBeVisible()
      await capture(page, viewport.name, '5-sin-barberia')
    })
  })
}
