/**
 * OpeningHoursCard (HU-107, DEC-182): el horario del local en la entrada de la
 * reserva, con el estado de ahora en la zona del negocio.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import OpeningHoursCard from '../OpeningHoursCard.vue'
import type { OpeningSegment, OpeningToday } from '@/shared/model/openingHours'

const WEEK: OpeningSegment[] = [
  { dayOfWeek: 'MONDAY', opens: '09:00', closes: '12:30' },
  { dayOfWeek: 'MONDAY', opens: '14:00', closes: '19:00' },
  { dayOfWeek: 'TUESDAY', opens: '09:00', closes: '19:00' },
  { dayOfWeek: 'FRIDAY', opens: '20:00', closes: '24:00' },
]
const TUESDAY: OpeningToday = {
  date: '2026-11-17',
  dayOfWeek: 'TUESDAY',
  holiday: null,
  hours: [{ opens: '09:00', closes: '19:00' }],
}
// Martes 17 de noviembre de 2026 a las HH:00 en Bogotá (UTC-5).
const bogota = (hh: number) => new Date(Date.UTC(2026, 10, 17, hh + 5))

function mountCard(props: Partial<InstanceType<typeof OpeningHoursCard>['$props']> = {}) {
  return mount(OpeningHoursCard, {
    props: {
      openingHours: WEEK,
      today: TUESDAY,
      closedOnHolidays: false,
      timeZone: 'America/Bogota',
      at: bogota(10),
      ...props,
    },
  })
}

describe('OpeningHoursCard', () => {
  it('sin horario configurado no pinta nada (CA-107-06)', () => {
    const wrapper = mountCard({ openingHours: [], today: null })
    expect(wrapper.find('.pb-hours').exists()).toBe(false)
  })

  it('muestra la semana en 12 horas, con los días sin horario cerrados y hoy marcado', async () => {
    const wrapper = mountCard()
    const rows = wrapper.findAll('.pb-hours__row')
    expect(rows).toHaveLength(7)
    expect(rows[0].text()).toContain('9:00 a. m. – 12:30 p. m.')
    expect(rows[0].text()).toContain('2:00 p. m. – 7:00 p. m.')
    expect(rows[1].classes()).toContain('pb-hours__row--today')
    expect(rows[1].text()).toContain('hoy')
    expect(rows[2].text()).toContain('Cerrado')
    expect(rows[4].text()).toContain('8:00 p. m. – medianoche')
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })

  it('dice si está abierto ahora y hasta qué hora, con la hora del local', () => {
    expect(
      mountCard({ at: bogota(10) })
        .get('.pb-hours__now')
        .text(),
    ).toBe('Abierto · cierra a las 7:00 p. m.')
    expect(
      mountCard({ at: bogota(7) })
        .get('.pb-hours__now')
        .text(),
    ).toBe('Cerrado · abre hoy a las 9:00 a. m.')
    expect(
      mountCard({ at: bogota(20) })
        .get('.pb-hours__now')
        .text(),
    ).toBe('Cerrado por hoy')
  })

  it('en un festivo con el local cerrado lo nombra (CA-107-05)', () => {
    const wrapper = mountCard({
      closedOnHolidays: true,
      today: { ...TUESDAY, holiday: 'Independencia de Cartagena', hours: [] },
    })
    expect(wrapper.get('.pb-hours__now').text()).toBe('Hoy cerrado · Independencia de Cartagena')
    expect(wrapper.get('.pb-hours__note').text()).toBe('Cerramos los festivos.')
  })

  it('con hoy cerrado por festivo, la fila de hoy dice «Cerrado», no la jornada normal (#811)', async () => {
    const wrapper = mountCard({
      closedOnHolidays: true,
      today: { ...TUESDAY, holiday: 'Independencia de Cartagena', hours: [] },
    })
    const todayRow = wrapper.get('.pb-hours__row--today')
    expect(todayRow.text()).toContain('hoy')
    expect(todayRow.get('dd').text()).toBe('Cerrado')
    expect(todayRow.text()).not.toContain('9:00 a. m.')
    // El resto de la semana no cambia.
    expect(wrapper.findAll('.pb-hours__row')[0].text()).toContain('9:00 a. m. – 12:30 p. m.')
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })

  it('un día normal sigue resaltando su horario (#811)', () => {
    const todayRow = mountCard().get('.pb-hours__row--today')
    expect(todayRow.get('dd').text()).toBe('9:00 a. m. – 7:00 p. m.')
  })

  it('si `today` ya no es hoy, la fila vuelve al horario de la semana (#811)', () => {
    const wrapper = mountCard({
      closedOnHolidays: true,
      today: { ...TUESDAY, holiday: 'Independencia de Cartagena', hours: [] },
      at: new Date(Date.UTC(2026, 10, 18, 15)),
    })
    // El martes del festivo vuelve a su horario de la semana, y la marca de hoy ya
    // está en el miércoles (#850), que no tiene horario.
    const tuesday = wrapper.findAll('.pb-hours__row')[1]!
    expect(tuesday.get('dt').text()).toBe('Martes')
    expect(tuesday.get('dd').text()).toBe('9:00 a. m. – 7:00 p. m.')
    expect(wrapper.get('.pb-hours__row--today dt').text()).toBe('Miércoles · hoy')
  })

  it('pasada la medianoche del negocio, «· hoy» pasa al día nuevo sin esperar a `today` (#850)', async () => {
    // Martes 23:59 en Bogotá con el `today` del martes: hoy es el martes.
    const wrapper = mountCard({ at: new Date(Date.UTC(2026, 10, 18, 4, 59)) })
    expect(wrapper.get('.pb-hours__row--today dt').text()).toBe('Martes · hoy')
    // Miércoles 00:01: el `today` sigue siendo el del martes, la marca ya no.
    await wrapper.setProps({ at: new Date(Date.UTC(2026, 10, 18, 5, 1)) })
    expect(wrapper.findAll('.pb-hours__row--today')).toHaveLength(1)
    expect(wrapper.get('.pb-hours__row--today dt').text()).toBe('Miércoles · hoy')
    // El miércoles no tiene horario: su fila dice el de la semana, no el del martes.
    expect(wrapper.get('.pb-hours__row--today dd').text()).toBe('Cerrado')
  })

  it('«· hoy» sigue la zona del negocio, no la del dispositivo (#850)', () => {
    // 03:00 UTC del miércoles es todavía martes en Bogotá.
    const wrapper = mountCard({ at: new Date(Date.UTC(2026, 10, 18, 3)) })
    expect(wrapper.get('.pb-hours__row--today dt').text()).toBe('Martes · hoy')
  })

  it('si la página quedó abierta hasta otro día, no afirma un estado viejo', () => {
    const wrapper = mountCard({ at: new Date(Date.UTC(2026, 10, 18, 15)) })
    expect(wrapper.find('.pb-hours__now').exists()).toBe(false)
    expect(wrapper.findAll('.pb-hours__row')).toHaveLength(7)
  })
})
