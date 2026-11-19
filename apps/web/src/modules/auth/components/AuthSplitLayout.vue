<script setup lang="ts">
// Marco del acceso y la recuperación del profesional, v2 «La luz del día»
// (DEC-188, entrega 3). Reemplaza el panel de tinta con la mesa de patronaje.
//
// - El cielo de la marca: en escritorio (>= 1024 px) ocupa la columna izquierda; en
//   móvil es una banda sobre el formulario. La llegada es el cielo pasando de la
//   noche al alba mientras el sol del logo sale (< 1,2 s). Solo usa opacity y
//   transform; el formulario no se anima y se usa desde el primer cuadro. Un clic o
//   una tecla terminan la llegada; con movimiento reducido se ve el final directo.
// - «Volver» lleva a la sección de Agenda de la presentación (nava.wtf/#agenda), de
//   donde viene quien entra desde la landing. Su nombre accesible dice adónde va.
//
// El cielo es decorativo (`aria-hidden`); cada página conserva su estado y su `<h1>`.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NAVA_AGENDA_URL, NAVA_PRIVACY_URL, NAVA_TERMS_URL } from '@/shared/model/navaSite'
import { AgendaLogo } from '@/shared/ui'
import '../styles/authV2.css'

interface Props {
  /** Frase del cielo, en escritorio. */
  tagline?: string
}

withDefaults(defineProps<Props>(), {
  tagline: 'Tu agenda y tu equipo, a la luz del día.',
})

// La llegada se termina con cualquier gesto: nunca hace esperar.
const settled = ref(false)
const settle = () => {
  settled.value = true
  window.removeEventListener('pointerdown', settle)
  window.removeEventListener('keydown', settle)
}
onMounted(() => {
  window.addEventListener('pointerdown', settle, { once: true })
  window.addEventListener('keydown', settle, { once: true })
})
onBeforeUnmount(settle)
</script>

<template>
  <main class="auth-split au" :class="{ 'au--settled': settled }">
    <div class="au-sky" aria-hidden="true">
      <span class="au-sky__dawn"></span>
      <span class="au-sky__night"></span>
      <span class="au-sky__glow"></span>
      <span class="au-sky__sun"><AgendaLogo /></span>
      <span class="au-sky__horizon"></span>
      <p class="au-sky__tagline">{{ tagline }}</p>
    </div>

    <div class="au-col">
      <nav class="au-top" aria-label="Sitio">
        <a class="au-back" :href="NAVA_AGENDA_URL" aria-label="Volver a Nava Agenda en nava.wtf">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Volver
        </a>
      </nav>

      <div class="au-card">
        <slot />
        <nav class="au-legal" aria-label="Documentos legales">
          <a :href="NAVA_PRIVACY_URL">Privacidad</a>
          <a :href="NAVA_TERMS_URL">Condiciones</a>
        </nav>
      </div>
    </div>
  </main>
</template>
