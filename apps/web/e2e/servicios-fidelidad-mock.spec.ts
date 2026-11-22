import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const evidenceDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'evidence',
  'servicios',
  'fidelidad-194',
)

const services = [
  service('corte', 'Corte clásico', 45, '28000.00'),
  service('barba', 'Corte + barba', 60, '40000.00'),
  service('fade', 'Fade premium', 50, '35000.00'),
  service('solo-barba', 'Barba', 30, '18000.00', false),
]

function service(
  id: string,
  name: string,
  durationMinutes: number,
  price: string,
  isActive = true,
) {
  return {
    id,
    name,
    description: null,
    durationMinutes,
    price,
    currency: 'COP',
    isActive,
    deactivatedAt: isActive ? null : '2026-09-01T12:00:00Z',
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-01T12:00:00Z',
  }
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function openCatalog(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.route('**/api/v1/private/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith('/auth/session')) {
      await route.fulfill(
        json({ business: { id: 'nava', name: 'NAVA' }, expiresAt: '2099-01-01T00:00:00Z' }),
      )
      return
    }
    if (pathname.endsWith('/services') && route.request().method() === 'GET') {
      await route.fulfill(json({ items: services, nextCursor: null }))
      return
    }
    if (pathname.endsWith('/deactivation-impact')) {
      await route.fulfill(json({ affectedAppointments: 0 }))
      return
    }
    await route.fulfill(json({ title: 'Mock endpoint not found' }, 404))
  })
  await page.goto('/panel/servicios')
  await expect(page.getByRole('heading', { name: 'Servicios' })).toBeVisible()
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 360, height: 800 },
] as const) {
  test(`fidelidad #194: catálogo en ${viewport.name}`, async ({ page }) => {
    await openCatalog(page, viewport.width, viewport.height)
    await expect(page.getByText('Corte clásico')).toBeVisible()
    expect(await page.evaluate(() => window.innerWidth)).toBe(viewport.width)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false)
    await page.screenshot({
      path: path.join(evidenceDir, viewport.name, 'catalogo.png'),
      animations: 'disabled',
    })
  })
}

test('fidelidad #194: foco, teclado y reflow obligatorio', async ({ page }) => {
  await openCatalog(page, 1280, 900)
  for (const viewport of [
    { name: '320', width: 320, height: 720 },
    { name: '360', width: 360, height: 800 },
    { name: '768', width: 768, height: 1024 },
    { name: '1280', width: 1280, height: 900 },
    { name: '1280-zoom200', width: 640, height: 450 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/panel/servicios')
    expect(await page.evaluate(() => window.innerWidth)).toBe(viewport.width)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false)
    // El «+» es dibujo: el nombre es exactamente «Agregar servicio», y la acción no
    // se anuncia como interruptor (#774).
    const action = page.getByRole('button', { name: 'Agregar servicio', exact: true })
    await expect(action).not.toHaveAttribute('aria-pressed')
    await action.focus()
    await expect(action).toBeFocused()
    await page.screenshot({
      path: path.join(evidenceDir, 'responsive', viewport.name, 'foco-agregar.png'),
      animations: 'disabled',
    })
  }
})

// #791: con la cifra más ancha (precio de seis cifras) y las tres fichas del
// servicio inactivo, el contenido de «Estado del servicio» no se sale del
// diálogo en los anchos angostos. Se mide el contenido del diálogo, no solo el
// documento: el diálogo recorta lo que desborda y el documento no lo nota.
test('#791: «Estado del servicio» sin desborde dentro del diálogo en angosto', async ({ page }) => {
  const wide = [
    service('largo', 'Tratamiento completo', 120, '450000.00'),
    service('largo-inactivo', 'Tratamiento de temporada', 120, '450000.00', false),
  ]
  await openCatalog(page, 320, 720)
  await page.route('**/api/v1/private/services**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (route.request().method() !== 'GET' || !pathname.endsWith('/services'))
      return route.fallback()
    await route.fulfill(json({ items: wide, nextCursor: null }))
  })
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 760 })
    for (const name of ['Tratamiento completo', 'Tratamiento de temporada']) {
      await page.goto('/panel/servicios')
      await page.getByRole('button', { name: `Cambiar estado de ${name}` }).click()
      const dialog = page.getByRole('dialog', { name: 'Estado del servicio' })
      await expect(dialog.getByRole('switch')).toBeVisible()
      const overflow = await dialog.evaluate((node) => {
        const content = node.querySelector('.base-dialog__content') as HTMLElement
        return content.scrollWidth - content.clientWidth
      })
      expect(overflow, `${width} · ${name}: el contenido cabe en el diálogo`).toBeLessThanOrEqual(0)
      await page.keyboard.press('Escape')
    }
  }
})
