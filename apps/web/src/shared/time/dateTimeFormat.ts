// dateTimeFormat: un `Intl.DateTimeFormat` reutilizado por idioma y opciones
// (#836). Crear uno cuesta ~36 µs y formatear con uno ya creado ~3 µs: la tira
// de horas (`buildDaylightDays`) llamaba a varios helpers por cada inicio y
// creaba cientos en cada recálculo (131 ms con la rejilla de 15 min de la muestra
// de Configuración, en cada tecla). Un formateador no guarda estado, así que
// compartirlo no cambia ningún resultado. La zona sigue llegando explícita en
// `options.timeZone` (RN-DIS-07). Las combinaciones son pocas (idiomas fijos y
// unas cuantas zonas), así que la caché no crece sin límite.
const cache = new Map<string, Intl.DateTimeFormat>()

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let format = cache.get(key)
  if (!format) {
    // Una zona inválida lanza aquí, como antes, y no se guarda nada.
    format = new Intl.DateTimeFormat(locale, options)
    cache.set(key, format)
  }
  return format
}
