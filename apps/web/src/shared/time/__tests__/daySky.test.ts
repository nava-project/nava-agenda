import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SKY_COLORS, skyGradient } from '../daySky'

describe('daySky', () => {
  it('places each colour at its real hour inside the window', () => {
    // Ventana de 6 a. m. a 6 p. m.: el amanecer (6:30) cae a 4,17 %, el ocaso (18:00) al 100 %.
    const g = skyGradient(6 * 60, 18 * 60)
    expect(g).toContain(`${SKY_COLORS.dawn} 4.17%`)
    expect(g).toContain(`${SKY_COLORS.dusk} 100.00%`)
    expect(g.startsWith('linear-gradient(90deg,')).toBe(true)
  })

  it('matches the colours the daylight strip declares in its CSS', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../modules/public-booking/components/DaylightStrip.vue'),
      'utf8',
    )
    for (const [tone, color] of Object.entries(SKY_COLORS)) {
      expect(css.toLowerCase()).toContain(`--dl-${tone}: ${color}`)
    }
  })
})
