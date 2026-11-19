// Importes del contrato como texto, sin pasar nunca por `number`
// (nava-docs/agenda/06-api/estandar-openapi.md §6: el precio es un decimal exacto en
// cadena). El símbolo sale de Intl para la moneda REAL recibida, así que no
// se asumen pesos (estandar-diseno-visual.md §10.3); Intl solo formatea un 0
// para descubrirlo, nunca el importe. Agrupación y decimales siguen es-CO:
// punto de miles, coma decimal y sin decimales cuando son todos cero.

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/

export interface MoneyParts {
  /** Símbolo de la moneda en es-CO («$», «US$», «EUR»…) o el código si Intl no lo conoce. */
  readonly symbol: string
  /** Cifra agrupada, sin símbolo: «25.000», «1.250,5». */
  readonly amount: string
  /** Código ISO 4217 tal como vino del contrato. */
  readonly currency: string
}

function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat('es-CO', { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')
    return part?.value ?? currency
  } catch {
    return currency
  }
}

/**
 * Descompone un importe decimal exacto para pintarlo con jerarquía. Si el
 * texto no es un decimal válido se devuelve tal cual, sin inventar cifras.
 */
export function moneyParts(amount: string, currency: string): MoneyParts {
  const match = DECIMAL_PATTERN.exec(amount.trim())
  if (!match) return { symbol: currencySymbol(currency), amount, currency }
  const [, sign, integer, fraction = ''] = match
  const grouped = integer!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const decimals = fraction.replace(/0+$/, '')
  return {
    symbol: currencySymbol(currency),
    amount: `${sign}${grouped}${decimals ? `,${decimals}` : ''}`,
    currency,
  }
}

/** «$ 25.000» — importe completo en una línea, con espacio irrompible. */
export function formatMoney(amount: string, currency: string): string {
  const parts = moneyParts(amount, currency)
  return `${parts.symbol} ${parts.amount}`
}
