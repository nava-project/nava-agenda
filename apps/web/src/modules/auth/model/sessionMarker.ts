// Marca local «aquí hubo una sesión» (#810, hallazgo A4). El 401 del arranque
// (GET /private/auth/session) no distingue una sesión vencida de alguien que
// nunca entró, y la API no cambia para eso. El navegador lo recuerda.
//
// - Sin datos personales ni tokens: la clave lleva un «1» y nada más. Nunca
//   concede permisos; la cookie HttpOnly sigue siendo la única autoridad en
//   cada solicitud (HU-012).
// - Se pone con cada arranque autenticado, así que también la tienen las
//   sesiones abiertas antes de este cambio.
// - Se quita con «Cerrar sesión», a propósito, y al mostrar una vez el aviso
//   de sesión vencida, para que no se repita en cada visita al acceso.
// - Vive en `localStorage`, compartido entre pestañas: «Cerrar sesión» en otra
//   pestaña la quita también para esta. Las decisiones la leen en el momento,
//   así que no hace falta escuchar el evento `storage`.
// - `localStorage` puede fallar (modo privado, cuota, bloqueo). Si falla,
//   cuenta como «sin marca» y se ve el acceso normal, sin aviso.
const STORAGE_KEY = 'nava.session.v1'

export function markSessionStarted(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Sin almacenamiento no hay aviso de sesión vencida: el acceso normal.
  }
}

export function hadSessionHere(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function clearSessionMarker(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nada que limpiar si el almacenamiento no está disponible.
  }
}
