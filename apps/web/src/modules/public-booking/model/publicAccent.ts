// Color de marca de la reserva pública (DEC-171). La barbería elige su acento
// en Configuración (DEC-110) y su enlace de reservas pinta con él acentos,
// filetes, foco y botones. Se aplica sobre <html> —no sobre el cascarón— porque
// los diálogos y selectores de la reserva se abren en <body> (Teleport) y
// también deben llevarlo; el cascarón lo retira al desmontarse, así que nunca
// llega a otra pantalla ni a otra barbería.
//
// La reserva es un lienzo de tinta fijo: siempre se usa el valor Tinta del
// acento, cuyo contraste AA ya mide `brandPalette.test.ts`. Con latón (valor
// inicial) no se escribe nada y la reserva queda exactamente como en tokens.css.
import { accentByKey, SURFACE_INK, type BrandAccentKey } from '@/shared/model'

const PROPERTIES = [
  '--color-brand-accent-surface',
  '--color-brand-accent-text',
  '--color-focus',
  '--color-accent-brass',
  '--color-accent-brass-on-surface',
] as const

/** Pinta el acento en `root` y devuelve la función que lo retira. */
export function paintPublicAccent(root: HTMLElement, key: BrandAccentKey | null): () => void {
  const clear = () => {
    for (const property of PROPERTIES) root.style.removeProperty(property)
  }
  clear()
  if (key === null || key === 'brass') return clear
  const accent = accentByKey(key)
  root.style.setProperty('--color-brand-accent-surface', accent.ink)
  root.style.setProperty('--color-brand-accent-text', SURFACE_INK)
  root.style.setProperty('--color-focus', accent.ink)
  // Latón «tipográfico» (rótulos y filetes) y su copia para superficies claras
  // propias dentro de la tinta, igual que en el panel (workspaceTheme.ts).
  root.style.setProperty('--color-accent-brass', accent.ink)
  root.style.setProperty('--color-accent-brass-on-surface', accent.ivory)
  return clear
}
