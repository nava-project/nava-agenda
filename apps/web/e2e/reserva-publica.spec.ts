import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INITIAL_VOCABULARY } from './fixtures/vocabularioInicial'

/**
 * Recorrido E2E de la reserva pública v2 «La luz del día» (DEC-188; HU-090,
 * HU-091, HU-092, HU-095): la entrada es el catálogo, «Día y hora» reúne el
 * profesional (con «Cualquiera») y la hora, y el pase lleva a «Tus datos» con
 * el profesional que atiende. Respuestas simuladas del API con `page.route`
 * (no depende de PostgreSQL); el enrutamiento, los componentes y el cliente
 * HTTP tipado son los reales. Se mide en 320/390/768/1280 px, en claro y en
 * oscuro: sin scroll horizontal y con axe-core sin violaciones. Capturas en
 * e2e/evidence/reserva-publica-v2/.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'reserva-publica-v2')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

test.use({ contextOptions: { reducedMotion: 'reduce' } })

const SLUG = 'barberia-ejemplo'
const CUT = '8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4'
const BEARD = '9a4bd3c2-f5e6-47a7-b8d9-e0f1a2b3c4d5'
const ANA = 'a1111111-1111-1111-1111-111111111111'
const BETO = 'b2222222-2222-2222-2222-222222222222'

// Mañana en Bogotá: las horas siempre quedan en el futuro.
const tomorrow = (() => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
  const d = new Date(`${today}T12:00:00-05:00`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
})()
const at = (hhmm: string) => `${tomorrow}T${hhmm}:00-05:00`

const profile = {
  name: 'Barbería Ejemplo',
  timezone: 'America/Bogota',
  contactEmail: 'contacto@ejemplo.test',
  contactPhone: null,
  vocabulary: INITIAL_VOCABULARY,
  location: null,
  offersHomeService: false,
  brandAccent: 'brass',
  openingHours: [],
  closedOnHolidays: false,
  today: null,
}

const service = (id: string, name: string, durationMinutes: number, price: string) => ({
  id,
  name,
  description: null,
  durationMinutes,
  price,
  currency: 'COP',
})

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

/** Intercepta una ruta del API por su `pathname` exacto (con o sin query). */
function api(page: Page, pathname: RegExp, body: unknown, status = 200) {
  return page.route(
    (url) => pathname.test(url.pathname),
    (route) => route.fulfill(json(body, status)),
  )
}

async function mockPublicApi(
  page: Page,
  services = [
    service(CUT, 'Corte clásico', 45, '35000.00'),
    service(BEARD, 'Arreglo de barba', 30, '22000.00'),
  ],
) {
  const base = `^/api/v1/public/businesses/${SLUG}`
  await api(page, new RegExp(`${base}$`), profile)
  await api(page, new RegExp(`${base}/services$`), { items: services })
  await api(page, new RegExp(`${base}/google-reviews$`), {}, 404)
  await api(page, new RegExp(`${base}/services/[^/]+/professionals$`), {
    items: [
      {
        id: ANA,
        fullName: 'Ana Ruiz',
        description: null,
        photoUpdatedAt: null,
        rating: null,
        ratingCount: 0,
      },
      {
        id: BETO,
        fullName: 'Beto Gil',
        description: null,
        photoUpdatedAt: null,
        rating: null,
        ratingCount: 0,
      },
    ],
  })
  await api(page, new RegExp(`${base}/services/[^/]+/availability$`), {
    slots: [
      { professionalId: BETO, startsAt: at('09:00') },
      { professionalId: ANA, startsAt: at('09:15') },
      { professionalId: BETO, startsAt: at('09:15') },
      { professionalId: ANA, startsAt: at('15:00') },
      { professionalId: ANA, startsAt: at('18:30') },
    ],
    durationMinutes: 45,
    timezone: 'America/Bogota',
    slotGridMinutes: 15,
  })
}

async function expectAccessibleWithoutOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await page.addScriptTag({ path: axeScriptPath })
  const violations = await page.evaluate(async () => {
    const result = await (
      window as unknown as { axe: { run: () => Promise<{ violations: { id: string }[] }> } }
    ).axe.run()
    return result.violations.map((v) => v.id)
  })
  expect(violations).toEqual([])
}

test.describe('Reserva pública v2 (DEC-188)', () => {
  test('de la entrada a «Tus datos» con «Cualquiera», y de vuelta a Cualquiera', async ({
    page,
  }) => {
    await mockPublicApi(page)
    await page.goto(`/reservar/${SLUG}`)

    await expect(page.getByRole('heading', { level: 1, name: 'Barbería Ejemplo' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Corte clásico/ })).toContainText('$ 35.000')
    await page.getByRole('link', { name: /Corte clásico/ }).click()

    await expect(page.getByRole('heading', { name: 'Elige día y hora' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Cualquiera/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    const hours = page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio')
    await expect(hours).toHaveCount(4)
    await expect(hours.first()).toHaveAccessibleName(/9:00\sa\.\sm\., mañana/)

    await hours.nth(1).click()
    await expect(page.locator('.bk-pase')).toContainText('Con Ana Ruiz')
    await page.getByRole('link', { name: /Seguir/ }).click()

    await expect(page).toHaveURL(
      new RegExp(`/servicios/${CUT}/profesional/${ANA}/horario/.+/cliente\\?cualquiera=1$`),
    )
    await page.getByRole('link', { name: 'Día y hora' }).click()
    await expect(page).toHaveURL(new RegExp(`/servicios/${CUT}/horario$`))
    await expect(page.getByRole('radio', { name: /Cualquiera/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('elegir un profesional filtra las horas y queda en la URL', async ({ page }) => {
    await mockPublicApi(page)
    await page.goto(`/reservar/${SLUG}/servicios/${CUT}/horario`)
    await page.getByRole('radio', { name: /Beto Gil/ }).click()
    await expect(page).toHaveURL(new RegExp(`\\?profesional=${BETO}$`))
    await expect(page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio')).toHaveCount(2)
  })

  test('un solo servicio pasa directo a «Día y hora»', async ({ page }) => {
    await mockPublicApi(page, [service(CUT, 'Corte clásico', 45, '35000.00')])
    await page.goto(`/reservar/${SLUG}`)
    await expect(page).toHaveURL(new RegExp(`/servicios/${CUT}/horario$`))
    await expect(page.getByRole('heading', { name: 'Elige día y hora' })).toBeVisible()
  })

  test('los enlaces v1 siguen funcionando', async ({ page }) => {
    await mockPublicApi(page)
    await page.goto(`/reservar/${SLUG}/servicios/${CUT}/profesional/${ANA}/horario`)
    await expect(page).toHaveURL(new RegExp(`/servicios/${CUT}/horario\\?profesional=${ANA}$`))
    await expect(page.getByRole('radio', { name: /Ana Ruiz/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('un enlace que no existe orienta, sin «Reintentar» (CA-090-02)', async ({ page }) => {
    await page.route('**/api/v1/public/businesses/**', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'No encontrado',
          status: 404,
          code: 'not-found',
        }),
      }),
    )
    await page.goto('/reservar/enlace-que-no-existe')
    await expect(page.getByRole('alert')).toContainText('Este enlace no lleva a ninguna agenda')
    await expect(page.getByRole('alert')).toContainText('Pide al negocio el enlace de nuevo')
    await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  })

  for (const viewport of [
    { name: '320', width: 320, height: 720 },
    { name: '390', width: 390, height: 844 },
    { name: '768', width: 768, height: 1024 },
    { name: '1280', width: 1280, height: 900 },
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`entrada y «Día y hora» a ${viewport.name} px en ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await mockPublicApi(page)

        await page.goto(`/reservar/${SLUG}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Barbería Ejemplo')
        await expectAccessibleWithoutOverflow(page)
        await page.screenshot({
          path: path.join(evidenceDir, `entrada-${viewport.name}-${scheme}.png`),
          fullPage: true,
        })

        await page.goto(`/reservar/${SLUG}/servicios/${CUT}/horario`)
        await page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio').nth(1).click()
        await expect(page.getByRole('link', { name: /Seguir/ })).toBeVisible()
        await expectAccessibleWithoutOverflow(page)
        await page.screenshot({
          path: path.join(evidenceDir, `dia-hora-${viewport.name}-${scheme}.png`),
        })
      })
    }
  }
})
