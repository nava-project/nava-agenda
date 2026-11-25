import { expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

/**
 * Pasos del recorrido de #854 (DEC-193): un «No vino» dentro de la franja la
 * libera desde el minuto de la marca y «Empezó ahora» (#852) la toma.
 *
 * Los usa la spec (agenda-no-vino-libera-franja.spec.ts) y el script de
 * verificación en el Chromium visible de larga vida, que se conecta por CDP y no
 * puede correr la spec: así los dos ejecutan los mismos pasos y las mismas
 * aserciones. `base` es el origen del panel; las rutas son absolutas porque una
 * página conectada por CDP no tiene `baseURL`.
 */
export type NoVinoProfessional = { id: string; name: string }

export const NO_VINO_SERVICE = 'Servicio de prueba 854'
const APPOINTMENTS = '/api/v1/private/appointments'

/** Registra en «Nuevo turno» un turno que empezó ahora y devuelve su id. */
export async function registerStartedNow(
  page: Page,
  base: string,
  professional: NoVinoProfessional,
  attendee: string,
): Promise<string> {
  await page.goto(`${base}/panel/turnos/nuevo`)
  const trigger = page.locator('#new-appointment-professional')
  await trigger.click()
  await page.getByRole('option', { name: professional.name }).click()
  await expect(trigger).toContainText(professional.name)
  await page.locator('#new-appointment-service').selectOption({ label: NO_VINO_SERVICE })
  await page.locator('button.manual-start__switch', { hasText: 'Otra hora' }).first().click()
  await page.getByRole('button', { name: 'Empezó ahora' }).click()
  await page.getByLabel('Persona atendida').fill(attendee)

  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === APPOINTMENTS,
  )
  await page.getByRole('button', { name: 'Registrar turno' }).click()
  const response = await created
  expect(response.status(), `registrar «${attendee}» empezado ahora`).toBe(201)
  await expect(page.getByText('Turno registrado').first()).toBeVisible()
  return ((await response.json()) as { id: string }).id
}

/** Marca «No vino» en el detalle, dentro de la franja, y comprueba lo que dice el panel. */
export async function markNoShowInsideSlot(page: Page, base: string, id: string): Promise<void> {
  await page.goto(`${base}/panel/turnos/${id}`)
  await page.getByRole('button', { name: 'Marcar que no asistió' }).click()
  const dialog = page.getByRole('dialog', { name: 'Marcar que no asistió' })
  await expect(dialog).toContainText(
    'Desde este minuto, el resto de la franja queda libre para otro turno.',
  )
  await dialog.getByRole('button', { name: 'Sí, marcar que no asistió' }).click()
  await expect(dialog).toBeHidden()
  // El detalle dice, con palabras, que lo que queda de la franja quedó libre.
  await expect(page.locator('.appointment-detail-page__occupancy')).toContainText(/quedó libre/)
}

/** La agenda del día dice desde cuándo quedó libre la franja del «No vino». */
export async function expectAgendaFreedFrom(
  page: Page,
  base: string,
  professional: NoVinoProfessional,
  attendee: string,
): Promise<void> {
  await page.goto(`${base}/panel?professionalId=${professional.id}`)
  const row = page.locator('.daily-agenda-page__item', { has: page.getByText(attendee) })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(/Libre desde las \d{1,2}:\d{2}/)
}

/**
 * Limpieza: marca «No vino» por el API un turno que siga confirmado, así libera su
 * franja desde ese minuto y la próxima corrida puede empezar otro turno «ahora».
 * Los turnos no se borran (RN-CIT-04).
 */
export async function releaseIfConfirmed(page: Page, base: string, id: string): Promise<void> {
  const detail = await page.request.get(`${base}${APPOINTMENTS}/${id}`)
  if (detail.status() !== 200) return
  const body = (await detail.json()) as { status: string; versionToken: string }
  if (body.status !== 'confirmed') return
  const response = await page.request.post(`${base}${APPOINTMENTS}/${id}/no-show`, {
    headers: { 'If-Match': body.versionToken, 'Idempotency-Key': randomUUID() },
  })
  expect([200, 204], `liberar el turno ${id} al terminar`).toContain(response.status())
}

/**
 * El recorrido completo. Devuelve los ids creados en `created` a medida que
 * existen, para que quien llama los libere aunque un paso falle.
 */
export async function noVinoLiberaFranja(
  page: Page,
  base: string,
  professional: NoVinoProfessional,
  created: string[],
): Promise<void> {
  // Nombres únicos por corrida: los turnos no se borran (RN-CIT-04), así que una
  // corrida anterior deja filas con el mismo nombre en la agenda de hoy.
  const run = Date.now().toString(36).slice(-5)
  const nameA = `Persona de prueba 854 A ${run}`
  // 1. Un turno que empezó ahora, de 30 min.
  const first = await registerStartedNow(page, base, professional, nameA)
  created.push(first)
  // 2. «No vino» dentro de la franja.
  await markNoShowInsideSlot(page, base, first)
  // 3. «Empezó ahora» otra vez, para el mismo profesional: entra sin 409. Antes de
  //    DEC-193 chocaba con la exclusión, porque el «No vino» ocupaba su franja entera.
  created.push(await registerStartedNow(page, base, professional, `Persona de prueba 854 B ${run}`))
  // 4. La agenda dice desde cuándo quedó libre la franja del «No vino».
  await expectAgendaFreedFrom(page, base, professional, nameA)
}
