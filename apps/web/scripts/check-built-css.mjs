// Revisa el CSS ya construido (dist/assets/*.css), no el fuente (#791).
//
// Lightning CSS, el minificador de Vite, añade los prefijos que piden los
// navegadores objetivo. Pero si una regla trae a mano `-webkit-backdrop-filter`
// junto a `backdrop-filter`, a veces deja solo el prefijado. Firefox no
// entiende el prefijado, y el velo de los diálogos salía plano. En el fuente
// no se nota nada; el fallo solo existe en la salida del build.
//
// También revisa que ninguna regla apunte solo a la raíz con una preferencia
// (#846). En un <style scoped>, `:global(:root[data-motion='reduced']) .clase`
// compila a solo `:root[data-motion=reduced]` (#731): la regla de la clase cae
// sobre el documento entero. Con `opacity: 0.8`, toda la app se veía atenuada
// con «Animaciones reducidas». En la raíz solo caben los tokens (variables y
// `color-scheme`).
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

/** Una preferencia de la raíz sola, sin nada después: `:root[data-motion=reduced]`. */
const BARE_ROOT_PREFERENCE = /^:root\[data-(motion|app-theme)(=[^\]]*)?\]$/

/** Separa una lista de selectores por las comas de primer nivel (no las de `:is(…)`). */
function splitSelectorList(selector) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of selector) {
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim())
}

/**
 * Reglas cuyo selector es solo una preferencia de la raíz y que declaran algo
 * distinto de un token (variable o `color-scheme`). Devuelve un fragmento de cada una.
 * @param {string} css
 * @returns {string[]}
 */
export function rootOnlyRules(css) {
  const found = []
  for (const [, selector = '', body = ''] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = splitSelectorList(selector.replace(/^[^{}]*;/, ''))
    if (!selectors.some((part) => BARE_ROOT_PREFERENCE.test(part))) continue
    const properties = body
      .split(';')
      .map((declaration) => declaration.split(':')[0]?.trim() ?? '')
      .filter((property) => property && !property.startsWith('--') && property !== 'color-scheme')
    if (properties.length > 0)
      found.push(`${selectors.join(',').slice(0, 80)} { ${properties.join('; ')} }`)
  }
  return found
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist/assets')
  const files = readdirSync(dir).filter((file) => file.endsWith('.css'))
  const read = (file) => readFileSync(join(dir, file), 'utf8')
  const prefixed = files.flatMap((file) =>
    prefixedOnlyRules(read(file)).map((rule) => `${file}: ${rule}`),
  )
  const rootOnly = files.flatMap((file) =>
    rootOnlyRules(read(file)).map((rule) => `${file}: ${rule}`),
  )
  if (prefixed.length > 0) {
    console.error('CSS construido con propiedades solo prefijadas (Firefox las ignora):')
    for (const offender of prefixed) console.error(`  ${offender}`)
  }
  if (rootOnly.length > 0) {
    console.error(
      'CSS construido con reglas que caen sobre toda la raíz (¿`:global(:root…) .clase` en scoped?):',
    )
    for (const offender of rootOnly) console.error(`  ${offender}`)
  }
  if (prefixed.length > 0 || rootOnly.length > 0) process.exit(1)
  console.log('CSS construido: sin propiedades solo prefijadas ni reglas sueltas sobre la raíz.')
}
