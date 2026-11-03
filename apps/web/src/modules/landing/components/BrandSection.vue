<script setup lang="ts">
// «Tu marca»: NAVA se viste del negocio. La persona elige uno de los seis
// colores de la paleta cerrada de NAVA (DEC-110) y cómo llama a su negocio y
// a su equipo (DEC-119), y la vista previa de la entrada de reservas cambia al
// instante. Es el mismo repertorio real del producto, no una maqueta: los
// colores salen de `BRAND_ACCENTS`. Los controles son radios nativos, así que
// el teclado y los lectores de pantalla funcionan sin ARIA añadido.
import { computed, ref } from 'vue'
import { BRAND_ACCENTS, type BrandAccentKey } from '@/shared/model'
import { useInView } from '../composables/useInView'

interface Preset {
  id: string
  label: string
  name: string
  pro: string
  pros: string
  people: readonly string[]
}

const presets: readonly Preset[] = [
  {
    id: 'barberia',
    label: 'Barbería',
    name: 'Barbería Aurora',
    pro: 'barbero',
    pros: 'barberos',
    people: ['Andrés', 'Julián', 'Camilo'],
  },
  {
    id: 'salon',
    label: 'Salón',
    name: 'Salón Aurora',
    pro: 'estilista',
    pros: 'estilistas',
    people: ['Valeria', 'Lucía', 'Paula'],
  },
  {
    id: 'unas',
    label: 'Estudio de uñas',
    name: 'Estudio Aurora',
    pro: 'manicurista',
    pros: 'manicuristas',
    people: ['Sofía', 'Daniela', 'Karen'],
  },
  {
    id: 'spa',
    label: 'Spa',
    name: 'Spa Aurora',
    pro: 'terapeuta',
    pros: 'terapeutas',
    people: ['Marta', 'Diego', 'Elena'],
  },
]

const root = ref<HTMLElement | null>(null)
const { seen } = useInView(root, 0.2)

const accentKey = ref<BrandAccentKey>('brass')
const presetId = ref('barberia')

const accent = computed(
  () => BRAND_ACCENTS.find((a) => a.key === accentKey.value) ?? BRAND_ACCENTS[0]!,
)
const preset = computed(() => presets.find((p) => p.id === presetId.value) ?? presets[0]!)
</script>

<template>
  <section id="marca" ref="root" class="br" aria-labelledby="br-title">
    <div class="ln-wrap br__grid">
      <div class="br__copy">
        <p class="ln-eyebrow ln-reveal" :data-seen="seen">Tu marca</p>
        <h2 id="br-title" class="ln-title ln-reveal" :data-seen="seen" style="--i: 1">
          Tu negocio, <em>tus palabras, tu color.</em>
        </h2>
        <p class="ln-lead ln-reveal" :data-seen="seen" style="--i: 2">
          NAVA se viste de tu negocio. Elige un color de una paleta pensada para leerse bien y llama
          a tu equipo como tú lo llamas. Pruébalo aquí.
        </p>

        <fieldset class="br__group ln-reveal" :data-seen="seen" style="--i: 3">
          <legend>Color de acento</legend>
          <div class="br__swatches">
            <label v-for="option in BRAND_ACCENTS" :key="option.key" class="br__swatch">
              <input v-model="accentKey" type="radio" name="accent" :value="option.key" />
              <span class="br__chip" :style="{ background: option.ink }"></span>
              <span class="br__name">{{ option.label }}</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="br__group ln-reveal" :data-seen="seen" style="--i: 4">
          <legend>Tu negocio</legend>
          <div class="br__presets">
            <label v-for="option in presets" :key="option.id" class="br__preset">
              <input v-model="presetId" type="radio" name="negocio" :value="option.id" />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </fieldset>
      </div>

      <div class="br__stage ln-reveal" :data-seen="seen" style="--i: 2">
        <p class="ln-sr" role="status">
          Vista previa: {{ preset.name }}, color {{ accent.label }}, con {{ preset.pros }}.
        </p>

        <div class="br__preview" :style="{ '--accent': accent.ink }" aria-hidden="true">
          <div class="br__bar">
            <span class="br__brand">NAVA</span>
            <span class="br__url">nava.app/reservar/aurora</span>
          </div>

          <div class="br__body">
            <p class="br__kicker">Reserva en línea</p>
            <h3>{{ preset.name }}</h3>
            <p class="br__sub">Elige tu {{ preset.pro }} y reserva en un minuto.</p>

            <ul class="br__people">
              <li v-for="(person, i) in preset.people" :key="person" :style="{ '--i': i }">
                <b>{{ person[0] }}</b>
                <span>{{ person }}</span>
                <small>{{ preset.pro }}</small>
              </li>
            </ul>

            <span class="br__cta">Reservar un turno</span>

            <div class="br__progress"><i class="on"></i><i class="on"></i><i></i><i></i></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.br {
  padding: clamp(88px, 12vw, 160px) 0;
}

.br__grid {
  display: grid;
  gap: 64px;
  align-items: center;
}

.br__copy {
  display: grid;
  gap: 24px;
  justify-items: start;
}

.br__group {
  min-width: 0;
  margin: 6px 0 0;
  padding: 0;
  border: 0;
}

.br__group legend {
  margin-bottom: 14px;
  padding: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ln-muted);
}

.br__swatches,
.br__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.br__swatch,
.br__preset {
  position: relative;
  cursor: pointer;
}

.br input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}

.br__swatch {
  display: grid;
  justify-items: center;
  gap: 8px;
  width: 78px;
}

.br__chip {
  width: 48px;
  height: 48px;
  border: 2px solid transparent;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--ln-line-strong);
  transition:
    transform 300ms var(--motion-ease-spring),
    box-shadow 250ms ease;
}

.br__swatch:hover .br__chip {
  transform: scale(1.08);
}

.br__swatch input:checked + .br__chip {
  box-shadow:
    0 0 0 3px var(--ln-ink),
    0 0 0 5px var(--ln-text);
  transform: scale(1.1);
}

.br__swatch input:focus-visible + .br__chip,
.br__preset input:focus-visible + span {
  outline: 2px solid var(--ln-text);
  outline-offset: 5px;
}

.br__name {
  font-size: 15px;
  color: var(--ln-soft);
}

.br__preset span {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 20px;
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-pill);
  font-size: 17px;
  font-weight: 500;
  color: var(--ln-soft);
  transition:
    border-color 220ms ease,
    background-color 220ms ease,
    color 220ms ease;
}

.br__preset:hover span {
  border-color: var(--ln-brass);
}

.br__preset input:checked + span {
  border-color: var(--ln-text);
  background: var(--ln-text);
  color: var(--ln-ink);
}

.br__stage {
  min-width: 0;
}

/* Vista previa: la entrada de reservas, tintada con el acento elegido. */
.br__preview {
  max-width: 560px;
  margin-inline: auto;
  overflow: hidden;
  background: var(--ln-ink-deep);
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 50px 90px -36px
    color-mix(in srgb, var(--color-action-primary-active) 90%, transparent);
}

.br__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--ln-line);
}

.br__brand {
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: 0.14em;
}

.br__url {
  padding: 5px 12px;
  border: 1px solid var(--ln-line);
  border-radius: var(--radius-pill);
  font-size: 13px;
  color: var(--ln-muted);
}

.br__body {
  display: grid;
  gap: 14px;
  padding: 30px 26px 26px;
}

.br__kicker {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
  transition: color 300ms ease;
}

.br__body h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(36px, 5vw, 52px);
  line-height: 1.04;
}

.br__sub {
  margin: 0;
  font-size: 18px;
  color: var(--ln-soft);
}

.br__people {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 8px 0;
  padding: 0;
  list-style: none;
}

.br__people li {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 16px 8px;
  border: 1px solid var(--ln-line);
  border-radius: var(--radius-md);
  animation: br-in 420ms var(--motion-ease-out) backwards;
  animation-delay: calc(var(--i) * 70ms);
}

.br__people b {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 6px;
  border: 1px solid var(--accent);
  border-radius: 50%;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
  color: var(--accent);
  transition:
    color 300ms ease,
    border-color 300ms ease;
}

.br__people span {
  font-size: 16px;
  font-weight: 600;
}

.br__people small {
  font-size: 14px;
  color: var(--ln-muted);
}

.br__cta {
  display: grid;
  place-items: center;
  min-height: 56px;
  border-radius: var(--radius-md);
  background: var(--accent);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-surface-strong);
  transition: background-color 300ms ease;
}

.br__progress {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 6px;
}

.br__progress i {
  width: 9px;
  height: 9px;
  border: 1px solid var(--accent);
  transform: rotate(45deg);
  transition:
    border-color 300ms ease,
    background-color 300ms ease;
}

.br__progress i.on {
  background: var(--accent);
}

@keyframes br-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

@media (min-width: 1020px) {
  .br__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 96px;
  }
}

@media (max-width: 420px) {
  .br__people {
    grid-template-columns: 1fr;
  }

  .br__people li {
    grid-template-columns: 46px 1fr;
    justify-items: start;
    align-items: center;
    column-gap: 14px;
    text-align: left;
  }

  .br__people b {
    grid-row: span 2;
    margin: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .br__chip,
  .br__preset span,
  .br__kicker,
  .br__people b,
  .br__cta,
  .br__progress i {
    transition: none;
  }

  .br__people li {
    animation: none;
  }
}
</style>
