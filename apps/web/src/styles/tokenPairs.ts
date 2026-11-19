// Pares texto/fondo que la v2 «La luz del día» promete legibles (DEC-188,
// WCAG 2.2): 4,5 para texto y 3 para foco, bordes de control y gráficos. Los
// mide styles/__tests__/tokens.test.ts en los modos Día y Noche, y la hoja de
// tokens de la bóveda se genera con esta misma lista.
export interface TokenPair {
  fg: string
  bg: string
  min: 4.5 | 3
}

const text = (fg: string, bgs: string[]): TokenPair[] => bgs.map((bg) => ({ fg, bg, min: 4.5 }))
const graphic = (fg: string, bgs: string[]): TokenPair[] => bgs.map((bg) => ({ fg, bg, min: 3 }))

const PAGE = [
  '--color-canvas',
  '--color-surface',
  '--color-surface-strong',
  '--color-chrome-surface',
]

export const TOKEN_PAIRS: TokenPair[] = [
  ...text('--color-text-primary', [...PAGE, '--color-surface-muted', '--color-field-strong']),
  ...text('--color-text-secondary', [...PAGE, '--color-field-strong']),
  ...text('--color-on-strong', [...PAGE, '--color-field-strong', '--color-field-strong-raised']),
  ...text('--color-on-strong-muted', [...PAGE, '--color-field-strong']),
  ...text('--color-on-strong-soft', PAGE),
  ...[
    '--color-danger-on-strong',
    '--color-warning-on-strong',
    '--color-success-on-strong',
    '--color-pending-on-strong',
    '--color-no-show-on-strong',
    '--color-info-on-strong',
  ].flatMap((fg) => text(fg, PAGE)),
  ...text('--color-success-text', ['--color-success-surface']),
  ...text('--color-warning-text', ['--color-warning-surface']),
  ...text('--color-danger-text', ['--color-danger-surface']),
  ...text('--color-info-text', ['--color-info-surface']),
  ...text('--color-inactive-text', ['--color-inactive-surface']),
  ...text('--color-status-no-show-text', ['--color-status-no-show-surface']),
  ...text('--color-on-ink', [
    '--color-action-primary',
    '--color-action-primary-hover',
    '--color-action-primary-active',
    '--color-danger-action',
  ]),
  ...text('--color-brand-accent-text', ['--color-brand-accent-surface']),
  ...text('--color-action-primary', ['--color-canvas', '--color-surface', '--color-action-soft']),
  ...text('--color-accent-brass', [
    '--color-canvas',
    '--color-surface',
    '--color-surface-strong',
    '--color-sky-morning',
    '--color-sky-afternoon',
    '--color-sky-night',
  ]),
  ...text('--color-on-sun', ['--color-sun']),
  ...text('--color-text-primary', [
    '--color-sky-morning',
    '--color-sky-afternoon',
    '--color-sky-night',
  ]),
  ...graphic('--color-focus', [...PAGE, '--color-field-strong']),
  ...graphic('--color-border-control', ['--color-canvas', '--color-surface']),
  ...graphic('--color-brand-alba', ['--color-canvas', '--color-surface']),
]
