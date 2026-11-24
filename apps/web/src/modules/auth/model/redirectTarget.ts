// Valida el destino pretendido que el guard conserva al redirigir a
// /acceso (CA-012-02) y que LoginPage recupera después de autenticarse.
// Solo una ruta interna con forma segura autoriza la redirección: nunca un
// destino externo (protocolo, `//host`) ni un ciclo hacia /acceso o
// /recuperar-acceso (trabajo requerido §3). Tampoco la barra invertida ni los
// caracteres de control, ni escritos ni codificados (`%5C`, `%09`…): algunos
// navegadores los leen como `/` o los descartan y `/\evil` acabaría en
// `//evil`. Hoy vue-router antepone el origen; esto no depende de ello (#810).
const UNSAFE_CHARS = /[\\\u0000-\u001F\u007F]/
const UNSAFE_ESCAPES = /%(5c|[01][0-9a-f]|7f)/i
const CYCLE_PATHS = new Set(['/acceso', '/recuperar-acceso'])

export function isSafeInternalRedirect(path: unknown): path is string {
  if (typeof path !== 'string' || path === '') return false
  if (!path.startsWith('/') || path.startsWith('//')) return false
  if (path.includes('://')) return false
  if (UNSAFE_CHARS.test(path) || UNSAFE_ESCAPES.test(path)) return false
  const withoutQuery = path.split(/[?#]/)[0]
  if (CYCLE_PATHS.has(withoutQuery)) return false
  return true
}
