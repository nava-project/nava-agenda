/**
 * Doble de `useLoaderGrace` para las suites de pantallas (#834).
 *
 * La gracia mide el tiempo real (`Date.now()`): si la respuesta llega después
 * de ~220 ms, la espera se queda a la vista hasta su mínimo. Las suites
 * simulan una red instantánea, pero con el reloj real un Jenkins cargado podía
 * tardar más que eso solo en montar, y la tapa seguía puesta cuando la prueba
 * afirmaba (CI de #832).
 *
 * Con el reloj real, el doble responde como lo que la prueba simula: la red
 * contestó al instante y el cargador no llegó a asomar. Con fake timers
 * (`vi.useFakeTimers()` antes de montar) usa la gracia de verdad, y la prueba
 * recorre sus dos caminos con el reloj bajo control.
 *
 * Uso, en la suite:
 *   vi.mock('@/shared/composables/useLoaderGrace', async (original) =>
 *     (await import('@/shared/composables/__tests__/instantLoaderGrace')).instantLoaderGrace(
 *       await original(),
 *     ),
 *   )
 */
import { vi } from 'vitest'
import type * as LoaderGraceModule from '../useLoaderGrace'

export function instantLoaderGrace(real: typeof LoaderGraceModule): typeof LoaderGraceModule {
  return {
    ...real,
    useLoaderGrace: () =>
      vi.isFakeTimers()
        ? real.useLoaderGrace()
        : { start: () => {}, settled: () => Promise.resolve() },
  }
}
