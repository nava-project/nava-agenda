/**
 * Un plazo en minutos dicho como lo dice el acceso (#812): en horas cuando es
 * múltiplo de 60 y en minutos en los demás casos. 120 → «2 horas»,
 * 90 → «90 minutos», 1440 → «24 horas», 60 → «1 hora».
 */
export function minutesInWords(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  if (total > 0 && total % 60 === 0) {
    const hours = total / 60
    return hours === 1 ? '1 hora' : `${hours} horas`
  }
  return total === 1 ? '1 minuto' : `${total} minutos`
}
