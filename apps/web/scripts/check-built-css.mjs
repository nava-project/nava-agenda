// Revisa el CSS ya construido (dist/assets/*.css), no el fuente (#791).
//
// Lightning CSS, el minificador de Vite, añade los prefijos que piden los
// navegadores objetivo. Pero si una regla trae a mano `-webkit-backdrop-filter`
// junto a `backdrop-filter`, a veces deja solo el prefijado. Firefox no
// entiende el prefijado, y el velo de los diálogos salía plano. En el fuente
// no se nota nada; el fallo solo existe en la salida del build.
//
// Uso: node scripts/check-built-css.mjs [carpeta]   (por omisión, dist/assets)
// `pnpm run build` lo ejecuta al final, así el build de la imagen falla si vuelve.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Propiedades cuyo alias -webkit- no reconoce Firefox: la versión sin prefijo es obligatoria. */
const REQUIRES_STANDARD = ['backdrop-filter']

/**
 * Bloques de declaraciones que traen la versión -webkit- de una propiedad de
 * REQUIRES_STANDARD sin la estándar. Devuelve un fragmento de cada uno.
 * @param {string} css
 * @returns {string[]}
 */
export function prefixedOnlyRules(css) {
  const found = []
  for (const [, selector = '', body = ''] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    for (const property of REQUIRES_STANDARD) {
      const prefixed = new RegExp(`(^|[;\\s])-webkit-${property}\\s*:`).test(body)
      const standard = new RegExp(`(^|[;\\s])${property}\\s*:`).test(body)
      if (prefixed && !standard)
        found.push(`${selector.trim().slice(-80)} { -webkit-${property} … }`)
    }
  }
  return found
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist/assets')
  const offenders = readdirSync(dir)
    .filter((file) => file.endsWith('.css'))
    .flatMap((file) =>
      prefixedOnlyRules(readFileSync(join(dir, file), 'utf8')).map((rule) => `${file}: ${rule}`),
    )
  if (offenders.length > 0) {
    console.error('CSS construido con propiedades solo prefijadas (Firefox las ignora):')
    for (const offender of offenders) console.error(`  ${offender}`)
    process.exit(1)
  }
  console.log('CSS construido: sin propiedades solo prefijadas.')
}
