// Vocabulario del negocio activo ya concordado (DEC-110). Una pantalla dice
// `v.professionals` y no `'profesionales'`: el texto cambia con la configuración y,
// con los valores iniciales, sale idéntico al de siempre. Devuelve un `computed`
// compartido; en una plantilla se usa directamente (`{{ v.Professionals }}`).
import { vocabulary } from '@/shared/model'

export function useVocabulary() {
  return vocabulary
}
