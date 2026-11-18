import { test, expect, type Page } from '@playwright/test'

/**
 * Recorrido E2E de HU-023 (asignación de servicios a profesionales). Corre contra
 * el API real en local (`go run ./cmd/api` sobre PostgreSQL real con las
 * doce migraciones aplicadas y un usuario con un hash argon2id REAL, mismo
 * criterio que `e2e/profesionales.spec.ts`/`e2e/servicios.spec.ts`).
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

async function openProfessionalServices(page: Page) {
  await page.getByRole('link', { name: 'Servicios por barbero' }).click()
  await expect(page).toHaveURL(/\/panel\/servicios-por-profesional$/)
  await expect(page.getByRole('heading', { name: 'Servicios por barbero' })).toBeVisible()
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

async function addService(page: Page, name: string) {
  await page.getByRole('link', { name: 'Servicios', exact: true }).click()
  await expect(page).toHaveURL(/\/panel\/servicios$/)
  await page.getByRole('button', { name: 'Agregar servicio' }).click()
  const dialog = page.getByRole('dialog', { name: 'Agregar servicio' })
  await dialog.getByLabel('Nombre').fill(name)
  await dialog.getByLabel('Duración (minutos)').fill('30')
  await dialog.getByLabel('Precio (COP)').fill('20000.00')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('Asignación de servicios a profesionales (HU-023)', () => {
  // Serial a propósito: varias pruebas comparten el mismo negocio real
  // (shopA/shopB, sin aprovisionamiento de negocios nuevos en esta
  // historia); ejecutarlas en paralelo produciría una carrera entre sus
  // propias escrituras, no un defecto del producto.
  test.describe.configure({ mode: 'serial' })

  test('asignar un servicio a un profesional aparece marcado tras recargar (CA-023-02)', async ({
    page,
  }) => {
    const stamp = Date.now()
    const professionalName = `E2E Barbero Asig ${stamp}`
    const serviceName = `E2E Servicio Asig ${stamp}`

    await login(page, EMAIL, PASSWORD)
    await addProfessional(page, professionalName)
    await addService(page, serviceName)

    await openProfessionalServices(page)
    await page.getByLabel('Barbero', { exact: true }).selectOption({ label: professionalName })

    const checkbox = page.getByRole('checkbox', { name: serviceName })
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await expect(checkbox).toBeChecked()

    // Persistencia real: recargar y volver a seleccionar el mismo profesional
    // debe mostrar la casilla todavía marcada.
    await page.reload()
    await page.getByLabel('Barbero', { exact: true }).selectOption({ label: professionalName })
    await expect(page.getByRole('checkbox', { name: serviceName })).toBeChecked()
  })

  test('un mismo servicio se asigna a varios profesionales, cada uno como un recurso independiente (CA-023-03)', async ({
    page,
  }) => {
    const stamp = Date.now()
    const professionalOne = `E2E Compartido Uno ${stamp}`
    const professionalTwo = `E2E Compartido Dos ${stamp}`
    const serviceName = `E2E Servicio Compartido ${stamp}`

    await login(page, EMAIL, PASSWORD)
    await addProfessional(page, professionalOne)
    await addProfessional(page, professionalTwo)
    await addService(page, serviceName)

    await openProfessionalServices(page)

    await page.getByLabel('Barbero', { exact: true }).selectOption({ label: professionalOne })
    await page.getByRole('checkbox', { name: serviceName }).check()
    await expect(page.getByRole('checkbox', { name: serviceName })).toBeChecked()

    await page.getByLabel('Barbero', { exact: true }).selectOption({ label: professionalTwo })
    await expect(page.getByRole('checkbox', { name: serviceName })).not.toBeChecked()
    await page.getByRole('checkbox', { name: serviceName }).check()
    await expect(page.getByRole('checkbox', { name: serviceName })).toBeChecked()

    // El primero conserva su propia asignación, sin que la del segundo la
    // haya afectado (cada asociación es un recurso independiente).
    await page.getByLabel('Barbero', { exact: true }).selectOption({ label: professionalOne })
    await expect(page.getByRole('checkbox', { name: serviceName })).toBeChecked()
  })

  test('retirar la última asignación de un servicio se permite y la casilla queda desmarcada (DEC-114, CA-023-05)', async ({
    page,
  }) => {
    const stamp = Date.now()
    const professionalName = `E2E Última Asignación ${stamp}`
    const serviceName = `E2E Servicio Última ${stamp}`

    await login(page, EMAIL, PASSWORD)
    await addProfessional(page, professionalName)
    await addService(page, serviceName)

    await openProfessionalServices(page)
    await page.getByLabel('Barbero', { exact: true }).selectOption({ label: professionalName })

    const checkbox = page.getByRole('checkbox', { name: serviceName })
    await checkbox.check()
    await expect(checkbox).toBeChecked()

    // Único profesional asignado a este servicio recién creado: retirarlo es
    // válido, sin mensaje de error, y el cambio persiste al recargar.
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    await expect(page.getByRole('alert')).toHaveCount(0)

    await page.reload()
    await page.getByLabel('Barbero', { exact: true }).selectOption({ label: professionalName })
    await expect(page.getByRole('checkbox', { name: serviceName })).not.toBeChecked()
  })

  test('un identificador real de otro negocio responde 404 al consultar sus asignaciones (CA-023-04)', async ({
    page,
  }) => {
    // Crea un profesional real en el negocio B para tener un id real que
    // consultar desde el contexto de A.
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
      const res = await fetch(`/api/v1/private/professionals/${id}/services`, {
        credentials: 'include',
      })
      return res.status
    }, professionalBId)
    expect(crossTenantStatus).toBe(404)

    // El selector de A nunca ofrece el profesional de B.
    await openProfessionalServices(page)
    await expect(
      page.getByLabel('Barbero', { exact: true }).locator('option', { hasText: nameB }),
    ).toHaveCount(0)
  })
})
