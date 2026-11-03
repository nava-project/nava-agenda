import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Landing pública de NAVA en «/» (issue #515, DEC-151): presentación, asistente de IA, funciones,
 * contacto e «Iniciar sesión». No usa el API. En 320/360/768/1280 px: sin scroll horizontal, axe-core
 * sin violaciones y las acciones principales visibles. Capturas en e2e/evidence/landing-nava/.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'landing-nava')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

// Sin esto axe mide fotogramas a medio fundir y da falsos fallos de contraste.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
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

for (const viewport of viewports) {
  test(`presenta NAVA, el asistente y el contacto a ${viewport.name} px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('La agenda de tu barbería')
    await expect(page.getByRole('link', { name: 'Quiero NAVA en mi barbería' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Iniciar sesión' }).first()).toBeVisible()
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-1-presentacion.png`) })

    await page.locator('#asistente').scrollIntoViewIfNeeded()
    await expect(page.getByRole('heading', { name: /Tu chat nunca se queda/ })).toBeVisible()
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-2-asistente.png`) })

    await page.locator('#contacto').scrollIntoViewIfNeeded()
    await expect(page.getByRole('heading', { name: /Llevemos NAVA/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Escribir por WhatsApp' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', /^tel:\+/)
    await expect(page.getByRole('link', { name: 'Enviar un correo' })).toHaveAttribute(
      'href',
      /^mailto:/,
    )
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-3-contacto.png`) })

    await expectAccessibleWithoutOverflow(page)
  })
}

test('«Iniciar sesión» lleva al acceso sin sesión', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('banner').getByRole('link', { name: 'Iniciar sesión' }).click()
  await expect(page).toHaveURL(/\/acceso$/)
})

test('las anclas de la cabecera llevan a cada parte', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('link', { name: 'Contacto' })
    .click()
  await expect(page).toHaveURL(/#contacto$/)
  await expect(page.locator('#contacto')).toBeInViewport()
})
