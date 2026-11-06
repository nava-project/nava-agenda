<script setup lang="ts">
// Política de privacidad pública (`/privacidad`). URL registrada en la pantalla
// de consentimiento de OAuth de Google: debe seguir siendo pública y estable.
import LegalDocument from '../components/LegalDocument.vue'
import { privacyPolicy } from '../model/legalContent'
</script>

<template>
  <LegalDocument :doc="privacyPolicy" />
</template>
