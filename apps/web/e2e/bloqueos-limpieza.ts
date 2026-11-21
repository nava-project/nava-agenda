import { test as base, expect } from '@playwright/test'

/**
 * Limpieza de los E2E de bloqueos (#764). Cada bloqueo o serie que la página crea
 * queda registrado en cuanto el servidor responde 201 y se retira en el desmontaje
 * del fixture. Solo ve el tráfico de la página (la UI o un `fetch` dentro de
 * `page.evaluate`): `page.request` es un APIRequestContext aparte, así que lo que
 * se cree por esa vía hay que registrarlo con `retireCreatedBlocks.track(path)`.
 *
 * Antes la retirada vivía en el `finally` del propio test: si el test agotaba su
 * tiempo, el `delete` quedaba cortado y la serie seguía viva para la siguiente
 * corrida (y para el otro spec, que comparte la profesional dedicada de #286).
 * El desmontaje corre aunque el test falle a medias y tiene su propio tiempo.
 */
const CREATED = /\/api\/v1\/private\/professionals\/[0-9a-f-]+\/(time-blocks|time-block-series)$/
// «Esta fecha y las siguientes» parte la serie con un PATCH que responde la serie
// nueva: también hay que retirarla.
const SPLIT = /^(\/api\/v1\/private\/professionals\/[0-9a-f-]+\/time-block-series)\/([0-9a-f-]+)$/

export interface CreatedBlocks {
  /** Registra un recurso creado fuera de la página, p. ej. `…/time-blocks/<id>`. */
  track(resource: string): void
}

export const test = base.extend<{ retireCreatedBlocks: CreatedBlocks }>({
  retireCreatedBlocks: [
    async ({ page }, use) => {
      const created: string[] = []
      const reading: Promise<void>[] = []
      page.on('response', (response) => {
        const request = response.request()
        const path = new URL(response.url()).pathname
        let collection: string | undefined
        let previousId: string | undefined
        if (request.method() === 'POST' && response.status() === 201 && CREATED.test(path)) {
          collection = path
        } else if (request.method() === 'PATCH' && response.status() === 200) {
          const split = SPLIT.exec(path)
          if (split) [, collection, previousId] = split
        }
        if (!collection) return
        reading.push(
          response
            .json()
            .then((body: { id?: string }) => {
              if (body?.id && body.id !== previousId) created.push(`${collection}/${body.id}`)
            })
            .catch(() => undefined),
        )
      })

      await use({ track: (resource) => created.push(resource) })
      // Un 201 que llegó justo al final todavía puede estar leyéndose.
      await Promise.all(reading)

      // Retiro lógico (RN-BLQ-04). 404 es aceptable: el test ya lo retiró.
      for (const resource of created.reverse()) {
        const response = await page.request.delete(resource)
        expect([204, 404], `retirar ${resource}`).toContain(response.status())
      }
    },
    { auto: true, timeout: 30_000 },
  ],
})

export { expect }
