import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Horario de atención del local (HU-107, DEC-182), en sus dos caras:
 * - Configuración: la sección «Horario de atención» carga la semana, abre un día,
 *   guarda la semana completa (00:00 como 24:00) y señala junto al día un horario
 *   que se cruza, sin enviarlo.
 * - Reserva pública: la entrada muestra el estado de ahora en la hora del local y
 *   la semana con hoy marcado; sin horario configurado no muestra nada.
 * En 320/360/768/1280 px y zoom 200 % aproximado, sin scroll horizontal y con
 * axe-core. Respuestas simuladas del API: la persistencia, el reemplazo de la
 * semana y el aislamiento entre dos tenants los cubren las pruebas Go y SQL.
 * Capturas en e2e/evidence/horario-local/.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(here, 'evidence', 'horario-local')
const axeScriptPath = path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')

test.use({ contextOptions: { reducedMotion: 'reduce' } })

const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1280-zoom200', width: 640, height: 450 },
] as const

const SLUG = 'barberiacentro7k3m9q2x'
// Martes 17 de noviembre de 2026, 10:00 en Bogotá.
const NOW = new Date('2026-11-17T15:00:00Z')

const WEEK = [
  { dayOfWeek: 'MONDAY', opens: '09:00', closes: '12:30' },
  { dayOfWeek: 'MONDAY', opens: '14:00', closes: '19:00' },
  { dayOfWeek: 'TUESDAY', opens: '09:00', closes: '19:00' },
  { dayOfWeek: 'WEDNESDAY', opens: '09:00', closes: '19:00' },
  { dayOfWeek: 'THURSDAY', opens: '09:00', closes: '19:00' },
  { dayOfWeek: 'FRIDAY', opens: '09:00', closes: '24:00' },
  { dayOfWeek: 'SATURDAY', opens: '08:00', closes: '16:00' },
]

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ path: axeScriptPath })
  return page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: {
          run: (
            ctx: unknown,
            opts: unknown,
          ) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: unknown }> }> }>
        }
      }
    ).axe.run(document, { iframes: false })
    return result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
  })
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

async function openSettings(page: Page, width: number, height: number) {
  const saved: unknown[] = []
  await page.setViewportSize({ width, height })
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'nava.appearance.v1',
      JSON.stringify({ theme: 'ink', textScale: 'normal', motion: 'full' }),
    )
  })
  await page.route('**/api/v1/private/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith('/auth/session')) {
      await route.fulfill(
        json({
          business: { id: 'nava', name: 'Barbería Centro' },
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      )
    } else if (pathname.endsWith('/settings/opening-hours')) {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON()
        saved.push(body)
        await route.fulfill(json({ ...body, maxSegmentsPerDay: 4 }))
      } else {
        await route.fulfill(
          json({ openingHours: WEEK.slice(0, 3), closedOnHolidays: false, maxSegmentsPerDay: 4 }),
        )
      }
    } else if (pathname.endsWith('/settings/business')) {
      await route.fulfill(
        json({
          name: 'Barbería Centro',
          timezone: 'America/Bogota',
          contactEmail: null,
          contactPhone: null,
        }),
      )
    } else if (pathname.endsWith('/settings/brand')) {
      await route.fulfill(
        json({
          accent: 'brass',
          businessTerm: 'barbería',
          businessTermGender: 'feminine',
          professionalTerm: 'barbero',
          professionalTermPlural: 'barberos',
          professionalTermGender: 'masculine',
          hasPhysicalLocation: false,
          address: null,
          latitude: null,
          longitude: null,
          offersHomeService: false,
        }),
      )
    } else if (pathname.endsWith('/settings/public-link')) {
      await route.fulfill(json({ slug: SLUG }))
    } else if (pathname.endsWith('/settings/login-otp')) {
      await route.fulfill(json({ channel: 'email' }))
    } else if (pathname.endsWith('/settings/reminders')) {
      await route.fulfill(json({ leadMinutes: 30, leadOptions: [10, 20, 30, 40, 50, 60] }))
    } else {
      await route.fulfill(json({ title: 'Mock endpoint not found' }, 404))
    }
  })
  await page.goto('/panel/barberia#configuracion-horario')
  const section = page.locator('#configuracion-horario')
  await expect(section.getByText('Lunes', { exact: true })).toBeVisible()
  await page.waitForTimeout(600)
  await section.scrollIntoViewIfNeeded()
  return { section, saved }
}

for (const vp of viewports) {
  test(`Configuración · horario de atención en ${vp.name}`, async ({ page }) => {
    const { section } = await openSettings(page, vp.width, vp.height)

    await expectNoHorizontalScroll(page)
    expect(await axeViolations(page)).toEqual([])
    // La sección es más alta que la ventana y la cabecera fija la taparía: la
    // captura usa el mismo ancho con más alto (las comprobaciones ya corrieron
    // en el tamaño real).
    await page.setViewportSize({ width: vp.width, height: 2600 })
    await section.scrollIntoViewIfNeeded()
    await section.screenshot({ path: path.join(evidenceDir, vp.name, '1-configuracion.png') })
  })
}

test('Configuración · abrir el sábado y guardar envía la semana completa', async ({ page }) => {
  const { section, saved } = await openSettings(page, 1280, 900)

  const saturday = section.locator('.opening__day').nth(5)
  await saturday.getByRole('checkbox').check()
  await section.getByRole('switch', { name: 'Cerramos los festivos' }).click()
  await section.getByRole('button', { name: 'Guardar horario' }).click()

  await expect(section.getByText('Guardado. Tus clientes ya ven este horario.')).toBeVisible()
  expect(saved).toEqual([
    {
      openingHours: [
        ...WEEK.slice(0, 3),
        { dayOfWeek: 'SATURDAY', opens: '09:00', closes: '19:00' },
      ],
      closedOnHolidays: true,
    },
  ])
})

test('Configuración · un horario que se cruza se señala junto al día y no se envía', async ({
  page,
}) => {
  const { section, saved } = await openSettings(page, 360, 800)

  const monday = section.locator('.opening__day').first()
  // El segundo horario del lunes empieza a las 12:00, antes de que cierre el primero (12:30).
  await monday.locator('.opening__interval').nth(1).getByRole('button', { name: /Abre/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input').first().fill('12')
  await dialog.locator('input').nth(1).fill('00')
  await dialog.locator('input').nth(1).press('Enter')
  await section.getByRole('button', { name: 'Guardar horario' }).click()

  await expect(monday.getByRole('alert')).toHaveText('Dos horarios del mismo día se cruzan.')
  expect(saved).toEqual([])
  expect(await axeViolations(page)).toEqual([])
  await monday.screenshot({ path: path.join(evidenceDir, '360', '2-cruce.png') })
})

// ---------------------------------------------------------------------------
// Reserva pública
// ---------------------------------------------------------------------------

async function openEntry(page: Page, width: number, height: number, withHours: boolean) {
  await page.clock.setFixedTime(NOW)
  await page.setViewportSize({ width, height })
  await page.route(`**/api/v1/public/businesses/${SLUG}`, (route) =>
    route.fulfill(
      json({
        name: 'Barbería Centro',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: '+573001234567',
        vocabulary: {
          businessTerm: 'barbería',
          businessTermGender: 'feminine',
          professionalTerm: 'barbero',
          professionalTermPlural: 'barberos',
          professionalTermGender: 'masculine',
        },
        location: null,
        offersHomeService: false,
        brandAccent: 'brass',
        openingHours: withHours ? WEEK : [],
        closedOnHolidays: withHours,
        today: withHours
          ? {
              date: '2026-11-17',
              dayOfWeek: 'TUESDAY',
              holiday: null,
              hours: [{ opens: '09:00', closes: '19:00' }],
            }
          : null,
      }),
    ),
  )
  await page.route(`**/api/v1/public/businesses/${SLUG}/reviews**`, (route) =>
    route.fulfill(json({ title: 'Not found' }, 404)),
  )
  await page.goto(`/reservar/${SLUG}`)
  await expect(page.getByRole('heading', { name: 'Barbería Centro', level: 1 })).toBeVisible()
  await page.waitForTimeout(400)
}

for (const vp of viewports) {
  test(`Reserva pública · horario del local en ${vp.name}`, async ({ page }) => {
    await openEntry(page, vp.width, vp.height, true)

    const hours = page.getByRole('region', { name: 'Horario' })
    await expect(hours.getByText('Abierto · cierra a las 7:00 p. m.')).toBeVisible()
    await expect(hours.locator('.pb-hours__row--today')).toContainText('Martes')
    await expect(hours).toContainText('9:00 a. m. – medianoche')
    await expect(hours).toContainText('Cerramos los festivos.')

    await expectNoHorizontalScroll(page)
    expect(await axeViolations(page)).toEqual([])
    await page.screenshot({
      path: path.join(evidenceDir, vp.name, '3-reserva.png'),
      fullPage: true,
    })
  })
}

test('Reserva pública · sin horario configurado no aparece ninguna sección', async ({ page }) => {
  await openEntry(page, 360, 800, false)
  await expect(page.getByRole('region', { name: 'Horario' })).toHaveCount(0)
  await expect(page.getByText('Cerrado')).toHaveCount(0)
})
