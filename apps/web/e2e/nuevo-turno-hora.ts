import { expect, type Page } from '@playwright/test'
import { pickDate, pickTime } from './horarios-controles'

/**
 * «Otra hora» de «Nuevo turno» (#717): la hora del turno se elige sobre los
 * inicios libres y, como salida secundaria, se escribe a mano con el calendario
 * y el selector de 12 h. Los recorridos que necesitan un instante exacto (en el
 * pasado, fuera de la rejilla o de unos datos de prueba concretos) pasan por
 * aquí en vez de escribir en campos nativos.
 */
export async function fillManualStart(page: Page, date: string, time: string): Promise<void> {
  await page
    .getByRole('button', { name: /^Otra hora/ })
    .first()
    .click()
  await pickDate(page, 'new-appointment-date', date)
  await pickTime(page.locator('.manual-start'), page, 'Hora del turno', time)
  // El panel de la hora se cierra al aplicar; hasta entonces sus botones
  // (p. ej. «Cancelar») comparten nombre con los de la página.
  await expect(page.getByRole('dialog', { name: 'Hora del turno' })).toHaveCount(0)
}

/**
 * «Otra hora» de «Reprogramar turno» (#776): el mismo selector, dentro del
 * diálogo, con sus propios ids y rótulos («Nueva fecha», «Nueva hora»).
 */
export async function fillRescheduleStart(page: Page, date: string, time: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Reprogramar turno' })
  await dialog
    .getByRole('button', { name: /^Otra hora/ })
    .first()
    .click()
  await pickDate(page, 'reschedule-date', date)
  await pickTime(dialog.locator('.manual-start'), page, 'Nueva hora', time)
  await expect(page.getByRole('dialog', { name: 'Nueva hora' })).toHaveCount(0)
}
