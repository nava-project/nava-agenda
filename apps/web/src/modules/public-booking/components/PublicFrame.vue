<script setup lang="ts">
// Marco público v2 (DEC-188) para las pantallas del cliente que viven fuera del
// cascarón de la reserva: «Mi turno», «Cambiar la hora» y el acceso con código
// (módulo customer-access). Pone la misma cabecera, con el negocio como
// jerarquía principal, y el mismo pie con la firma NAVA que la reserva, para que
// el cliente sienta un solo recorrido.
//
// Es solo marco: no lee rutas ni perfiles, y cada pantalla conserva su `<main>`,
// su estado y su `<h1>`. Sin RouterLink, para que las páginas se prueben sin
// router.
import { NAVA_PRIVACY_URL, NAVA_TERMS_URL } from '@/shared/model/navaSite'
import { NavaWordmark } from '@/shared/ui'
import '../styles/publicBooking.css'
import '../styles/bookingV2.css'

interface Props {
  /** Nombre del negocio; vacío mientras carga o si el enlace no se resolvió. */
  businessName?: string
  /** Etiqueta discreta a la derecha de la cabecera («Tu turno»). */
  caption?: string
}
withDefaults(defineProps<Props>(), { businessName: '', caption: '' })
</script>

<template>
  <div class="pb-layout bk bk-frame">
    <header class="bk-top">
      <div class="bk-top__inner">
        <slot name="lead">
          <span v-if="businessName" class="bk-top__business">{{ businessName }}</span>
          <span v-else class="bk-top__spacer" aria-hidden="true"></span>
        </slot>
        <slot name="aside">
          <span v-if="caption" class="bk-frame__caption">{{ caption }}</span>
        </slot>
      </div>
    </header>

    <slot />

    <footer class="bk-foot">
      <a
        class="bk-foot__firm"
        href="https://nava.wtf/#agenda"
        aria-label="Reservas con Nava Agenda, en nava.wtf"
      >
        <span>Reservas con</span>
        <NavaWordmark size="sm" />
      </a>
      <nav class="bk-foot__legal" aria-label="Documentos legales">
        <a :href="NAVA_PRIVACY_URL">Privacidad</a>
        <a :href="NAVA_TERMS_URL">Condiciones</a>
      </nav>
    </footer>
  </div>
</template>

<style scoped>
.bk-frame__caption {
  flex: none;
  font-size: 14px;
  color: var(--color-text-secondary);
}
</style>
