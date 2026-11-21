import { type Page } from '@playwright/test'
import { pickTime, selectProfessional } from './horarios-controles'
import { PROFESSIONAL_B, expect, openSchedules, test } from './horarios-sesion'

/**
 * Recorrido E2E de HU-040 (horario laboral recurrente) contra el API real y
 * PostgreSQL real. Datos, sesión y limpieza: ./horarios-sesion.ts y
 * database/testdata/ui_horarios_766.sql (#766). Cada proyecto trabaja sobre su
 * propio profesional y el fixture retira lo creado aunque la prueba falle.
 */
test.use({ scheduleSpec: 'horarios' })

// El tramo en el tablero. Texto exacto: el diálogo cerrado conserva en el DOM su
// «Así queda» («Lunes · 8:00 a. m. – 12:00 p. m. · 4 h»).
const slot = (page: Page, text: string) => page.getByText(text, { exact: true })

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
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    const dialog = await addWorkingHour(page, {
      weekday: 'Lunes',
      startsTime: '08:00',
      durationMinutes: '240',
    })
    await expect(dialog).toBeHidden()
    await expect(slot(page, '8:00 a. m. – 12:00 p. m.')).toBeVisible()

    await page.reload()
    await selectProfessional(page, professional.name)
    await expect(slot(page, '8:00 a. m. – 12:00 p. m.')).toBeVisible()
  })

  test('una jornada partida agrega dos tramos no solapados al mismo día (CA-040-02)', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    await addWorkingHour(page, { weekday: 'Martes', startsTime: '08:00', durationMinutes: '240' })
    await expect(slot(page, '8:00 a. m. – 12:00 p. m.')).toBeVisible()

    await addWorkingHour(page, { weekday: 'Martes', startsTime: '14:00', durationMinutes: '240' })
    await expect(slot(page, '2:00 p. m. – 6:00 p. m.')).toBeVisible()
    await expect(slot(page, '8:00 a. m. – 12:00 p. m.')).toBeVisible()
  })

  test('un tramo que se solapa con otro existente se rechaza sin cerrar el diálogo (CA-040-04)', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)

    await addWorkingHour(page, {
      weekday: 'Miércoles',
      startsTime: '08:00',
      durationMinutes: '120',
    })
    await expect(slot(page, '8:00 a. m. – 10:00 a. m.')).toBeVisible()

    const dialog = await addWorkingHour(page, {
      weekday: 'Miércoles',
      startsTime: '09:00',
      durationMinutes: '60',
    })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Este tramo se solapa con otro existente')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
    await expect(dialog).toBeHidden()

    // Nada nuevo se persistió: sigue habiendo un único tramo ese día.
    await page.reload()
    await selectProfessional(page, professional.name)
    await expect(slot(page, '9:00 a. m. – 10:00 a. m.')).not.toBeVisible()
  })

  test('editar un tramo cambia su intervalo, y retirarlo lo elimina de la lista', async ({
    page,
    professional,
  }) => {
    await openSchedules(page)
    await selectProfessional(page, professional.name)
    await addWorkingHour(page, { weekday: 'Jueves', startsTime: '08:00', durationMinutes: '60' })
    await expect(slot(page, '8:00 a. m. – 9:00 a. m.')).toBeVisible()

    await page.getByRole('button', { name: /Editar tramo de Jueves/ }).click()
    const editDialog = page.getByRole('dialog', { name: 'Editar tramo' })
    // 08:00–09:00 pasa a 09:00–10:00: la duración (60 min) se conserva.
    await pickTime(editDialog, page, 'Hora de inicio', '09:00')
    await pickTime(editDialog, page, 'Hora de fin', '10:00')
    await editDialog.getByRole('button', { name: 'Guardar' }).click()
    await expect(editDialog).toBeHidden()
    await expect(slot(page, '9:00 a. m. – 10:00 a. m.')).toBeVisible()
    await expect(slot(page, '8:00 a. m. – 9:00 a. m.')).not.toBeVisible()

    await page.getByRole('button', { name: /Retirar tramo de Jueves/ }).click()
    await expect(slot(page, '9:00 a. m. – 10:00 a. m.')).not.toBeVisible()

    // Persistencia real: recargar confirma que el retiro fue físico, no
    // solo un cambio visual.
    await page.reload()
    await selectProfessional(page, professional.name)
    await expect(slot(page, '9:00 a. m. – 10:00 a. m.')).not.toBeVisible()
  })

  test('un identificador real de otro negocio responde 404 al consultar su horario (RN-TEN-01)', async ({
    page,
    pageB,
    professional,
  }) => {
    // El profesional de B es real: su propio negocio lo lee.
    const own = await pageB.request.get(
      `/api/v1/private/professionals/${PROFESSIONAL_B}/working-hours`,
    )
    expect(own.status()).toBe(200)

    // Desde la sesión de A, el mismo identificador no existe.
    const crossTenant = await page.request.get(
      `/api/v1/private/professionals/${PROFESSIONAL_B}/working-hours`,
    )
    expect(crossTenant.status()).toBe(404)

    // El selector de A nunca ofrece el profesional de B.
    await openSchedules(page)
    await page.locator('#schedules-professional-select').click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await expect(page.getByRole('option', { name: professional.name })).toHaveCount(1)
    await expect(page.getByRole('option', { name: 'Solo del negocio B' })).toHaveCount(0)
  })
})
