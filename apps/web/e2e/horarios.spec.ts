import { test, expect, type Page } from '@playwright/test'
import { pickTime, selectProfessional } from './horarios-controles'

/**
 * Recorrido E2E de HU-040 (horario laboral recurrente). Corre contra el API
 * real en local (`go run ./cmd/api` sobre PostgreSQL real con las trece
 * migraciones aplicadas y un usuario con un hash argon2id REAL, mismo
 * criterio que `e2e/servicios-por-profesional.spec.ts`).
 *
 * Variables de entorno:
 *   E2E_EMAIL / E2E_PASSWORD: credenciales válidas contra el API real
 *     (negocio A, "shopA").
 *   E2E_EMAIL_B / E2E_PASSWORD_B: credenciales válidas de una SEGUNDA
 *     negocio real ("shopB"), usadas solo para la prueba de aislamiento
 *     entre tenants.
 *   APP_BASE_URL: base del frontend (por defecto http://localhost:5173).
 */
const EMAIL = process.env.E2E_EMAIL ?? 'duena.a@ejemplo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'ClaveDePruebaHU010!'
const EMAIL_B = process.env.E2E_EMAIL_B ?? 'dueno.b@ejemplo.test'
const PASSWORD_B = process.env.E2E_PASSWORD_B ?? 'ClaveDePruebaHU010!'

async function login(page: Page, email: string, password: string) {
  await page.goto('/acceso')
  await page.getByLabel('Correo', { exact: true }).fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page).toHaveURL(/\/panel$/)
}

async function addProfessional(page: Page, fullName: string) {
  await page.getByRole('link', { name: 'Barberos' }).click()
  await expect(page).toHaveURL(/\/panel\/profesionales$/)
  await page.getByRole('button', { name: 'Agregar barbero' }).click()
  const dialog = page.getByRole('dialog', { name: 'Agregar barbero' })
  await dialog.getByLabel('Nombre').fill(fullName)
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).toBeHidden()
}

async function openSchedules(page: Page) {
  await page.getByRole('link', { name: 'Horarios' }).click()
  await expect(page).toHaveURL(/\/panel\/horarios$/)
  await expect(page.getByRole('heading', { name: 'Horarios' })).toBeVisible()
}

// El diálogo captura «de HH:MM a HH:MM»; las pruebas siguen describiendo el
// tramo por su duración y aquí se traduce a la hora de fin.
function endTime(startsTime: string, durationMinutes: string): string {
  const [hours, minutes] = startsTime.split(':').map(Number) as [number, number]
  const end = (hours * 60 + minutes + Number(durationMinutes)) % (24 * 60)
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

async function addWorkingHour(
  page: Page,
  {
    weekday,
    startsTime,
    durationMinutes,
  }: { weekday: string; startsTime: string; durationMinutes: string },
) {
  await page.getByRole('button', { name: 'Agregar un tramo el Lunes' }).click()
  const dialog = page.getByRole('dialog', { name: 'Agregar tramo' })
  await dialog.getByRole('radio', { name: weekday }).click()
  await pickTime(dialog, page, 'Hora de inicio', startsTime)
  await pickTime(dialog, page, 'Hora de fin', endTime(startsTime, durationMinutes))
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  return dialog
}

test.describe('Horario laboral recurrente (HU-040)', () => {
  // Serial a propósito: varias pruebas comparten el mismo negocio real
  // (shopA/shopB, sin aprovisionamiento de negocios nuevos en esta
  // historia); ejecutarlas en paralelo produciría una carrera entre sus
  // propias escrituras, no un defecto del producto.
  test.describe.configure({ mode: 'serial' })

  test('agregar un tramo persiste tras recargar, bajo su día correcto (CA-040-01/02)', async ({
    page,
  }) => {
    const stamp = Date.now()
    const professionalName = `E2E Barbero Horario ${stamp}`

    await login(page, EMAIL, PASSWORD)
    await addProfessional(page, professionalName)

    await openSchedules(page)
    await selectProfessional(page, professionalName)

    const dialog = await addWorkingHour(page, {
      weekday: 'Lunes',
      startsTime: '08:00',
      durationMinutes: '240',
    })
    await expect(dialog).toBeHidden()
    await expect(page.getByText('8:00 a. m. – 12:00 p. m.')).toBeVisible()

    await page.reload()
    await selectProfessional(page, professionalName)
    await expect(page.getByText('8:00 a. m. – 12:00 p. m.')).toBeVisible()
  })

  test('una jornada partida agrega dos tramos no solapados al mismo día (CA-040-02)', async ({
    page,
  }) => {
    const stamp = Date.now()
    const professionalName = `E2E Jornada Partida ${stamp}`

    await login(page, EMAIL, PASSWORD)
    await addProfessional(page, professionalName)

    await openSchedules(page)
    await selectProfessional(page, professionalName)

    await addWorkingHour(page, { weekday: 'Martes', startsTime: '08:00', durationMinutes: '240' })
    await expect(page.getByText('8:00 a. m. – 12:00 p. m.')).toBeVisible()

    await addWorkingHour(page, { weekday: 'Martes', startsTime: '14:00', durationMinutes: '240' })
    await expect(page.getByText('2:00 p. m. – 6:00 p. m.')).toBeVisible()
    await expect(page.getByText('8:00 a. m. – 12:00 p. m.')).toBeVisible()
  })

  test('un tramo que se solapa con otro existente se rechaza sin cerrar el diálogo (CA-040-04)', async ({
    page,
  }) => {
    const stamp = Date.now()
    const professionalName = `E2E Solape ${stamp}`

    await login(page, EMAIL, PASSWORD)
    await addProfessional(page, professionalName)

    await openSchedules(page)
    await selectProfessional(page, professionalName)

    await addWorkingHour(page, {
      weekday: 'Miércoles',
      startsTime: '08:00',
      durationMinutes: '120',
    })
    await expect(page.getByText('8:00 a. m. – 10:00 a. m.')).toBeVisible()

    const dialog = await addWorkingHour(page, {
      weekday: 'Miércoles',
      startsTime: '09:00',
      durationMinutes: '60',
    })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Este tramo se solapa con otro existente')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog).toBeHidden()

    // Nada nuevo se persistió: sigue habiendo un único tramo ese día.
    await page.reload()
    await selectProfessional(page, professionalName)
    await expect(page.getByText('9:00 a. m. – 10:00 a. m.')).not.toBeVisible()
  })

  test('editar un tramo cambia su intervalo, y retirarlo lo elimina de la lista', async ({
    page,
  }) => {
    const stamp = Date.now()
    const professionalName = `E2E Editar Retirar ${stamp}`

    await login(page, EMAIL, PASSWORD)
    await addProfessional(page, professionalName)

    await openSchedules(page)
    await selectProfessional(page, professionalName)
    await addWorkingHour(page, { weekday: 'Jueves', startsTime: '08:00', durationMinutes: '60' })
    await expect(page.getByText('8:00 a. m. – 9:00 a. m.')).toBeVisible()

    await page.getByRole('button', { name: /Editar tramo de Jueves/ }).click()
    const editDialog = page.getByRole('dialog', { name: 'Editar tramo' })
    // 08:00–09:00 pasa a 09:00–10:00: la duración (60 min) se conserva.
    await pickTime(editDialog, page, 'Hora de inicio', '09:00')
    await pickTime(editDialog, page, 'Hora de fin', '10:00')
    await editDialog.getByRole('button', { name: 'Guardar' }).click()
    await expect(editDialog).toBeHidden()
    await expect(page.getByText('9:00 a. m. – 10:00 a. m.')).toBeVisible()
    await expect(page.getByText('8:00 a. m. – 9:00 a. m.')).not.toBeVisible()

    await page.getByRole('button', { name: /Retirar tramo de Jueves/ }).click()
    await expect(page.getByText('9:00 a. m. – 10:00 a. m.')).not.toBeVisible()

    // Persistencia real: recargar confirma que el retiro fue físico, no
    // solo un cambio visual.
    await page.reload()
    await selectProfessional(page, professionalName)
    await expect(page.getByText('9:00 a. m. – 10:00 a. m.')).not.toBeVisible()
  })

  test('un identificador real de otro negocio responde 404 al consultar su horario (RN-TEN-01)', async ({
    page,
  }) => {
    await login(page, EMAIL_B, PASSWORD_B)
    const stamp = Date.now()
    const nameB = `E2E Solo De B ${stamp}`
    await addProfessional(page, nameB)

    const professionalBId = await page.evaluate(async (name) => {
      const res = await fetch('/api/v1/private/professionals?limit=50', { credentials: 'include' })
      const body = (await res.json()) as { items: { id: string; fullName: string }[] }
      return body.items.find((b) => b.fullName === name)?.id ?? null
    }, nameB)
    expect(professionalBId).toBeTruthy()

    // Cambia de sesión al negocio A.
    await page.goto('/acceso')
    await login(page, EMAIL, PASSWORD)

    const crossTenantStatus = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/private/professionals/${id}/working-hours`, {
        credentials: 'include',
      })
      return res.status
    }, professionalBId)
    expect(crossTenantStatus).toBe(404)

    // El selector de A nunca ofrece el profesional de B.
    await openSchedules(page)
    await page.locator('#schedules-professional-select').click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await expect(page.getByRole('option', { name: nameB })).toHaveCount(0)
  })
})
