import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Rediseño del detalle de turno sobre tinta (HU-064, DEC-146, issue #471). Respuestas simuladas del
 * API: un turno vigente (ficha de pergamino y acciones) y uno terminal (contorno sobre tinta, sin
 * relleno) en 320/360/768/1280 px y en los modos Tinta y Marfil (#473), sin scroll horizontal y con
 * axe-core (contraste incluido). A 1920 × 1080 el contenido queda centrado (#477).
 * Capturas en e2e/evidence/agenda-detalle/rediseno-471/.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'agenda-detalle', 'rediseno-471')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

// Sin esto axe mide fotogramas a medio fundir y da falsos fallos de contraste.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
] as const

function detail(status: 'confirmed' | 'cancelled_by_customer') {
  return {
    id: 'turno-demo',
    professionalId: 'profesional-demo',
    professionalFullName: 'Iván Carvajal',
    attendeeName: 'Valentina Pardo',
    customerFullName: 'Valentina Pardo',
    customerPhone: '+573000000001',
    customerEmail: null,
    customerNote: 'Prefiere degradado bajo en los laterales.',
    startsAt: '2026-11-02T19:00:00Z',
    endsAt: '2026-11-02T19:45:00Z',
    status,
    origin: 'public',
    serviceName: 'Corte degradado',
    durationMinutes: 45,
    priceAmount: '35000.00',
    currency: 'COP',
    versionToken: 'opaque-version-token',
    createdAt: '2026-10-30T15:30:00Z',
  }
}

const history = {
  items: [
    {
      id: 'event-created',
      eventType: 'appointment_created',
      actorType: 'customer',
      actorLabel: 'Valentina Pardo',
      reason: null,
      occurredAt: '2026-10-30T15:30:00Z',
      changes: [],
    },
    {
      id: 'event-rescheduled',
      eventType: 'appointment_rescheduled',
      actorType: 'staff',
      actorLabel: 'Iván Carvajal',
      reason: null,
      occurredAt: '2026-10-31T15:45:00Z',
      changes: [
        {
          fieldName: 'starts_at',
          previousValue: '2 nov 2026, 1:00 p. m.',
          newValue: '2 nov 2026, 2:00 p. m.',
        },
      ],
    },
  ],
  nextCursor: null,
}

function json(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

async function installApi(page: Page, status: 'confirmed' | 'cancelled_by_customer') {
  await page.route('**/api/v1/private/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith('/auth/session')) {
      await route.fulfill(
        json({
          business: { id: 'shop-demo', name: 'Barbería Ejemplo' },
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      )
    } else if (pathname.endsWith('/settings/business')) {
      await route.fulfill(json({ timezone: 'America/Bogota' }))
    } else if (pathname.endsWith('/appointments/turno-demo/history')) {
      await route.fulfill(json(history))
    } else if (pathname.endsWith('/appointments/turno-demo')) {
      await route.fulfill(json(detail(status)))
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    }
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
      window as unknown as {
        axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: unknown[] }> }
      }
    ).axe.run(document, { iframes: false })
    return result.violations
  })
  expect(violations).toEqual([])
}

const themes = ['ink', 'ivory'] as const

for (const [label, status] of [
  ['vigente', 'confirmed'],
  ['terminal', 'cancelled_by_customer'],
] as const) {
  for (const theme of themes) {
    for (const viewport of viewports) {
      test(`detalle de un turno ${label} en modo ${theme} a ${viewport.name} px`, async ({
        page,
      }) => {
        // El modo se guarda en el dispositivo (DEC-110): se fija antes de que cargue la app.
        await page.addInitScript((mode) => {
          window.localStorage.setItem('nava.appearance.v1', JSON.stringify({ theme: mode }))
        }, theme)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await installApi(page, status)
        await page.goto('/panel/turnos/turno-demo?date=2026-11-02&professionalId=profesional-demo')

        await expect(page.getByRole('heading', { name: 'Valentina Pardo', level: 1 })).toBeVisible()
        await expect(page.getByText('Turno reprogramado')).toBeVisible()
        // La franja es decorativa; la hora completa sigue dicha en la fila «Hora» (solo lector de pantalla).
        await expect(page.locator('.appointment-detail-page__span-date')).toContainText(
          'Hora de Colombia',
        )
        await expect(page.getByRole('button', { name: 'Corregir resultado' })).toHaveCount(
          status === 'confirmed' ? 0 : 1,
        )
        await expect(page.getByRole('button', { name: 'Cancelar turno' })).toHaveCount(
          status === 'confirmed' ? 1 : 0,
        )

        await expect(page.locator('html')).toHaveAttribute(
          'data-app-theme',
          theme === 'ivory' ? 'ivory' : /.*/,
        )
        await expectAccessibleWithoutOverflow(page)
        await page.screenshot({
          path: path.join(evidenceDir, `detalle-${label}-${theme}-${viewport.name}.png`),
          fullPage: true,
        })
      })
    }
  }
}

// #477: en una ventana ancha y alta el contenido no queda pegado arriba ni estirado a todo el ancho.
for (const theme of themes) {
  test(`el detalle queda centrado en una ventana de 1920 × 1080 en modo ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      window.localStorage.setItem('nava.appearance.v1', JSON.stringify({ theme: mode }))
    }, theme)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await installApi(page, 'confirmed')
    await page.goto('/panel/turnos/turno-demo?date=2026-11-02&professionalId=profesional-demo')
    await expect(page.getByRole('heading', { name: 'Valentina Pardo', level: 1 })).toBeVisible()
    await expect(page.getByText('Turno reprogramado')).toBeVisible()

    const gaps = await page.evaluate(() => {
      const section = document.querySelector('.appointment-detail-page') as HTMLElement
      const back = document.querySelector('.appointment-detail-page__back') as HTMLElement
      const body = document.querySelector('.appointment-detail-page__body') as HTMLElement
      // Centrado dentro del área de contenido (`main`), que es lo que mide la
      // pantalla; la navegación va al pie en todos los anchos (issue #724).
      const area = (document.querySelector('main') as HTMLElement).getBoundingClientRect()
      const s = section.getBoundingClientRect()
      return {
        width: s.width,
        left: s.left - area.left,
        right: area.left + (document.querySelector('main') as HTMLElement).clientWidth - s.right,
        top: back.getBoundingClientRect().top - s.top,
        bottom: s.bottom - body.getBoundingClientRect().bottom,
      }
    })
    expect(gaps.width).toBeLessThanOrEqual(1280)
    expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(1)
    // Proporcionales: la diferencia es solo el relleno propio de la sección (26 px arriba, 30 abajo).
    expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(24)

    await expectAccessibleWithoutOverflow(page)
    await page.screenshot({
      path: path.join(evidenceDir, `detalle-vigente-${theme}-1920.png`),
    })
  })
}

// #479 y #481: las tarjetas de reprogramar y de cancelar son tarjetas centradas sobre tinta que
// siguen el modo activo.
const inkDialogs = [
  {
    slug: 'reprogramar',
    button: 'Reprogramar turno',
    maxWidth: 620,
    texts: ['Horario actual', 'Vista previa'],
  },
  {
    slug: 'cancelar',
    button: 'Cancelar turno',
    maxWidth: 520,
    texts: ['Turno que se cancelará', 'Valentina Pardo', 'no se puede deshacer'],
  },
] as const

for (const card of inkDialogs) {
  for (const theme of themes) {
    for (const viewport of [...viewports, { name: '1920', width: 1920, height: 1080 }]) {
      test(`la tarjeta de ${card.slug} en modo ${theme} a ${viewport.name} px`, async ({
        page,
      }) => {
        await page.addInitScript((mode) => {
          window.localStorage.setItem('nava.appearance.v1', JSON.stringify({ theme: mode }))
        }, theme)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await installApi(page, 'confirmed')
        await page.goto('/panel/turnos/turno-demo?date=2026-11-02&professionalId=profesional-demo')
        await page.getByRole('button', { name: card.button, exact: true }).click()

        const dialog = page.getByRole('dialog', { name: card.button })
        await expect(dialog).toBeVisible()
        for (const text of card.texts) await expect(dialog.getByText(text)).toBeVisible()
        if (card.slug === 'reprogramar') {
          await expect(dialog.getByLabel('Nueva fecha')).toBeVisible()
          await expect(dialog.getByRole('button', { name: 'Confirmar' })).toBeVisible()
        } else {
          await expect(dialog.getByRole('button', { name: 'Sí, cancelar turno' })).toBeVisible()
          await expect(dialog.getByRole('button', { name: 'Volver' })).toBeVisible()
        }

        // Centrada en horizontal y dentro de la ventana, sin quedar pegada al borde inferior.
        const box = await dialog.boundingBox()
        expect(box).not.toBeNull()
        const b = box!
        expect(b.width).toBeLessThanOrEqual(card.maxWidth)
        expect(Math.abs(b.x + b.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y + b.height).toBeLessThanOrEqual(viewport.height - 8)
        // La superficie es la del modo, no un bloque claro fijo.
        const luminance = await dialog.evaluate((el) => {
          const [r, g, bl] = getComputedStyle(el)
            .backgroundColor.match(/\d+(\.\d+)?/g)!
            .slice(0, 3)
            .map(Number)
          return (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255
        })
        if (theme === 'ink') expect(luminance).toBeLessThan(0.2)
        else expect(luminance).toBeGreaterThan(0.8)

        await expectAccessibleWithoutOverflow(page)
        await page.screenshot({
          path: path.join(evidenceDir, `${card.slug}-${theme}-${viewport.name}.png`),
        })
      })
    }
  }
}
