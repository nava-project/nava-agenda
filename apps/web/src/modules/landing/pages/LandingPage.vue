<script setup lang="ts">
// Landing pública de NAVA (DEC-151): la raíz del sitio. Presenta la
// plataforma y su asistente de IA, ofrece los canales para contratarla y el
// acceso para quien ya tiene cuenta. Es estática: no consulta el API, no lee
// la sesión y no depende de ningún otro módulo.
import AssistantSection from '../components/AssistantSection.vue'
import CapabilitiesSection from '../components/CapabilitiesSection.vue'
import ContactSection from '../components/ContactSection.vue'
import LandingFooter from '../components/LandingFooter.vue'
import LandingHeader from '../components/LandingHeader.vue'
import LandingHero from '../components/LandingHero.vue'
import LandingMarquee from '../components/LandingMarquee.vue'
import '../styles/landing.css'
</script>

<template>
  <div class="ln">
    <a class="ln-skip" href="#contenido">Saltar al contenido</a>
    <LandingHeader />
    <main id="contenido">
      <LandingHero />
      <LandingMarquee />
      <AssistantSection />
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
