import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INITIAL_VOCABULARY } from './fixtures/vocabularioInicial'

/**
 * Servicio a domicilio en la reserva pública (HU-103, DEC-131, DEC-138, DEC-155). Respuestas simuladas del
 * API: la regla de «el interruptor de la barbería manda» (422), el CHECK de todo-o-nada y el
 * aislamiento entre barberías los cubren las pruebas Go y SQL con PostgreSQL real. Aquí se
 * recorre lo visible:
 *  1. sin el interruptor encendido no aparece la modalidad;
 *  2. con él, el cliente elige «A domicilio» y marca su ubicación (obligatorio) moviendo el mapa o
 *     con la posición del dispositivo (el mapa es el simulado de desarrollo: Vite corre en modo dev
 *     sin clave). Al elegir «A domicilio» se intenta detectar la posición sola; el botón «Usar mi
 *     ubicación» la repite. Un campo opcional recoge los detalles (torre, apartamento, referencia);
 *  3. sin ubicación marcada no se puede revisar; lo enviado antepone los detalles al texto de la
 *     dirección y lleva las coordenadas; una posición aproximada solo centra el mapa; si se niega
 *     el permiso se explica y se puede marcar en el mapa; en el local no se envía dirección.
 * En 320/360/768/1280 px, sin scroll horizontal y con axe-core. Evidencia en
 * e2e/evidence/domicilio-reserva-publica/.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'domicilio-reserva-publica')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

// Sin esto axe mide fotogramas a medio fundir y da falsos fallos de contraste.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const SLUG = 'barberia-ejemplo'
const SERVICE_ID = '8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4'
const BARBER_ID = 'a1111111-1111-1111-1111-111111111111'
// Una franja siempre futura: la pantalla descarta un `startsAt` que ya pasó (F-RQ-02, #436), así que
// una fecha fija dejaría de funcionar el día que se cumple.
const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
start.setUTCHours(14, 30, 0, 0)
const STARTS_AT = start.toISOString().replace('.000Z', 'Z')
const ENDS_AT = new Date(start.getTime() + 30 * 60 * 1000).toISOString().replace('.000Z', 'Z')
const ROUTE = `/reservar/${SLUG}/servicios/${SERVICE_ID}/barbero/${BARBER_ID}/horario/${encodeURIComponent(STARTS_AT)}/cliente`

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
] as const

interface ConfirmBody {
  homeService?: { address: string; latitude: number; longitude: number } | null
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

/** Instala el API simulado y devuelve los cuerpos que recibió la confirmación. */
async function installApi(page: Page, offersHomeService: boolean): Promise<ConfirmBody[]> {
  const confirmations: ConfirmBody[] = []

  await page.route(`**/api/v1/public/businesses/${SLUG}`, (route) =>
    route.fulfill(
      json({
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: INITIAL_VOCABULARY,
        location: null,
        offersHomeService,
      }),
    ),
  )
  await page.route(
    `**/api/v1/public/businesses/${SLUG}/services/${SERVICE_ID}/professionals`,
    (route) =>
      route.fulfill(
        json({
          items: [
            {
              id: BARBER_ID,
              fullName: 'Mateo Cruz',
              description: null,
              photoUpdatedAt: null,
              rating: null,
              ratingCount: 0,
            },
          ],
        }),
      ),
  )
  await page.route(
    `**/api/v1/public/businesses/${SLUG}/services/${SERVICE_ID}/professionals/${BARBER_ID}/appointments`,
    async (route) => {
      confirmations.push(route.request().postDataJSON() as ConfirmBody)
      await route.fulfill(
        json(
          {
            attendeeName: 'Ana Ríos',
            businessName: 'Barbería Ejemplo',
            serviceName: 'Corte clásico',
            durationMinutes: 30,
            priceAmount: '20000.00',
            currency: 'COP',
            startsAt: STARTS_AT,
            endsAt: ENDS_AT,
            timezone: 'America/Bogota',
            accessToken: '3n9F1sQe2z8mM5wYtR7pL0oXhC4bV6dK1aE9jU2gN8i',
            customerNote: null,
          },
          201,
        ),
      )
    },
  )
  return confirmations
}

async function expectAccessibleWithoutOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  await page.addScriptTag({ path: axeScriptPath })
  const violations = await page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: unknown[] }> }
      }
    ).axe.run(document, { iframes: false })
    return result.violations
  })
  expect(violations).toEqual([])
}

async function fillCustomer(page: Page) {
  await page.getByLabel('Tu nombre').fill('Ana Ríos')
  await page.getByLabel('Teléfono').fill('+573001234567')
  await page.getByLabel('Correo').fill('ana@example.com')
}

test('sin el interruptor encendido no se ofrece «a domicilio»', async ({ page }) => {
  await installApi(page, false)
  await page.goto(ROUTE)

  await expect(page.getByLabel('Tu nombre')).toBeVisible()
  await expect(page.getByText('¿Dónde te atendemos?')).toHaveCount(0)
  await expect(page.getByLabel('A domicilio')).toHaveCount(0)
})

test('exige marcar la ubicación: los detalles escritos no son una ubicación', async ({ page }) => {
  await installApi(page, true)
  await page.goto(ROUTE)

  await fillCustomer(page)
  await page.getByLabel('A domicilio').check()
  await expect(page.getByRole('combobox', { name: /Busca tu dirección/ })).toHaveCount(0)
  await page.getByLabel('Detalles de la dirección (opcional)').fill('Torre 2, apto 304')
  await page.getByRole('button', { name: 'Ver resumen' }).click()

  await expect(
    page.getByText(
      'Marca tu ubicación en el mapa o usa el botón «Usar mi ubicación» para continuar.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar turno' })).toHaveCount(0)
})

test('marca la ubicación moviendo el mapa y antepone los detalles a la dirección', async ({
  page,
}) => {
  const confirmations = await installApi(page, true)
  await page.goto(ROUTE)

  await fillCustomer(page)
  await page.getByLabel('A domicilio').check()
  await page.getByRole('button', { name: 'Mover el mapa al norte' }).click()
  await page.getByRole('button', { name: 'Mover el mapa al este' }).click()
  await expect(page.getByText('Ubicación marcada:')).toBeVisible()
  await page.getByLabel('Detalles de la dirección (opcional)').fill('  Torre 2,  apto 304 ')

  await page.getByRole('button', { name: 'Ver resumen' }).click()
  await expect(page.getByText('Te atendemos en')).toBeVisible()
  await expect(page.getByText('Torre 2, apto 304 · Punto marcado cerca de')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar turno' }).click()

  await expect(page.getByText('¡Tu turno quedó confirmado!')).toBeVisible()
  expect(confirmations).toHaveLength(1)
  const home = confirmations[0]!.homeService!
  expect(home.latitude).toBeCloseTo(4.712, 6)
  expect(home.longitude).toBeCloseTo(-74.0711, 6)
  expect(home.address).toBe('Torre 2, apto 304 · Punto marcado cerca de 4.7120, -74.0711')
})

test.describe('detección de la posición del dispositivo (DEC-155)', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 4.5701, longitude: -74.1102, accuracy: 15 },
  })

  test('al elegir «A domicilio» detecta la posición sola y la deja marcada', async ({ page }) => {
    // Cuenta las peticiones de ubicación: ninguna antes de elegir «A domicilio».
    await page.addInitScript(() => {
      const w = window as unknown as { __geoAsks: number }
      w.__geoAsks = 0
      const geo = navigator.geolocation
      for (const name of ['getCurrentPosition', 'watchPosition'] as const) {
        const original = geo[name].bind(geo) as (...args: unknown[]) => unknown
        ;(geo as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
          w.__geoAsks++
          return original(...args)
        }
      }
    })
    const confirmations = await installApi(page, true)
    await page.goto(ROUTE)

    await fillCustomer(page)
    const asks = () => page.evaluate(() => (window as unknown as { __geoAsks: number }).__geoAsks)
    expect(await asks()).toBe(0)

    await page.getByLabel('A domicilio').check()
    await expect(page.getByText('Ubicamos tu posición. Ajusta el pin si hace falta.')).toBeVisible()
    await expect(page.getByText('Ubicación marcada:')).toBeVisible()
    expect(await asks()).toBeGreaterThan(0)

    await page.getByLabel('Detalles de la dirección (opcional)').fill('Casa azul, portón negro')
    await page.getByRole('button', { name: 'Ver resumen' }).click()
    await page.getByRole('button', { name: 'Confirmar turno' }).click()
    await expect(page.getByText('¡Tu turno quedó confirmado!')).toBeVisible()
    expect(confirmations[0]!.homeService).toMatchObject({ latitude: 4.5701, longitude: -74.1102 })
    expect(confirmations[0]!.homeService!.address.startsWith('Casa azul, portón negro · ')).toBe(
      true,
    )
  })

  test('el botón «Usar mi ubicación» repite la detección', async ({ page }) => {
    await installApi(page, true)
    await page.goto(ROUTE)

    await fillCustomer(page)
    await page.getByLabel('A domicilio').check()
    await expect(page.getByText('Ubicación marcada:')).toBeVisible()
    await page.getByRole('button', { name: 'Mover el mapa al sur' }).click()
    await page.getByRole('button', { name: 'Usar mi ubicación' }).click()
    await expect(page.getByText('Ubicamos tu posición. Ajusta el pin si hace falta.')).toBeVisible()
  })
})

test.describe('posición aproximada (DEC-155)', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 4.5701, longitude: -74.1102, accuracy: 900 },
  })

  test('una lectura de unos 900 m solo centra el mapa: hay que marcar el punto', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await installApi(page, true)
    await page.goto(ROUTE)

    await fillCustomer(page)
    await page.getByLabel('A domicilio').check()
    // Se espera el tiempo de afinar la lectura (8 s) antes de entregar la mejor que hubo.
    await expect(page.getByText(/Tu ubicación es aproximada \(unos \d+ m\)/)).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('Ubicación marcada:')).toHaveCount(0)

    await page.getByRole('button', { name: 'Ver resumen' }).click()
    await expect(
      page.getByText(
        'Marca tu ubicación en el mapa o usa el botón «Usar mi ubicación» para continuar.',
      ),
    ).toBeVisible()
  })
})

test('si se niega el permiso de ubicación se explica y se puede marcar en el mapa', async ({
  page,
}) => {
  // Firefox deja la petición colgada sin conceder el permiso en vez de negarla: se simula la
  // negativa del usuario (código 1, PERMISSION_DENIED) para que la prueba sea la misma en todos.
  await page.addInitScript(() => {
    const denied = (_ok: unknown, fail?: (error: { code: number }) => void) => {
      fail?.({ code: 1 })
      return 1
    }
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: denied, watchPosition: denied, clearWatch: () => {} },
      configurable: true,
    })
  })
  await installApi(page, true)
  await page.goto(ROUTE)

  await fillCustomer(page)
  await page.getByLabel('A domicilio').check()
  await expect(page.getByText('No tenemos permiso para ver tu ubicación')).toBeVisible()
  await expect(page.getByText('Ubicación marcada:')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Usar mi ubicación' })).toBeVisible()

  await page.getByRole('button', { name: 'Mover el mapa al sur' }).click()
  await expect(page.getByText('Ubicación marcada:')).toBeVisible()
})

test('en el local no se envía ninguna dirección', async ({ page }) => {
  const confirmations = await installApi(page, true)
  await page.goto(ROUTE)

  await fillCustomer(page)
  await expect(page.getByLabel('En el local')).toBeChecked()
  await page.getByRole('button', { name: 'Ver resumen' }).click()
  await page.getByRole('button', { name: 'Confirmar turno' }).click()

  await expect(page.getByText('¡Tu turno quedó confirmado!')).toBeVisible()
  expect(confirmations).toHaveLength(1)
  expect(confirmations[0]!.homeService ?? null).toBeNull()
})

for (const viewport of viewports) {
  test(`el cliente reserva a domicilio marcando su ubicación a ${viewport.name} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const confirmations = await installApi(page, true)
    await page.goto(ROUTE)

    await expect(page.getByText('¿Dónde te atendemos?')).toBeVisible()
    await page.getByLabel('A domicilio').check()
    // Ya no hay buscador de dirección: el mapa y los detalles son lo único de la sección.
    await expect(page.getByRole('combobox', { name: /Busca tu dirección/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Mover el mapa al norte' }).click()
    await expect(page.getByText('Ubicación marcada:')).toBeVisible()
    await page.getByLabel('Detalles de la dirección (opcional)').fill('Torre 2, apto 304')
    await fillCustomer(page)
    await expectAccessibleWithoutOverflow(page)
    // Los campos se desplazan dentro de la hoja: se muestra el selector de ubicación en la evidencia.
    await page.locator('.location-picker__map').scrollIntoViewIfNeeded()
    await page.screenshot({
      path: path.join(evidenceDir, `domicilio-direccion-${viewport.name}.png`),
      fullPage: true,
    })

    // El campo de detalles va justo bajo el mapa: segunda captura, con él a la vista.
    await page.getByLabel('Detalles de la dirección (opcional)').scrollIntoViewIfNeeded()
    await page.screenshot({
      path: path.join(evidenceDir, `domicilio-detalles-${viewport.name}.png`),
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Ver resumen' }).click()
    await expect(page.getByText('Te atendemos en')).toBeVisible()
    await expect(page.getByText('Torre 2, apto 304 · Punto marcado cerca de')).toBeVisible()
    await expectAccessibleWithoutOverflow(page)
    await page.screenshot({
      path: path.join(evidenceDir, `domicilio-resumen-${viewport.name}.png`),
      fullPage: true,
    })

    // A 320×720 la firma del pie se superpone a los botones del resumen (defecto de maquetación
    // previo a HU-103, también sin domicilio): ahí se confirma con el teclado, que no depende
    // del punto donde cae el puntero; aquí solo se verifica lo enviado.
    const confirm = page.getByRole('button', { name: 'Confirmar turno' })
    if (viewport.width === 320) {
      await confirm.focus()
      await page.keyboard.press('Enter')
    } else {
      await confirm.click()
    }
    await expect(page.getByText('¡Tu turno quedó confirmado!')).toBeVisible()
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]!.homeService).toEqual({
      address: 'Torre 2, apto 304 · Punto marcado cerca de 4.7120, -74.0721',
      latitude: 4.712,
      longitude: -74.0721,
    })
  })
}
