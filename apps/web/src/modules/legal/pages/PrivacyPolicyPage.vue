<script setup lang="ts">
// Política de privacidad pública (`/privacidad`). URL registrada en la pantalla
// de consentimiento de OAuth de Google: debe seguir siendo pública y estable.
import LegalDocument from '../components/LegalDocument.vue'
import { privacyPolicy } from '../model/legalContent'
import { LEGAL_TERMS_PATH } from '../routes'

const next = { to: LEGAL_TERMS_PATH, label: 'Condiciones del servicio' }
</script>

<template>
  <LegalDocument :doc="privacyPolicy" :next="next" />
</template>
