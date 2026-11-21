import { test, expect, type Page, type Request } from '@playwright/test'
import {
  ATTENDEE,
  CUSTOMER,
  chooseProfessional,
  installNewAppointmentMock,
  SERVICE,
  type Scenario,
} from './nuevo-turno-mock'

/**
 * «Fecha y hora» sobre la disponibilidad real (#717, F2b), con el doble de API de
 * `nuevo-turno-mock.ts`: elegir en la rejilla, la carrera del `409` (relee ese día,
 * suelta la hora tomada y conserva el resto), el teclado de la tira de días y de
 * las horas, el ancho de 390 sin desborde ni nada bajo el dock y el movimiento
 * reducido. Sin sesión ni API reales.
 */

test.use({ locale: 'es-CO', timezoneId: 'America/Bogota' })

async function openWithService(page: Page, scenario: Scenario) {
  await installNewAppointmentMock(page, scenario)
  await page.goto('/panel/turnos/nuevo', { waitUntil: 'domcontentloaded' })
  await chooseProfessional(page)
  await page
    .getByRole('combobox', { name: 'Servicio', exact: true })
    .selectOption({ label: SERVICE.name })
  await expect(page.getByRole('radiogroup', { name: 'Hora' })).toBeVisible()
}

const hours = (page: Page) => page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio')

test('elige una hora libre de la rejilla y la envía en la zona del negocio', async ({ page }) => {
  await openWithService(page, 'filled-form')
  await page.getByLabel('Persona atendida').fill(ATTENDEE)
  await page.getByLabel('Nombre del cliente').fill(CUSTOMER)

  // Abre en el primer día con hueco (mañana) y ofrece sus tres inicios.
  await expect(hours(page)).toHaveText([':00', ':30', ':00'])
  await hours(page).nth(1).click()
  await expect(hours(page).nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.new-appointment-page__resumen')).toContainText('10:30')

  const post = page.waitForRequest(
    (r) => r.url().endsWith('/private/appointments') && r.method() === 'POST',
  )
  await page.getByRole('button', { name: /Registrar turno/ }).click()
  const body = (await post).postDataJSON() as { startsAt: string }
  expect(body.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T10:30:00$/)
})

test('un 409 marca la hora, relee ese día sin la tomada y conserva el resto', async ({ page }) => {
  await openWithService(page, 'grid-conflict')
  await page.getByLabel('Persona atendida').fill(ATTENDEE)
  await page.getByLabel('Nombre del cliente').fill(CUSTOMER)
  await hours(page).nth(1).click()

  const reread = page.waitForRequest((r: Request) => {
    const url = new URL(r.url())
    return (
      url.pathname.endsWith('/availability') &&
      url.searchParams.get('from') === url.searchParams.get('to')
    )
  })
  await page.getByRole('button', { name: /Registrar turno/ }).click()
  await reread

  // El error queda junto a la elección (bajo el título del día, describiendo las
  // horas) y en la alerta global.
  const error = page.locator('.manual-start__error')
  await expect(error).toHaveText('el profesional ya tiene una cita en ese intervalo')
  await expect(page.getByRole('radiogroup', { name: 'Hora' })).toHaveAttribute(
    'aria-describedby',
    (await error.getAttribute('id'))!,
  )
  // La hora tomada ya no se ofrece ni queda elegida; lo demás sigue escrito.
  await expect(hours(page)).toHaveText([':00', ':00'])
  await expect(page.locator('.bk-min[aria-checked="true"]')).toHaveCount(0)
  await expect(page.getByLabel('Persona atendida')).toHaveValue(ATTENDEE)
  await expect(page.getByLabel('Nombre del cliente')).toHaveValue(CUSTOMER)

  // Elegir otra y volver a enviar registra el turno.
  await hours(page).nth(1).click()
  const post = page.waitForResponse(
    (r) => r.url().endsWith('/private/appointments') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Registrar turno/ }).click()
  expect((await post).status()).toBe(201)
})

test('la tira de días y las horas se recorren con el teclado', async ({ page }) => {
  await openWithService(page, 'filled-form')
  const days = page.getByRole('radiogroup', { name: 'Día' }).getByRole('radio')
  await expect(days).toHaveCount(14)

  // Una sola parada de Tab en la tira: el día activo.
  const active = page.locator('.bk-day[tabindex="0"]')
  await expect(active).toHaveCount(1)
  // Se llega con el teclado (Tab y vuelta), como lo haría quien no usa el ratón.
  await active.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(active).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(days.nth(0)).toBeFocused()
  await expect(days.nth(0)).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.manual-start__empty-text')).toContainText('Sin horas libres el ')
  await page.keyboard.press('End')
  await expect(days.nth(13)).toBeFocused()
  // El día con foco lleva el anillo, no solo el filete de latón de la elección.
  expect(await days.nth(13).evaluate((el) => getComputedStyle(el).boxShadow)).toContain(
    '0px 0px 0px 4px',
  )
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(days.nth(1)).toHaveAttribute('aria-checked', 'true')

  // Las horas son un grupo de radio: las flechas eligen y el foco se ve.
  await page.keyboard.press('Tab')
  await expect(page.locator('.bk-min[tabindex="0"]')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(hours(page).nth(1)).toBeFocused()
  await expect(hours(page).nth(1)).toHaveAttribute('aria-checked', 'true')
  // El foco es el anillo de dos tonos (#771), distinto del filete de la elección.
  const ring = await hours(page)
    .nth(1)
    .evaluate((el) => el.matches(':focus-visible') && getComputedStyle(el).boxShadow)
  expect(ring).toContain('0px 0px 0px 4px')
  // Escape no suelta la elección.
  await page.keyboard.press('Escape')
  await expect(hours(page).nth(1)).toHaveAttribute('aria-checked', 'true')
})

test('un solo Tab desde el campo anterior cae en el día activo, sin parada en la tira', async ({
  page,
}) => {
  // Firefox da parada propia a un contenedor desplazable sin tabindex: la tira
  // de días no debe ser una parada invisible antes del día (#773).
  await openWithService(page, 'filled-form')
  await page.getByLabel('Correo (opcional)').focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('.bk-day[tabindex="0"]')).toBeFocused()
})

test('a 390 px los 14 días se desplazan dentro de la tira, sin desborde ni nada bajo el dock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openWithService(page, 'filled-form')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  const strip = page.locator('.bk-days')
  const scrolls = await strip.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(scrolls).toBe(true)

  // La última hora, llevada a la vista, queda por encima del dock.
  const last = hours(page).last()
  await last.scrollIntoViewIfNeeded()
  const dock = page.locator('nav').filter({ hasText: 'Agenda' }).last()
  const [hourBox, dockBox] = await Promise.all([last.boundingBox(), dock.boundingBox()])
  expect(hourBox && dockBox && hourBox.y + hourBox.height <= dockBox.y).toBeTruthy()
})

test('con movimiento reducido la llegada de la rejilla no anima', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openWithService(page, 'filled-form')
  const animation = await page
    .locator('.manual-start__picker')
    .evaluate((el) => getComputedStyle(el).animationName)
  expect(animation).toBe('none')
})
