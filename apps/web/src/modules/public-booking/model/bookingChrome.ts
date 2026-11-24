// Canal entre una pantalla de la reserva pública y el cascarón que la
// aloja (`layouts/PublicBookingLayout.vue`). El cascarón dibuja el progreso
// y el enlace de retorno a partir de la ruta, pero no sabe cuándo el turno
// ya quedó confirmado: solo la página de datos lo sabe. Es un `provide`/
// `inject` acotado a este árbol, no estado global: sin cascarón (pruebas de
// componente en aislamiento) `useBookingChrome` devuelve un canal inerte.
import { inject, onBeforeUnmount, ref, type InjectionKey, type Ref } from 'vue'

export interface BookingChrome {
  /** Verdadero cuando el servidor ya confirmó el turno: el progreso se
   * completa y el enlace de retorno deja de ofrecerse, porque volver atrás
   * ya no cambiaría nada. */
  completed: Ref<boolean>
  /** Dónde se acopla, en el teléfono, la barra fija de una pantalla (el pase
   * de «Día y hora», H9 #827): fuera del `main` que se desliza al entrar. */
  fixedDock?: string
}

export const bookingChromeKey: InjectionKey<BookingChrome> = Symbol('bookingChrome')

/** El destino de la barra fija, o `null` sin cascarón. */
export function bookingFixedDock(): string | null {
  return inject(bookingChromeKey, null)?.fixedDock ?? null
}

export function useBookingChrome(): BookingChrome {
  const chrome = inject(bookingChromeKey, null) ?? { completed: ref(false) }
  // El cascarón sobrevive entre pasos: una confirmación de la visita
  // anterior no debe dejar el progreso completo en la siguiente pantalla.
  onBeforeUnmount(() => {
    chrome.completed.value = false
  })
  return chrome
}
