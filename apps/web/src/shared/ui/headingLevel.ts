import type { InjectionKey, Ref } from 'vue'

/**
 * Nivel del encabezado más cercano que envuelve a un componente (#862).
 *
 * BaseDialog titula con un h2 y lo anuncia aquí (null si no lleva título). BaseAlert titula un nivel por
 * debajo del que reciba (h3 dentro de un diálogo) para no saltar niveles, que es
 * lo que marca axe con `heading-order`. Fuera de cualquier proveedor, BaseAlert
 * conserva su h4 de siempre.
 */
export const surroundingHeadingLevelKey: InjectionKey<Readonly<Ref<number | null>>> =
  Symbol('surroundingHeadingLevel')
