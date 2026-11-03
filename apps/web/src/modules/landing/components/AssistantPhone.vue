<script setup lang="ts">
// Teléfono con el asistente de IA conversando. Reproduce una charla de
// demostración (ficticia) cuando la sección entra en pantalla: el cliente
// escribe, el asistente «teclea» y contesta con horas libres como fichas,
// y la conversación se reinicia tras una pausa. La animación es decorativa
// y va oculta a las tecnologías de apoyo; el mismo diálogo está completo y
// en orden como lista de texto para lectores de pantalla.
//
// Con `prefers-reduced-motion` no hay secuencia ni bucle: la conversación
// aparece entera y quieta.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { assistantDemo } from '../model/landingContent'
import { useInView } from '../composables/useInView'

const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const { seen, reduced } = useInView(root, 0.35)

const shown = ref(0)
const typing = ref(false)
const timers: number[] = []

function later(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms))
}

function clearTimers() {
  timers.splice(0).forEach((id) => window.clearTimeout(id))
}

async function stickToBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

function play() {
  clearTimers()
  shown.value = 0
  typing.value = false
  let t = 700
  assistantDemo.forEach((line, index) => {
    if (line.from === 'assistant') {
      later(t, () => {
        typing.value = true
        void stickToBottom()
      })
      t += 1500
    } else {
      t += 400
    }
    later(t, () => {
      typing.value = false
      shown.value = index + 1
      void stickToBottom()
    })
    t += 1300
  })
  // Pausa para leer el final y vuelta a empezar.
  later(t + 4200, play)
}

watch(seen, (value) => {
  if (!value) return
  if (reduced.value) {
    shown.value = assistantDemo.length
    return
  }
  play()
})

onBeforeUnmount(clearTimers)
</script>

<template>
  <figure ref="root" class="ph">
    <figcaption class="ln-sr">Ejemplo de conversación con el asistente de IA de NAVA.</figcaption>
    <ol class="ln-sr">
      <li v-for="(line, i) in assistantDemo" :key="i">
        {{ line.from === 'client' ? 'Cliente' : 'Asistente' }}: {{ line.text }}
        <template v-if="line.slots"> Horas libres: {{ line.slots.join(', ') }}.</template>
      </li>
    </ol>

    <div class="ph__device" aria-hidden="true">
      <span class="ph__notch"></span>

      <div class="ph__bar">
        <span class="ph__avatar"><i></i></span>
        <span class="ph__name">
          <b>Asistente de NAVA</b>
          <small><i class="ph__online"></i>En línea · responde al instante</small>
        </span>
        <span class="ph__badge">IA</span>
      </div>

      <div ref="scroller" class="ph__chat">
        <TransitionGroup name="ph-msg" tag="div" class="ph__list">
          <div
            v-for="(line, i) in assistantDemo.slice(0, shown)"
            :key="i"
            class="ph__msg"
            :class="`ph__msg--${line.from}`"
          >
            <p>{{ line.text }}</p>
            <div v-if="line.slots" class="ph__slots">
              <span v-for="(slot, si) in line.slots" :key="slot" :style="{ '--i': si }">{{
                slot
              }}</span>
            </div>
          </div>
        </TransitionGroup>
        <div v-if="typing" class="ph__msg ph__msg--assistant ph__typing"><i></i><i></i><i></i></div>
      </div>

      <div class="ph__input">
        <span>Escribe un mensaje…</span>
        <i></i>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.ph {
  position: relative;
  margin: 0;
  width: min(100%, 420px);
}

.ph__device {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 700px;
  max-height: 92vh;
  padding: 10px;
  background: var(--ln-ink-deep);
  border: 1px solid var(--ln-line-strong);
  border-radius: 40px;
  box-shadow:
    0 50px 90px -30px color-mix(in srgb, var(--color-action-primary-active) 90%, transparent),
    0 0 0 6px color-mix(in srgb, var(--color-on-strong) 4%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--color-on-strong) 10%, transparent);
}

.ph__notch {
  align-self: center;
  width: 92px;
  height: 22px;
  margin-top: 4px;
  border-radius: var(--radius-pill);
  background: var(--ln-ink);
  border: 1px solid var(--ln-line);
}

.ph__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--ln-line);
}

.ph__avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--ln-brass-line);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ln-brass) 14%, transparent);
}

.ph__avatar i {
  width: 12px;
  height: 12px;
  background: var(--ln-brass);
  transform: rotate(45deg);
  animation: ph-spin 6s ease-in-out infinite;
}

.ph__name {
  display: grid;
  min-width: 0;
}

.ph__name b {
  font-size: 17px;
  line-height: 22px;
  font-weight: 600;
}

.ph__name small {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: 18px;
  color: var(--ln-muted);
}

.ph__online {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success-on-strong);
}

.ph__badge {
  margin-left: auto;
  padding: 3px 9px;
  border: 1px solid var(--ln-brass-line);
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--ln-brass);
}

.ph__chat {
  flex: 1;
  min-height: 0;
  padding: 18px 14px;
  overflow: hidden;
  scrollbar-width: none;
  background-image: radial-gradient(
    color-mix(in srgb, var(--color-on-strong) 7%, transparent) 1px,
    transparent 1px
  );
  background-size: 18px 18px;
}

.ph__list {
  display: grid;
  gap: 10px;
}

.ph__msg {
  max-width: 86%;
  padding: 10px 13px;
  border-radius: 14px;
  font-size: 16px;
  line-height: 23px;
}

.ph__msg p {
  margin: 0;
}

.ph__msg--client {
  justify-self: end;
  border-bottom-right-radius: 4px;
  background: var(--ln-brass);
  color: var(--color-brand-accent-text);
}

.ph__msg--assistant {
  justify-self: start;
  border-bottom-left-radius: 4px;
  background: var(--ln-ink-raised);
  border: 1px solid var(--ln-line);
}

.ph__slots {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.ph__slots span {
  padding: 6px 11px;
  border: 1px solid var(--ln-brass-line);
  border-radius: var(--radius-pill);
  font-size: 15px;
  font-weight: 600;
  color: var(--ln-brass);
  animation: ph-chip 420ms var(--motion-ease-spring) backwards;
  animation-delay: calc(260ms + var(--i, 0) * 120ms);
}

.ph__typing {
  display: inline-flex;
  gap: 5px;
  margin-top: 10px;
  padding: 14px 15px;
}

.ph__typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ln-muted);
  animation: ph-dot 1s ease-in-out infinite;
}

.ph__typing i:nth-child(2) {
  animation-delay: 0.15s;
}

.ph__typing i:nth-child(3) {
  animation-delay: 0.3s;
}

.ph__input {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 6px 4px;
  padding: 0 8px 0 16px;
  height: 46px;
  border: 1px solid var(--ln-line);
  border-radius: var(--radius-pill);
  font-size: 15px;
  color: var(--ln-muted);
}

.ph__input i {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--ln-brass);
  clip-path: polygon(20% 20%, 82% 50%, 20% 80%, 34% 50%);
}

.ph-msg-enter-active {
  transition:
    opacity 360ms var(--motion-ease-out),
    transform 460ms var(--motion-ease-spring);
}

.ph-msg-enter-from {
  opacity: 0;
  transform: translateY(14px) scale(0.96);
}

@keyframes ph-dot {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }

  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

@keyframes ph-chip {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
}

@keyframes ph-spin {
  50% {
    transform: rotate(225deg) scale(1.15);
  }
}

@media (max-width: 480px) {
  .ph__device {
    height: 580px;
    border-radius: 34px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ph-msg-enter-active {
    transition: none;
  }

  .ph__avatar i,
  .ph__slots span,
  .ph__typing i {
    animation: none;
  }
}
</style>
