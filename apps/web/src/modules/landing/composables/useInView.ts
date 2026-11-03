// Marca un elemento como «visto» la primera vez que entra en pantalla. Sirve
// para que las animaciones de la landing empiecen cuando la persona llega a
// cada sección y no todas a la vez al cargar.
//
// Sin IntersectionObserver (jsdom, navegadores muy viejos) o con
// `prefers-reduced-motion`, el elemento cuenta como visto de inmediato: el
// contenido nunca depende de que una animación se dispare.
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useInView(
  target: Ref<HTMLElement | null>,
  threshold = 0.25,
): { seen: Ref<boolean>; reduced: Ref<boolean> } {
  const seen = ref(false)
  const reduced = ref(false)
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    reduced.value = prefersReducedMotion()
    if (reduced.value || typeof IntersectionObserver === 'undefined' || !target.value) {
      seen.value = true
      return
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          seen.value = true
          observer?.disconnect()
          observer = null
        }
      },
      { threshold },
    )
    observer.observe(target.value)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return { seen, reduced }
}
