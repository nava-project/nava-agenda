<script setup lang="ts">
// Condiciones del servicio públicas (`/terminos`). URL registrada en la
// pantalla de consentimiento de OAuth de Google: debe seguir siendo pública y
// estable.
import LegalDocument from '../components/LegalDocument.vue'
import { termsOfService } from '../model/legalContent'
</script>

<template>
  <LegalDocument :doc="termsOfService" />
</template>
