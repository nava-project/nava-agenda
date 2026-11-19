// Color de marca de la reserva pública (DEC-171). El negocio elige su acento
// en Configuración (DEC-110) y su enlace de reservas pinta con él la acción y
// los rótulos. Se aplica sobre <html> —no sobre el cascarón— porque los
// diálogos y selectores de la reserva se abren en <body> (Teleport) y también
// deben llevarlo; el cascarón lo retira al desmontarse, así que nunca llega a
// otra pantalla ni a otro negocio.
//
// DEC-188: la reserva sigue al modo del sistema (Día/Noche), así que se entregan
// los dos valores medidos del acento y tokens.css elige el del modo. Con el
// acento por omisión no se escribe nada y queda el Alba de la marca.
import {
  accentByKey,
  DEFAULT_BRAND_ACCENT,
  paintBusinessAccent,
  type BrandAccentKey,
} from '@/shared/model'

/** Pinta el acento en `root` y devuelve la función que lo retira. */
export function paintPublicAccent(root: HTMLElement, key: BrandAccentKey | null): () => void {
  const clear = () => paintBusinessAccent(root, null)
  clear()
  if (key === null || key === DEFAULT_BRAND_ACCENT) return clear
  paintBusinessAccent(root, accentByKey(key))
  return clear
}
