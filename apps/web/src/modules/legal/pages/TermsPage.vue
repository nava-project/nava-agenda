<script setup lang="ts">
// Condiciones del servicio públicas (`/terminos`). URL registrada en la
// pantalla de consentimiento de OAuth de Google: debe seguir siendo pública y
// estable.
import LegalDocument from '../components/LegalDocument.vue'
import { termsOfService } from '../model/legalContent'
import { LEGAL_PRIVACY_PATH } from '../routes'

const next = { to: LEGAL_PRIVACY_PATH, label: 'Política de privacidad' }
</script>

<template>
  <LegalDocument :doc="termsOfService" :next="next" />
</template>
