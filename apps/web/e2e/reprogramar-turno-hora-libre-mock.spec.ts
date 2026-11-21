import { test, expect, type Page, type Request, type Route } from '@playwright/test'

/**
 * «Reprogramar turno» sobre los inicios libres (#776, F2c-b), con un doble de API:
 * la lectura sin el propio turno (su hora vuelve, marcada «actual» y sin poder
 * elegirse), el boleto en 12 h, la carrera del `409` (relee ese día), el `404` de
 * la lectura con «Otra hora», el teclado dentro del diálogo, 390 px y el
 * movimiento reducido. Sin sesión ni API reales; datos ficticios (RN-DAT-01/02).
 */

test.use({ locale: 'es-CO', timezoneId: 'America/Bogota' })

type Scenario = 'ok' | 'conflict' | 'not-found'

const APPOINTMENT = 'turno-reprogramar'
const PROFESSIONAL = 'profesional-camilo'
const SERVICE = 'servicio-corte'

// Mañana en Bogotá (UTC−5 todo el año).
function civilDate(offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now)
}
const TOMORROW = civilDate(1)
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${TOMORROW}T${String(h! + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
}

const detail = {
  id: APPOINTMENT,
  professionalId: PROFESSIONAL,
  professionalFullName: 'Camilo Torres',
  serviceId: SERVICE,
  attendeeName: 'Diego Molina',
  customerFullName: 'Diego Molina',
  customerPhone: null,
  customerEmail: null,
  customerNote: null,
  startsAt: at('10:00'),
  endsAt: at('10:30'),
  status: 'confirmed',
  origin: 'manual',
  serviceName: 'Corte clásico',
  durationMinutes: 30,
  priceAmount: '45000.00',
  currency: 'COP',
  versionToken: 'opaque-version-token',
  createdAt: '2026-09-01T12:00:00Z',
  homeService: null,
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function install(page: Page, scenario: Scenario) {
  let posts = 0
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const { pathname } = url
    if (pathname.endsWith('/auth/session')) {
      await json(route, {
        business: { id: 'shop-mock', name: 'NAVA QA Local' },
        expiresAt: '2099-01-01T00:00:00Z',
      })
      return
    }
    if (pathname.endsWith('/settings/business')) {
      await json(route, { timezone: 'America/Bogota' })
      return
    }
    if (pathname.endsWith(`/appointments/${APPOINTMENT}/history`)) {
      await json(route, { items: [], nextCursor: null })
      return
    }
    if (pathname.endsWith('/availability')) {
      if (scenario === 'not-found') {
        await json(route, { title: 'No encontrado', status: 404, code: 'not-found' }, 404)
        return
      }
      // Sin el propio turno, las 10:00 vuelven a estar libres. La relectura de un
      // día tras el 409 ya no trae las 10:30.
      const singleDay = url.searchParams.get('from') === url.searchParams.get('to')
      const clocks =
        singleDay && scenario === 'conflict'
          ? ['09:30', '10:00', '11:00']
          : ['09:30', '10:00', '10:30', '11:00']
      await json(route, {
        slots: clocks.map((c) => ({ startsAt: at(c) })),
        durationMinutes: 30,
        timezone: 'America/Bogota',
        slotGridMinutes: 30,
      })
      return
    }
    if (pathname.endsWith(`/appointments/${APPOINTMENT}/reschedule`)) {
      if (scenario === 'conflict' && posts++ === 0) {
        await json(
          route,
          { detail: 'el profesional ya tiene una cita en ese intervalo', code: 'conflict' },
          409,
        )
        return
      }
      const body = route.request().postDataJSON() as { startsAt: string }
      await json(route, { ...detail, startsAt: `${body.startsAt}-05:00` })
      return
    }
    if (pathname.endsWith(`/appointments/${APPOINTMENT}`)) {
      await json(route, detail)
      return
    }
    await json(route, { title: 'Mock endpoint not found' }, 404)
  })
}

async function openReschedule(page: Page, scenario: Scenario = 'ok') {
  await install(page, scenario)
  await page.goto(`/panel/turnos/${APPOINTMENT}?date=${TOMORROW}&professionalId=${PROFESSIONAL}`)
  await page.getByRole('button', { name: 'Reprogramar turno' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reprogramar turno' })
  await expect(dialog).toBeVisible()
  return dialog
}

const hours = (page: Page) =>
  page
    .getByRole('dialog', { name: 'Reprogramar turno' })
    .getByRole('radiogroup', { name: 'Hora' })
    .getByRole('radio')

test('lee sin el propio turno, marca su hora actual y envía la nueva en la zona del negocio', async ({
  page,
}) => {
  const read = page.waitForRequest((r: Request) => r.url().includes('/availability'))
  const dialog = await openReschedule(page)
  const params = new URL((await read).url()).searchParams
  expect(params.get('excludeAppointmentId')).toBe(APPOINTMENT)
  expect(new URL((await read).url()).pathname).toContain(
    `/professionals/${PROFESSIONAL}/services/${SERVICE}/availability`,
  )

  // Sin campos nativos; abre en el día del turno con su hora actual marcada.
  await expect(dialog.locator('input[type="date"], input[type="time"]')).toHaveCount(0)
  await expect(hours(page)).toHaveText([':30', ':00', ':30', ':00'])
  const current = hours(page).nth(1)
  await expect(current).toHaveClass(/bk-min--current/)
  await expect(current).toHaveAttribute('aria-disabled', 'true')
  await expect(current).toHaveAccessibleName(/tu hora actual/)
  // Ni a la fuerza se elige: reprogramar a la misma hora no es un cambio.
  await current.click({ force: true })
  await expect(dialog.locator('.bk-min[aria-checked="true"]')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Confirmar' })).toBeDisabled()

  // El boleto: ahora y la nueva hora, en 12 h.
  const ticket = dialog.locator('.appointment-detail-page__reschedule-ticket')
  await expect(ticket).toContainText('10:00 a. m.')
  await expect(ticket).toContainText('hasta 10:30 a. m.')
  await hours(page).nth(3).click()
  await expect(ticket.locator('.appointment-detail-page__reschedule-side--new')).toContainText(
    '11:00 a. m.',
  )
  await expect(ticket).toContainText('hasta 11:30 a. m.')
  await expect(ticket).not.toContainText('11:00 – 11:30')

  const post = page.waitForRequest((r) => r.url().endsWith('/reschedule'))
  await dialog.getByRole('button', { name: 'Confirmar' }).click()
  expect(((await post).postDataJSON() as { startsAt: string }).startsAt).toBe(
    `${TOMORROW}T11:00:00`,
  )
  await expect(dialog).toBeHidden()
})

test('un 409 deja el aviso junto a las horas, relee ese día sin la tomada y permite otra', async ({
  page,
}) => {
  const dialog = await openReschedule(page, 'conflict')
  await hours(page).nth(2).click()

  const reread = page.waitForRequest((r: Request) => {
    const url = new URL(r.url())
    return (
      url.pathname.endsWith('/availability') &&
      url.searchParams.get('from') === url.searchParams.get('to') &&
      url.searchParams.get('excludeAppointmentId') === APPOINTMENT
    )
  })
  await dialog.getByRole('button', { name: 'Confirmar' }).click()
  await reread

  const error = dialog.locator('.manual-start__error')
  await expect(error).toHaveText('el profesional ya tiene una cita en ese intervalo')
  await expect(dialog.getByRole('radiogroup', { name: 'Hora' })).toHaveAttribute(
    'aria-describedby',
    (await error.getAttribute('id'))!,
  )
  await expect(hours(page)).toHaveText([':30', ':00', ':00'])
  await expect(dialog.locator('.bk-min[aria-checked="true"]')).toHaveCount(0)

  await hours(page).nth(2).click()
  await expect(error).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Confirmar' }).click()
  await expect(dialog).toBeHidden()
})

test('un 404 de la lectura dice qué pasó y «Otra hora» lleva a escribirla a mano', async ({
  page,
}) => {
  const dialog = await openReschedule(page, 'not-found')
  const notice = dialog.locator('.manual-start__empty[role="alert"]')
  await expect(notice).toContainText('Este servicio ya no tiene horas libres aquí.')
  await expect(notice).toContainText('dejó de estar asignado a este profesional')
  // No cambia de modo en silencio: la rejilla no está y los campos tampoco.
  await expect(dialog.locator('#reschedule-date')).toHaveCount(0)

  await notice.getByRole('button', { name: 'Otra hora' }).click()
  await expect(dialog.locator('#reschedule-date')).toBeFocused()
  await expect(dialog.getByText('Nueva fecha')).toBeVisible()
})

test('Tab dentro del diálogo no tiene paradas fantasma y al cerrar vuelve al disparador', async ({
  page,
}) => {
  const dialog = await openReschedule(page)
  await expect(hours(page)).toHaveCount(4)

  // Cerrar → día activo → hora → «Otra hora» → Cancelar: ni el cuerpo
  // desplazable del diálogo ni la tira de días son paradas propias (Firefox).
  await dialog.getByRole('button', { name: /Cerrar/ }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.locator('.bk-day[tabindex="0"]')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.locator('.bk-min[tabindex="0"]')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: /^Otra hora/ })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused()

  // «Otra hora» lleva el foco a la fecha; «Ver las horas libres», de vuelta.
  await dialog.getByRole('button', { name: /^Otra hora/ }).click()
  await expect(dialog.locator('#reschedule-date')).toBeFocused()
  await dialog.getByRole('button', { name: 'Ver las horas libres' }).click()
  await expect(dialog.locator('.bk-day[aria-checked="true"]')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Reprogramar turno' })).toBeFocused()
})

test('a 390 px el diálogo no desborda y los 14 días se desplazan dentro de la tira', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const dialog = await openReschedule(page)
  await expect(hours(page)).toHaveCount(4)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  const box = await dialog.boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy()
  expect(await dialog.locator('.bk-days').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  )
})

test('con movimiento reducido la rejilla del diálogo no anima', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const dialog = await openReschedule(page)
  await expect(hours(page)).toHaveCount(4)
  expect(
    await dialog
      .locator('.manual-start__picker')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none')
})
