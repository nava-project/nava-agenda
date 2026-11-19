import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * «Volver» del acceso y la recuperación (issue #517; v2, DEC-188 entrega 3): lleva a la sección
 * de Agenda de la presentación (https://nava.wtf/#agenda, DEC-183), con un nombre accesible que
 * dice adónde va. No tapa el formulario y no desborda en 320/360/768/1280 px. Sin API. Capturas
 * en e2e/evidence/acceso-volver-presentacion/.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'acceso-volver-presentacion')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

// Sin esto axe mide fotogramas a medio fundir y da falsos fallos de contraste.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
] as const

const routes = [
  { name: 'acceso', url: '/acceso', heading: /Accede a Nava Agenda/ },
  { name: 'recuperacion', url: '/recuperar-acceso', heading: /\S/ },
] as const

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

for (const route of routes) {
  for (const viewport of viewports) {
    test(`${route.name}: la barra de regreso convive con el formulario a ${viewport.name} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(route.url)

      const back = page.getByRole('link', { name: 'Volver a Nava Agenda en nava.wtf' })
      await expect(back).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()

      // La barra no se superpone al encabezado del formulario.
      const backBox = await back.boundingBox()
      const headingBox = await page.getByRole('heading', { level: 1 }).boundingBox()
      expect(backBox).not.toBeNull()
      expect(headingBox).not.toBeNull()
      expect(backBox!.y + backBox!.height).toBeLessThanOrEqual(headingBox!.y)

      await page.screenshot({ path: path.join(evidenceDir, `${route.name}-${viewport.name}.png`) })
      await expectAccessibleWithoutOverflow(page)
    })
  }
}

test('«Volver» apunta a la sección de Agenda de nava.wtf y es lo primero que se alcanza con Tab', async ({
  page,
}) => {
  // DEC-183: la landing es otro proyecto; no se navega fuera del servidor de pruebas.
  await page.goto('/acceso')
  const back = page.getByRole('link', { name: 'Volver a Nava Agenda en nava.wtf' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(back).toBeFocused()
  await expect(back).toHaveAttribute('href', 'https://nava.wtf/#agenda')
  await expect(back).toHaveText(/Volver/)
})
