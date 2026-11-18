import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INITIAL_VOCABULARY } from './fixtures/vocabularioInicial'

/**
 * HU-105 (DEC-178): el cliente entra a su turno con un código de un solo uso, sin el
 * enlace del correo.
 *
 * Recorridos con el API simulado:
 * - desde la entrada pública, correo → código → paso 03 «Tu turno» con sus dos acciones, sin
 *   salir de la página (#647), y cancelar ahí mismo;
 * - celular con varios turnos: lista y elección;
 * - código incorrecto, reenvío con cuenta atrás y límite de solicitudes (429).
 *
 * Evidencia responsiva y accesible (estandar-diseno-visual.md §16) en 320/360/768/1280 px
 * y zoom 200 % aproximado: contacto, código, error, varios turnos y límite. Sin mockup
 * asignado (DEC-078). Las capturas van a `e2e/evidence/cliente-acceso-codigo/`.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'cliente-acceso-codigo')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

const SLUG = 'barberia-ejemplo'
const CHALLENGE_URL = `**/api/v1/public/businesses/${SLUG}/customer-access/challenge`
const VERIFY_URL = `**/api/v1/public/businesses/${SLUG}/customer-access/verify`
const PROFILE_URL = `**/api/v1/public/businesses/${SLUG}`

const TOKEN_A = '7kQ2mZ9xR4tW1vB8nC3pL6yH0sD5fG2jA9eU4iO7rT1'
const TOKEN_B = '3n9F1sQe2z8mM5wYtR7pL0oXhC4bV6dK1aE9jU2gN8i'
const APPOINTMENT_URL = (token: string) => `**/api/v1/customer/appointments/${token}`
const SLOTS_URL = (token: string) => `**/api/v1/customer/appointments/${token}/reschedule-slots`
const CANCEL_URL = (token: string) => `**/api/v1/customer/appointments/${token}/cancel`

const GOOD_CODE = '482913'

const ACCEPTED = { expiresInSeconds: 600, resendAfterSeconds: 60 }

const json = (route: Route, status: number, body: unknown, contentType = 'application/json') =>
  route.fulfill({ status, contentType, body: JSON.stringify(body) })

const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: `e2e-hu105-${code}`,
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

const ONE_APPOINTMENT = {
  timezone: 'America/Bogota',
  appointments: [
    {
      accessToken: TOKEN_A,
      startsAt: '2027-03-15T15:00:00Z',
      serviceName: 'Corte clásico',
      professionalName: 'Barbero Ejemplo',
    },
  ],
}

const TWO_APPOINTMENTS = {
  timezone: 'America/Bogota',
  appointments: [
    ...ONE_APPOINTMENT.appointments,
    {
      accessToken: TOKEN_B,
      startsAt: '2027-03-22T20:30:00Z',
      serviceName: 'Corte y barba',
      professionalName: 'Otra Barbera Ejemplo',
    },
  ],
}

async function mockBusinessProfile(page: Page) {
  await page.route(`${PROFILE_URL}/reviews`, (route) =>
    json(route, 200, { rating: null, ratingCount: 0, mapsUrl: null, reviews: [] }),
  )
  await page.route(PROFILE_URL, (route) =>
    json(route, 200, {
      name: 'Barbería Ejemplo',
      timezone: 'America/Bogota',
      contactEmail: null,
      contactPhone: null,
      brandAccent: 'brass',
      location: null,
      offersHomeService: false,
      vocabulary: INITIAL_VOCABULARY,
    }),
  )
}

async function mockTargetAppointment(page: Page, token: string) {
  await page.route(APPOINTMENT_URL(token), (route) => json(route, 200, APPOINTMENT_VIEW))
  await page.route(SLOTS_URL(token), (route) =>
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

async function sendContact(page: Page, contact: string) {
  await page.getByLabel('Correo o celular').fill(contact)
  await page.getByRole('button', { name: 'Enviarme el código' }).click()
}

test.use({ contextOptions: { reducedMotion: 'reduce' } })

test.describe('HU-105 · entrar al turno con un código', () => {
  test('desde la entrada pública: correo, código y el paso 03 con sus acciones', async ({
    page,
  }) => {
    await mockBusinessProfile(page)
    await mockTargetAppointment(page, TOKEN_A)
    let challengeBody: unknown = null
    let verifyBody: unknown = null
    await page.route(CHALLENGE_URL, async (route) => {
      challengeBody = route.request().postDataJSON()
      await json(route, 202, ACCEPTED)
    })
    await page.route(VERIFY_URL, async (route) => {
      verifyBody = route.request().postDataJSON()
      await json(route, 200, ONE_APPOINTMENT)
    })

    await page.goto(`/reservar/${SLUG}`)
    await page.getByRole('link', { name: 'Cámbialo aquí' }).click()
    await expect(page).toHaveURL(new RegExp(`/reservar/${SLUG}/mi-turno$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Encuentra tu turno' })).toBeFocused()

    await sendContact(page, 'Ana.Perez@Correo.Test')
    await expect(page.getByRole('heading', { level: 1, name: 'Escribe tu código' })).toBeVisible()
    // El contacto se muestra enmascarado y la pantalla no confirma que exista el turno.
    await expect(page.getByText('A•••@Correo.Test')).toBeVisible()
    await expect(page.getByText(/ana\.perez@/i)).toHaveCount(0)
    await expect(page.getByText(/tiene un turno, el código va en camino por correo/)).toBeVisible()
    // La primera casilla recibe el foco.
    await expect(
      page.getByRole('group', { name: 'Código de 6 dígitos' }).getByRole('textbox').first(),
    ).toBeFocused()

    await typeCode(page, GOOD_CODE)

    // Un solo turno abre el paso 03 en la misma página: el turno y sus dos acciones (#647).
    await expect(page.getByRole('heading', { level: 1, name: '¿Qué quieres hacer?' })).toBeFocused()
    await expect(page).toHaveURL(new RegExp(`/reservar/${SLUG}/mi-turno$`))
    await expect(page.getByText('Corte clásico con Barbero Ejemplo')).toBeVisible()
    await expect(page.getByRole('link', { name: /Cambiar la hora/ })).toHaveAttribute(
      'href',
      `/mi-turno/${TOKEN_A}/reprogramar`,
    )
    await expect(page.getByRole('button', { name: /Cancelar turno/ })).toBeVisible()
    expect(challengeBody).toEqual({ contact: 'Ana.Perez@Correo.Test' })
    expect(verifyBody).toEqual({ contact: 'Ana.Perez@Correo.Test', code: GOOD_CODE })
  })

  test('paso 03: cancelar ahí mismo, con la versión del turno', async ({ page }) => {
    await mockTargetAppointment(page, TOKEN_A)
    await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
    await page.route(VERIFY_URL, (route) => json(route, 200, ONE_APPOINTMENT))
    let ifMatch: string | undefined
    await page.route(CANCEL_URL(TOKEN_A), async (route) => {
      ifMatch = route.request().headers()['if-match']
      await json(route, 200, {})
    })

    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await sendContact(page, 'ana.perez@correo.test')
    await typeCode(page, GOOD_CODE)
    await page.getByRole('button', { name: /Cancelar turno/ }).click()
    await expect(page.getByRole('heading', { name: 'Cancelar turno' })).toBeFocused()
    await page.getByRole('button', { name: 'Mantener mi turno' }).click()
    await expect(page.getByRole('button', { name: /Cancelar turno/ })).toBeFocused()

    await page.getByRole('button', { name: /Cancelar turno/ }).click()
    await page.getByRole('button', { name: 'Sí, cancelar mi turno' }).click()
    await expect(page.getByText('Tu turno quedó cancelado')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Turno cancelado' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/reservar/${SLUG}/mi-turno$`))
    expect(ifMatch).toBe('version-token-1')
  })

  test('celular con varios turnos: lista y elección', async ({ page }) => {
    await mockTargetAppointment(page, TOKEN_B)
    await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
    await page.route(VERIFY_URL, (route) => json(route, 200, TWO_APPOINTMENTS))

    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await sendContact(page, '300 123 4567')
    await expect(
      page.getByText(/tiene un turno, el código va en camino por WhatsApp/),
    ).toBeVisible()
    await typeCode(page, GOOD_CODE)

    await expect(page.getByRole('heading', { level: 1, name: 'Elige tu turno' })).toBeFocused()
    const list = page.getByRole('list', { name: 'Tus turnos próximos' })
    await expect(list.getByRole('button')).toHaveCount(2)
    await expect(list.getByText('Corte clásico con Barbero Ejemplo')).toBeVisible()
    await expect(list.getByText('Corte y barba con Otra Barbera Ejemplo')).toBeVisible()

    await list.getByRole('button', { name: /Corte y barba/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: '¿Qué quieres hacer?' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/reservar/${SLUG}/mi-turno$`))
    await expect(page.getByRole('link', { name: /Cambiar la hora/ })).toHaveAttribute(
      'href',
      `/mi-turno/${TOKEN_B}/reprogramar`,
    )
    await page.getByRole('button', { name: '← Elegir otro turno' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Elige tu turno' })).toBeVisible()
  })

  test('código incorrecto: error uniforme, se limpia y se puede reintentar', async ({ page }) => {
    await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
    let attempts = 0
    await page.route(VERIFY_URL, (route) => {
      attempts += 1
      return json(route, 401, problem(401, 'unauthorized'), 'application/problem+json')
    })

    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await sendContact(page, 'ana@correo.test')
    await typeCode(page, '111111')

    await expect(
      page.getByRole('alert').filter({ hasText: 'no es válido o ya venció' }),
    ).toBeVisible()
    expect(attempts).toBe(1)
    // El código se borra y el foco vuelve a la primera casilla para reintentar.
    const slots = page.getByRole('group', { name: 'Código de 6 dígitos' }).getByRole('textbox')
    await expect(slots.first()).toHaveValue('')
    await expect(slots.first()).toBeFocused()
  })

  test('cinco códigos incorrectos: bloquea la entrada y ofrece pedir uno nuevo', async ({
    page,
  }) => {
    await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
    await page.route(VERIFY_URL, (route) =>
      json(route, 401, problem(401, 'unauthorized'), 'application/problem+json'),
    )

    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await sendContact(page, 'ana@correo.test')
    for (let i = 0; i < 5; i++) {
      await typeCode(page, `12345${i}`)
      await expect(page.getByRole('alert').first()).toBeVisible()
    }

    await expect(
      page.getByText('Ese código ya no sirve. Pide uno nuevo para seguir.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entrar a mi turno' })).toBeDisabled()
    // Con el código agotado no hace falta esperar la cuenta atrás.
    await expect(page.getByRole('button', { name: 'Pedir otro código' })).toBeVisible()
  })

  test('reenvío: cuenta atrás y un código nuevo', async ({ page }) => {
    await page.clock.install()
    let challenges = 0
    await page.route(CHALLENGE_URL, (route) => {
      challenges += 1
      return json(route, 202, ACCEPTED)
    })

    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await sendContact(page, 'ana@correo.test')
    await expect(page.getByText(/Podrás pedir otro en/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pedir otro código' })).toHaveCount(0)

    await page.clock.fastForward(61_000)
    await page.getByRole('button', { name: 'Pedir otro código' }).click()

    await expect(page.getByText('Te enviamos otro código por correo.')).toBeVisible()
    expect(challenges).toBe(2)
    await expect(page.getByText(/Podrás pedir otro en/)).toBeVisible()
  })

  test('límite de solicitudes: 429 se explica sin decir cuál límite', async ({ page }) => {
    await page.route(CHALLENGE_URL, (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/problem+json',
        headers: { 'Retry-After': '540' },
        body: JSON.stringify(problem(429, 'rate-limited')),
      }),
    )

    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await sendContact(page, 'ana@correo.test')

    await expect(
      page.getByText('Pediste demasiados códigos. Vuelve a intentarlo en 9 min.'),
    ).toBeVisible()
    // Se queda en el primer paso, con lo escrito conservado.
    await expect(page.getByLabel('Correo o celular')).toHaveValue('ana@correo.test')
  })

  test('contacto inválido y negocio inexistente', async ({ page }) => {
    await page.route(CHALLENGE_URL, (route) =>
      json(route, 422, problem(422, 'validation'), 'application/problem+json'),
    )
    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await sendContact(page, 'esto no es un contacto')
    await expect(page.getByText('Escribe un correo o un celular válido.')).toBeVisible()

    await page.unroute(CHALLENGE_URL)
    await page.route(CHALLENGE_URL, (route) =>
      json(route, 404, problem(404, 'not-found'), 'application/problem+json'),
    )
    await page.getByLabel('Correo o celular').fill('ana@correo.test')
    await page.getByRole('button', { name: 'Enviarme el código' }).click()
    await expect(page.getByText('No encontramos este enlace')).toBeVisible()
  })

  test('sin escribir nada no llama al servidor', async ({ page }) => {
    let calls = 0
    await page.route(CHALLENGE_URL, (route) => {
      calls += 1
      return json(route, 202, ACCEPTED)
    })
    await page.goto(`/reservar/${SLUG}/mi-turno`)
    await page.getByRole('button', { name: 'Enviarme el código' }).click()
    await expect(page.getByText('Escribe tu correo o tu celular.')).toBeVisible()
    expect(calls).toBe(0)
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
  test.describe(`Evidencia HU-105 ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test(`contacto (${viewport.name}px)`, async ({ page }) => {
      await page.goto(`/reservar/${SLUG}/mi-turno`)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Encuentra tu turno' }),
      ).toBeVisible()
      await capture(page, viewport.name, '1-contacto')
    })

    test(`contacto con error (${viewport.name}px)`, async ({ page }) => {
      await page.goto(`/reservar/${SLUG}/mi-turno`)
      await page.getByRole('button', { name: 'Enviarme el código' }).click()
      await expect(page.getByText('Escribe tu correo o tu celular.')).toBeVisible()
      await capture(page, viewport.name, '1-contacto-error')
    })

    test(`código (${viewport.name}px)`, async ({ page }) => {
      await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
      await page.goto(`/reservar/${SLUG}/mi-turno`)
      await sendContact(page, 'ana.perez@correo.test')
      await expect(page.getByRole('heading', { level: 1, name: 'Escribe tu código' })).toBeVisible()
      await capture(page, viewport.name, '2-codigo')
    })

    test(`código incorrecto (${viewport.name}px)`, async ({ page }) => {
      await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
      await page.route(VERIFY_URL, (route) =>
        json(route, 401, problem(401, 'unauthorized'), 'application/problem+json'),
      )
      await page.goto(`/reservar/${SLUG}/mi-turno`)
      await sendContact(page, '300 123 4567')
      await typeCode(page, '111111')
      await expect(page.getByText(/no es válido o ya venció/)).toBeVisible()
      await capture(page, viewport.name, '2-codigo-incorrecto')
    })

    test(`varios turnos (${viewport.name}px)`, async ({ page }) => {
      await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
      await page.route(VERIFY_URL, (route) => json(route, 200, TWO_APPOINTMENTS))
      await page.goto(`/reservar/${SLUG}/mi-turno`)
      await sendContact(page, 'ana.perez@correo.test')
      await typeCode(page, GOOD_CODE)
      await expect(page.getByRole('heading', { level: 1, name: 'Elige tu turno' })).toBeVisible()
      await capture(page, viewport.name, '3-varios-turnos')
    })

    test(`límite de solicitudes (${viewport.name}px)`, async ({ page }) => {
      await page.route(CHALLENGE_URL, (route) =>
        route.fulfill({
          status: 429,
          contentType: 'application/problem+json',
          headers: { 'Retry-After': '540' },
          body: JSON.stringify(problem(429, 'rate-limited')),
        }),
      )
      await page.goto(`/reservar/${SLUG}/mi-turno`)
      await sendContact(page, 'ana.perez@correo.test')
      await expect(page.getByText(/Pediste demasiados códigos/)).toBeVisible()
      await capture(page, viewport.name, '1-limite')
    })

    test(`paso 03 con sus acciones (${viewport.name}px)`, async ({ page }) => {
      await mockTargetAppointment(page, TOKEN_A)
      await page.route(CHALLENGE_URL, (route) => json(route, 202, ACCEPTED))
      await page.route(VERIFY_URL, (route) => json(route, 200, ONE_APPOINTMENT))
      await page.goto(`/reservar/${SLUG}/mi-turno`)
      await sendContact(page, 'ana.perez@correo.test')
      await typeCode(page, GOOD_CODE)
      await expect(page.getByRole('button', { name: /Cancelar turno/ })).toBeVisible()
      await capture(page, viewport.name, '4-acciones')

      await page.getByRole('button', { name: /Cancelar turno/ }).click()
      await expect(page.getByRole('button', { name: 'Sí, cancelar mi turno' })).toBeVisible()
      await capture(page, viewport.name, '5-cancelar')

      await page.route(CANCEL_URL(TOKEN_A), (route) => json(route, 200, {}))
      await page.getByRole('button', { name: 'Sí, cancelar mi turno' }).click()
      await expect(page.getByText('Tu turno quedó cancelado')).toBeVisible()
      await capture(page, viewport.name, '6-cancelado')
    })

    test(`entrada pública con el enlace (${viewport.name}px)`, async ({ page }) => {
      await mockBusinessProfile(page)
      await page.goto(`/reservar/${SLUG}`)
      await expect(page.getByRole('link', { name: 'Cámbialo aquí' })).toBeVisible()
      await capture(page, viewport.name, '0-entrada-publica')
    })
  })
}
