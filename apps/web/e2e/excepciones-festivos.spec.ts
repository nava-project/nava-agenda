import { type Page } from '@playwright/test'
import { openAsidePanel, pickDate, pickTime, selectProfessional } from './horarios-controles'
import { PROFESSIONAL_B, expect, openSchedules, test } from './horarios-sesion'

/**
 * Recorrido E2E de HU-041 (excepciones de jornada y festivos colombianos) contra
 * el API real y PostgreSQL real. Datos, sesión y limpieza: ./horarios-sesion.ts y
 * database/testdata/ui_horarios_766.sql (#766). El fixture retira las excepciones
 * creadas y devuelve el calendario de festivos a su valor inicial, aunque la
 * prueba falle.
 */
test.use({ scheduleSpec: 'festivos' })

// El diálogo cerrado conserva su contenido en el DOM (la fecha elegida sigue
// escrita en su selector): los textos de la lista se buscan dentro de ella.
const exceptionList = (page: Page) => page.getByRole('list', { name: 'Excepciones de jornada' })

async function addException(
  page: Page,
  { effectiveDate, closed }: { effectiveDate: string; closed: boolean },
) {
  await page.getByRole('button', { name: 'Agregar excepción' }).click()
  const dialog = page.getByRole('dialog', { name: 'Agregar excepción' })
  await pickDate(page, 'schedules-create-date', effectiveDate)
  if (!closed) {
    await dialog.getByLabel('Abierto con tramos especiales').check()
  }
  return dialog
}

test.describe('Excepciones de jornada y festivos (HU-041)', () => {
  // Serial a propósito: varias pruebas comparten el mismo negocio real
  // (shopA/shopB), mismo criterio que horarios.spec.ts.
  test.describe.configure({ mode: 'serial' })

  test('activar el calendario de festivos persiste tras recargar (CA-041-01/02)', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    // Los festivos viven en un apartado del acordeón lateral: hay que abrirlo.
    await openAsidePanel(page, 'Calendario de festivos colombianos')
    // El final del rótulo sale del vocabulario del negocio («de este barbero»,
    // «de este profesional»…): solo se fija el principio.
    const toggle = page.getByLabel(/^Cerrar automáticamente los festivos colombianos/)
    await expect(toggle).not.toBeChecked()
    // El input es el control accesible pero va oculto bajo el interruptor
    // dibujado: se pulsa el rótulo visible, como lo haría una persona.
    await page.locator('.schedules-switch__text').click()
    await expect(toggle).toBeChecked()

    await page.reload()
    await selectProfessional(page, professional.name)
    await openAsidePanel(page, 'Calendario de festivos colombianos')
    await expect(toggle).toBeChecked()
  })

  test('agregar una excepción cerrada persiste tras recargar (CA-041-04)', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    const dialog = await addException(page, { effectiveDate: '2027-12-08', closed: true })
    await dialog.getByRole('button', { name: 'Guardar' }).click()
    await expect(dialog).toBeHidden()
    await expect(exceptionList(page).getByText('2027-12-08')).toBeVisible()
    await expect(exceptionList(page).getByText('Cerrado')).toBeVisible()

    await page.reload()
    await selectProfessional(page, professional.name)
    await expect(exceptionList(page).getByText('2027-12-08')).toBeVisible()
  })

  test('agregar una excepción abierta con un tramo especial persiste (CA-041-04)', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    const dialog = await addException(page, { effectiveDate: '2027-07-20', closed: false })
    await pickTime(dialog, page, 'Hora de inicio', '09:00')
    // El tramo especial se pide de inicio a fin, como los tramos de la semana.
    await pickTime(dialog, page, 'Hora de fin', '12:00')
    await dialog.getByRole('button', { name: 'Guardar' }).click()
    await expect(dialog).toBeHidden()
    await expect(exceptionList(page).getByText('9:00 a. m. – 12:00 p. m.')).toBeVisible()
  })

  test('una fecha duplicada se rechaza sin cerrar el diálogo (CA-041-05)', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    const first = await addException(page, { effectiveDate: '2027-12-25', closed: true })
    await first.getByRole('button', { name: 'Guardar' }).click()
    await expect(first).toBeHidden()

    const second = await addException(page, { effectiveDate: '2027-12-25', closed: true })
    await second.getByRole('button', { name: 'Guardar' }).click()
    await expect(second).toBeVisible()
    await expect(second.getByText('Ya existe una excepción para esa fecha')).toBeVisible()
    await second.getByRole('button', { name: 'Cerrar diálogo' }).click()
    await expect(second).toBeHidden()
  })

  test('editar una excepción cambia su fecha, y retirarla la elimina de la lista', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    const dialog = await addException(page, { effectiveDate: '2027-05-01', closed: true })
    await dialog.getByRole('button', { name: 'Guardar' }).click()
    await expect(dialog).toBeHidden()
    await expect(exceptionList(page).getByText('2027-05-01')).toBeVisible()

    await page.getByRole('button', { name: /Editar excepción del 2027-05-01/ }).click()
    const editDialog = page.getByRole('dialog', { name: 'Editar excepción' })
    await pickDate(page, 'schedules-edit-date', '2027-05-02')
    await editDialog.getByRole('button', { name: 'Guardar' }).click()
    await expect(editDialog).toBeHidden()
    await expect(exceptionList(page).getByText('2027-05-02')).toBeVisible()
    await expect(exceptionList(page).getByText('2027-05-01')).not.toBeVisible()

    await page.getByRole('button', { name: /Retirar excepción del 2027-05-02/ }).click()
    await expect(exceptionList(page).getByText('2027-05-02')).not.toBeVisible()

    await page.reload()
    await selectProfessional(page, professional.name)
    await expect(exceptionList(page).getByText('2027-05-02')).not.toBeVisible()
  })

  test('un identificador real de otro negocio responde 404 al consultar el calendario de festivos (RN-TEN-01)', async ({
    page,
    pageB,
    professional,
  }) => {
    const path = `/api/v1/private/professionals/${PROFESSIONAL_B}/holiday-calendar`
    // El profesional de B es real: su propio negocio lo lee.
    expect((await pageB.request.get(path)).status()).toBe(200)
    // A lee el suyo, pero el de B no existe para A.
    const own = `/api/v1/private/professionals/${professional.id}/holiday-calendar`
    expect((await page.request.get(own)).status()).toBe(200)
    expect((await page.request.get(path)).status()).toBe(404)
  })
})
