import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INITIAL_VOCABULARY } from './fixtures/vocabularioInicial'

/**
 * Rediseño de la entrada pública de reservas (HU-090, issue #469): nombre y botón a la izquierda,
 * «ficha del local» (reloj, contacto, plano) a la derecha desde 1000 px y en una columna debajo, con el
 * botón antes de la ficha. Respuestas simuladas del API. En 320/360/768/1280 px: sin scroll
 * horizontal, botón visible sin desplazarse, axe-core y el reloj en la hora de la barbería (no la del
 * dispositivo). Capturas en e2e/evidence/entrada-publica-rediseno/.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'entrada-publica-rediseno')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

// Sin esto axe mide fotogramas a medio fundir y da falsos fallos de contraste.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const SLUG = 'barberia-ejemplo'

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
] as const

const fullProfile = {
  name: 'Barbería Ejemplo',
  timezone: 'America/Bogota',
  contactEmail: 'contacto@ejemplo.test',
  contactPhone: '+573001234567',
  vocabulary: INITIAL_VOCABULARY,
  location: { address: 'Calle 10 # 5-20, Bogotá', latitude: 4.598056, longitude: -74.076111 },
  offersHomeService: true,
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function installApi(page: Page, profile: Record<string, unknown>) {
  await page.route(`**/api/v1/public/barbershops/${SLUG}`, (route) => route.fulfill(json(profile)))
  await page.route(`**/api/v1/public/barbershops/${SLUG}/reviews`, (route) =>
    route.fulfill(json({ rating: null, ratingCount: 0, mapsUrl: null, reviews: [] })),
  )
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

for (const viewport of viewports) {
  test(`compone nombre, botón y ficha del local a ${viewport.name} px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installApi(page, fullProfile)
    await page.goto(`/reservar/${SLUG}`)

    const cta = page.getByRole('link', { name: /Reservar un turno/ })
    await expect(page.getByRole('heading', { name: 'Barbería Ejemplo', level: 1 })).toBeVisible()
    await expect(cta).toBeVisible()
    await expect(page.getByText('Hora local de la barbería')).toBeVisible()
    await expect(page.getByText('En el local · A domicilio')).toBeVisible()

    // La acción principal se alcanza sin desplazarse y precede a la ficha del local.
    const ctaBox = await cta.boundingBox()
    const plateBox = await page
      .getByRole('complementary', { name: 'Datos del local' })
      .boundingBox()
    expect(ctaBox).not.toBeNull()
    expect(plateBox).not.toBeNull()
    expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(viewport.height)
    if (viewport.width >= 1000) {
      expect(plateBox!.x).toBeGreaterThan(ctaBox!.x + ctaBox!.width)
    } else {
      expect(plateBox!.y).toBeGreaterThan(ctaBox!.y)
    }

    await expectAccessibleWithoutOverflow(page)
    // El mapa es un iframe perezoso: se acerca a la vista y se espera a que pinte antes de capturar.
    const map = page.locator('iframe.location-map__frame')
    if ((await map.count()) > 0) {
      await map.scrollIntoViewIfNeeded()
      await page.waitForTimeout(2500)
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    await page.screenshot({
      path: path.join(evidenceDir, `entrada-${viewport.name}.png`),
      fullPage: true,
    })
  })
}

test('el reloj dibuja la hora de la barbería, no la del dispositivo', async ({ page }) => {
  // 19:30 UTC son las 14:30 en Bogotá: aguja de horas a 75°, de minutos a 180°.
  await page.clock.install({ time: new Date('2026-09-15T19:30:00Z') })
  await installApi(page, { ...fullProfile, location: null })
  await page.goto(`/reservar/${SLUG}`)

  await expect(page.locator('.pb-clock__time')).toHaveText(/2:30\s*p\.\s*m\./)
  const rotations = await page.evaluate(() =>
    ['.pb-dial__hand--hour', '.pb-dial__hand--minute'].map(
      (selector) => (document.querySelector(selector) as SVGElement).style.transform,
    ),
  )
  expect(rotations).toEqual(['rotate(75deg)', 'rotate(180deg)'])
})

test('sin ubicación, contacto ni domicilio no deja huecos ni secciones vacías', async ({
  page,
}) => {
  await installApi(page, {
    ...fullProfile,
    contactEmail: null,
    contactPhone: null,
    location: null,
    offersHomeService: false,
  })
  await page.goto(`/reservar/${SLUG}`)

  await expect(page.getByRole('link', { name: /Reservar un turno/ })).toBeVisible()
  await expect(page.getByText('Dónde estamos')).toHaveCount(0)
  await expect(page.locator('.pb-contact')).toHaveCount(0)
  await expectAccessibleWithoutOverflow(page)
})
