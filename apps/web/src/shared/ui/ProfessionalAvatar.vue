<script setup lang="ts">
/**
 * ProfessionalAvatar - Retrato cuadrado de un profesional (issue #189, atlas
 * panel-agenda-eventos evento 12). Desde #799 es el retrato de latón de la
 * familia (BrassMonogram): filete y base de latón, monograma derivado de
 * `fullName` cuando no hay fotografía y, desde el tamaño de fila, el rombo
 * colgante. Siempre decorativo (aria-hidden): el nombre adyacente visible es
 * la identidad accesible, nunca falta junto a un retrato.
 *
 * Con `photoUrl` muestra la fotografía real del profesional (DEC-104, evento 12
 * del atlas); si la imagen no carga (borrada en otro dispositivo, red caída)
 * vuelve sola al monograma, nunca deja un icono de imagen rota.
 *
 * Algoritmo de iniciales idéntico a `StaffPage.vue` (issue #189 lo duplica
 * deliberadamente en vez de extraerlo: StaffPage queda fuera de alcance de
 * esta entrega y migra a este componente en un issue propio).
 */
import { computed, ref, watch } from 'vue'
import BrassMonogram from './BrassMonogram.vue'

interface Props {
  fullName: string
  /** closed: 28px (26px móvil) — selector cerrado. option: 34px (32px
   * móvil) — cada opción de la lista desplegada. row: 52px (44px móvil) —
   * fila de la lista de equipo. hero: 120px (104px móvil) — detalle y
   * edición del profesional. */
  size?: 'closed' | 'option' | 'row' | 'portrait' | 'hero'
  photoUrl?: string | null
  /** Rombo colgante. Por omisión, desde el tamaño de fila; en los selectores
   * (closed, option) no cabe. */
  pendant?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'closed',
  photoUrl: null,
  pendant: undefined,
})

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

const monogram = computed(() => initials(props.fullName))

// Una fotografía que falla al cargar cae al monograma; una URL nueva (otra
// versión de la imagen) vuelve a intentarlo.
const photoFailed = ref(false)
watch(
  () => props.photoUrl,
  () => {
    photoFailed.value = false
  },
)
const showPhoto = computed(() => !!props.photoUrl && !photoFailed.value)

const classes = computed(() => [
  'professional-avatar',
  `professional-avatar--${props.size}`,
  { 'professional-avatar--photo': showPhoto.value },
])

// La serif solo desde 20 px de glifo (#726): retrato y héroe; las filas y los
// selectores van en sans 600.
const face = computed(() => (props.size === 'portrait' || props.size === 'hero' ? 'serif' : 'sans'))
const showPendant = computed(
  () => props.pendant ?? (props.size !== 'closed' && props.size !== 'option'),
)
</script>

<template>
  <BrassMonogram :class="classes" :face="face" :pendant="showPendant">
    <img
      v-if="showPhoto"
      class="professional-avatar__photo"
      :src="photoUrl ?? undefined"
      alt=""
      decoding="async"
      @error="photoFailed = true"
    />
    <span v-else class="professional-avatar__monogram">{{ monogram }}</span>
  </BrassMonogram>
</template>

<style scoped>
.professional-avatar {
  --avatar-size: 28px;
  --monogram-size: var(--avatar-size);
  /* Con border-box el recorte de 2 px come por dentro: por debajo de 8 px el
     rombo queda en un punto. */
  --monogram-pendant: clamp(8px, calc(var(--avatar-size) * 0.17), 9px);
}

/* La foto queda dentro del filete con un paspartú fino, como en la ficha. */
.professional-avatar--photo {
  --monogram-mat: 2px;
}

.professional-avatar--option {
  --avatar-size: 34px;
}

.professional-avatar--row {
  --avatar-size: 52px;
}

.professional-avatar--portrait {
  --avatar-size: 84px;
}

.professional-avatar--portrait.professional-avatar--photo,
.professional-avatar--hero.professional-avatar--photo {
  --monogram-mat: 3px;
}

.professional-avatar--hero {
  --avatar-size: 120px;
}

@media (max-width: 767px) {
  .professional-avatar--closed {
    --avatar-size: 26px;
  }

  .professional-avatar--option {
    --avatar-size: 32px;
  }

  .professional-avatar--row {
    --avatar-size: 44px;
  }

  .professional-avatar--portrait {
    --avatar-size: 72px;
  }

  .professional-avatar--hero {
    --avatar-size: 104px;
  }
}

.professional-avatar__photo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 1px;
}

/* Letra de monograma: sans 600 hasta el tamaño de fila; la serif por debajo
   de 20 px se ensucia (#726). Retrato y héroe la llevan en serif. */
.professional-avatar__monogram {
  font-size: calc(var(--avatar-size) * 0.38);
  line-height: 1;
  white-space: nowrap;
}

.professional-avatar--portrait .professional-avatar__monogram,
.professional-avatar--hero .professional-avatar__monogram {
  font-size: calc(var(--avatar-size) * 0.42);
}
</style>
