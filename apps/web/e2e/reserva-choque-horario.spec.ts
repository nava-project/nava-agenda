import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Choque de horario y error al confirmar en la reserva pública (#794, RN-CON-05, DEC-090). El API
 * se simula con el contrato real del 409 `slot-conflict` (con `alternatives`) y del 409 de
 * idempotencia; la concurrencia que produce el choque la cubren las pruebas Go con PostgreSQL.
 * Aquí se recorre lo visible a 320, 390 y 1280:
 *  1. las horas libres van agrupadas por día como píldoras de 44 px, sin desborde dentro del
 *     diálogo y sin violaciones de axe; elegir una cierra el diálogo;
 *  2. el 409 de idempotencia muestra el aviso de la familia («No pudimos confirmar tu turno») en
 *     vez de la caja genérica «Error».
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

// Sin esto axe mide fotogramas a medio fundir y da falsos fallos de contraste.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const SLUG = 'barberia-ejemplo'
const SERVICE_ID = '8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4'
const PROFESSIONAL_ID = 'a1111111-1111-1111-1111-111111111111'
// Siempre futura: la pantalla descarta un `startsAt` que ya pasó (F-RQ-02, #436).
const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
start.setUTCHours(15, 0, 0, 0)
const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z')
const STARTS_AT = iso(start)
const at = (minutes: number) => iso(new Date(start.getTime() + minutes * 60_000))
const ROUTE = `/reservar/${SLUG}/servicios/${SERVICE_ID}/profesional/${PROFESSIONAL_ID}/horario/${encodeURIComponent(STARTS_AT)}/cliente`

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
] as const

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function installApi(page: Page, confirm: { status: number; body: unknown }) {
  await page.route(`**/api/v1/public/businesses/${SLUG}`, (route) =>
    route.fulfill(
      json({
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: null,
        location: null,
        offersHomeService: false,
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
              id: PROFESSIONAL_ID,
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
    `**/api/v1/public/businesses/${SLUG}/services/${SERVICE_ID}/professionals/${PROFESSIONAL_ID}/appointments`,
    (route) => route.fulfill(json(confirm.body, confirm.status)),
  )
}

async function confirmWithFictitiousCustomer(page: Page) {
  await page.goto(ROUTE)
  await page.getByLabel('Tu nombre').fill('Ana Prueba')
  await page.getByLabel('Teléfono').fill('+573000000000')
  await page.getByLabel('Correo').fill('ana.prueba@example.test')
  await page.getByRole('button', { name: 'Ver resumen' }).click()
  await page.getByRole('button', { name: 'Confirmar turno' }).click()
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ path: axeScriptPath })
  return page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string }[] }> }
      }
    ).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    })
    return result.violations.map((v) => v.id)
  })
}

for (const viewport of viewports) {
  test(`#794: horas libres del choque en píldoras por día a ${viewport.name} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installApi(page, {
      status: 409,
      body: {
        type: 'about:blank',
        title: 'Horario ocupado',
        status: 409,
        code: 'slot-conflict',
        alternatives: [{ startsAt: at(30) }, { startsAt: at(60) }, { startsAt: at(24 * 60) }],
      },
    })
    await confirmWithFictitiousCustomer(page)

    const dialog = page.getByRole('dialog', { name: 'Ese horario se acaba de ocupar' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.pb-conflict__day')).toHaveCount(2)
    const pills = dialog.locator('.pb-conflict__alt')
    await expect(pills).toHaveCount(3)
    for (const box of await pills.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { height: r.height, wraps: el.scrollHeight > el.clientHeight + 1 }
      }),
    )) {
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.wraps).toBe(false)
    }
    const overflow = await dialog
      .locator('.base-dialog__content')
      .evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect(await axeViolations(page)).toEqual([])

    await pills.first().click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Confirmar turno' })).toBeVisible()
  })

  test(`#794: el 409 de idempotencia muestra el aviso de la familia a ${viewport.name} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installApi(page, {
      status: 409,
      body: { type: 'about:blank', title: 'Conflicto', status: 409, code: 'idempotency-conflict' },
    })
    await confirmWithFictitiousCustomer(page)

    const alert = page.getByRole('alert').filter({ hasText: 'No pudimos confirmar tu turno' })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Hubo un problema al procesar tu confirmación')
    await expect(page.locator('.base-alert')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect(await axeViolations(page)).toEqual([])
  })
}
