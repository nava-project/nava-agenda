import { describe, expect, it } from 'vitest'
import {
  appointmentPhase,
  appointmentProgress,
  calendarLeaf,
  countdownLabel,
  timezoneCity,
} from '../appointmentMoment'

// 15:00Z es 10:00 en Bogotá (UTC-5, sin horario de verano).
const START = '2027-03-15T15:00:00Z'
const END = '2027-03-15T15:45:00Z'
const TZ = 'America/Bogota'
const at = (iso: string) => Date.parse(iso)

describe('calendarLeaf', () => {
  it('uses the barbershop timezone, not the device one', () => {
    // 03:00Z del 16 es todavía 15 de marzo en Bogotá.
    const leaf = calendarLeaf('2027-03-16T03:00:00Z', TZ)
    expect(leaf.day).toBe('15')
    expect(leaf.weekday).toBe('lunes')
    expect(leaf.month).toBe('mar')
    expect(leaf.longDate).toBe('15 de marzo de 2027')
  })
})

describe('appointmentPhase and appointmentProgress', () => {
  it('distinguishes before, during and after', () => {
    expect(appointmentPhase(START, END, at('2027-03-15T14:59:00Z'))).toBe('upcoming')
    expect(appointmentPhase(START, END, at(START))).toBe('in-progress')
    expect(appointmentPhase(START, END, at(END))).toBe('ended')
  })

  it('clamps the elapsed fraction between 0 and 1', () => {
    expect(appointmentProgress(START, END, at('2027-03-15T14:00:00Z'))).toBe(0)
    expect(appointmentProgress(START, END, at('2027-03-15T15:15:00Z'))).toBeCloseTo(1 / 3)
    expect(appointmentProgress(START, END, at('2027-03-15T17:00:00Z'))).toBe(1)
  })
})

describe('countdownLabel', () => {
  it('counts calendar days in the barbershop timezone', () => {
    expect(countdownLabel(START, END, TZ, at('2027-03-12T20:00:00Z'))).toBe('En 3 días')
    // 23:00 del 14 en Bogotá: faltan 11 h pero es «mañana».
    expect(countdownLabel(START, END, TZ, at('2027-03-15T04:00:00Z'))).toBe('Mañana')
  })

  it('shows hours and minutes on the same day', () => {
    expect(countdownLabel(START, END, TZ, at('2027-03-15T12:45:00Z'))).toBe('Hoy · en 2 h 15 min')
    expect(countdownLabel(START, END, TZ, at('2027-03-15T13:00:00Z'))).toBe('Hoy · en 2 h')
    expect(countdownLabel(START, END, TZ, at('2027-03-15T14:48:00Z'))).toBe('En 12 min')
  })

  it('reports the time left while in progress and when it is over', () => {
    expect(countdownLabel(START, END, TZ, at('2027-03-15T15:25:00Z'))).toBe(
      'En curso · quedan 20 min',
    )
    expect(countdownLabel(START, END, TZ, at('2027-03-15T16:00:00Z'))).toBe(
      'La hora del turno ya pasó',
    )
  })
})

describe('timezoneCity', () => {
  it('keeps only the readable city of an IANA zone', () => {
    expect(timezoneCity('America/Bogota')).toBe('Bogota')
    expect(timezoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
  })
})
