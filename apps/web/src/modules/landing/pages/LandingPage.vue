<script setup lang="ts">
// Landing pública de NAVA (DEC-151): la raíz del sitio. Presenta la
// plataforma y su asistente de IA, ofrece los canales para contratarla y el
// acceso para quien ya tiene cuenta. Es estática: no consulta el API, no lee
// la sesión y no depende de ningún otro módulo.
import { onBeforeUnmount, onMounted } from 'vue'
import AssistantSection from '../components/AssistantSection.vue'
import BrandSection from '../components/BrandSection.vue'
import CapabilitiesSection from '../components/CapabilitiesSection.vue'
import ContactSection from '../components/ContactSection.vue'
import JourneySection from '../components/JourneySection.vue'
import LandingFooter from '../components/LandingFooter.vue'
import LandingHeader from '../components/LandingHeader.vue'
import LandingHero from '../components/LandingHero.vue'
import LandingMarquee from '../components/LandingMarquee.vue'
import LandingRail from '../components/LandingRail.vue'
import { useScrollSpy } from '../composables/useScrollSpy'
import '../styles/landing.css'

// Las secciones del recorrido, en orden de aparición: alimentan la guía de
// lectura (hilo con rombos) y el cálculo de la sección activa.
const sections = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'asistente', label: 'Asistente de IA' },
  { id: 'dia', label: 'Un día con NAVA' },
  { id: 'marca', label: 'Tu marca' },
  { id: 'plataforma', label: 'Plataforma' },
  { id: 'contacto', label: 'Contacto' },
] as const

const { progress, active } = useScrollSpy(sections.map((section) => section.id))

// El scroll de la landing es el de la app: la clase estila la barra del
// documento (latón sobre tinta) solo mientras esta página está montada.
onMounted(() => document.documentElement.classList.add('ln-root'))
onBeforeUnmount(() => document.documentElement.classList.remove('ln-root'))
</script>

<template>
  <div class="ln">
    <a class="ln-skip" href="#contenido">Saltar al contenido</a>
    <LandingRail :progress="progress" :active="active" :sections="sections" />
    <LandingHeader />
    <main id="contenido">
      <LandingHero />
      <LandingMarquee />
      <AssistantSection />
      <JourneySection />
      <BrandSection />
      <CapabilitiesSection />
      <ContactSection />
    </main>
    <LandingFooter />
  </div>
</template>

<style scoped>
.ln-skip {
  position: fixed;
  top: -60px;
  left: 16px;
  z-index: 30;
  padding: 12px 18px;
  border-radius: var(--radius-md);
  background: var(--ln-brass);
  color: var(--color-brand-accent-text);
  font-weight: 600;
  text-decoration: none;
  transition: top 160ms ease;
}

.ln-skip:focus {
  top: 12px;
}
</style>
