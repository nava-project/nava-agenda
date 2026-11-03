// Progreso de lectura (0–1) y sección activa de la landing. Una sola escucha
// de `scroll` pasiva con requestAnimationFrame: escribe dos refs por cuadro y
// nada más. La sección activa es la última cuya parte superior ya pasó el
// tercio superior de la ventana, que es lo que la persona está leyendo.
import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useScrollSpy(ids: readonly string[]) {
  const progress = ref(0)
  const active = ref(ids[0] ?? '')
  let frame = 0

  function measure() {
    frame = 0
    const doc = document.documentElement
    const max = doc.scrollHeight - window.innerHeight
    progress.value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0

    const line = window.innerHeight * 0.34
    let current = ids[0] ?? ''
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el && el.getBoundingClientRect().top <= line) current = id
    }
    active.value = current
  }

  function onScroll() {
    if (!frame) frame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    if (frame) cancelAnimationFrame(frame)
  })

  return { progress, active }
}
