import { describe, expect, it } from 'vitest'
import { groupSeries } from '../seriesGroups'
import { describeWeekdays, joinWeekdayNames } from '../workingHour'
import type { TimeBlockSeries } from '../timeBlock'

function weekly(id: string, isoWeekday: number, over: Partial<TimeBlockSeries> = {}) {
  return {
    id,
    blockType: 'lunch',
    recurrenceKind: 'weekly',
    isoWeekday,
    startsTime: '13:00',
    durationMinutes: 60,
    effectiveFrom: '2026-11-03',
    effectiveUntil: null,
    reason: null,
    deletedAt: null,
    createdAt: '2026-11-03T12:00:00Z',
    updatedAt: '2026-11-03T12:00:00Z',
    dates: [],
    exceptions: [],
    ...over,
  } as TimeBlockSeries
}

describe('groupSeries', () => {
  it('groups weekly series that only differ by weekday, sorted by day', () => {
    const groups = groupSeries([weekly('c', 5), weekly('a', 1), weekly('b', 3)])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(groups[0]!.weekdays).toEqual([1, 3, 5])
  })

  it.each([
    ['type', { blockType: 'break' as const }],
    ['start time', { startsTime: '14:00' }],
    ['duration', { durationMinutes: 45 }],
    ['start of validity', { effectiveFrom: '2026-12-01' }],
    ['end of validity', { effectiveUntil: '2027-01-01' }],
    ['reason', { reason: 'Reunión' }],
  ])('keeps series apart when the %s differs', (_label, over) => {
    const groups = groupSeries([weekly('a', 1), weekly('b', 2, over)])

    expect(groups).toHaveLength(2)
  })

  it('never groups date lists and keeps first-appearance order', () => {
    const list = (id: string) =>
      weekly(id, 0, { recurrenceKind: 'date_list', isoWeekday: null, blockType: 'vacation' })
    const groups = groupSeries([weekly('a', 1), list('d1'), weekly('b', 2), list('d2')])

    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['a', 'b'],
      ['d1'],
      ['d2'],
    ])
    expect(groups[1]!.weekdays).toEqual([])
  })

  it('returns a single-member group for a lone weekly series', () => {
    expect(groupSeries([weekly('a', 4)])[0]!.weekdays).toEqual([4])
  })
})

describe('weekday descriptions', () => {
  it('joins names for a sentence', () => {
    expect(joinWeekdayNames([1, 3, 5])).toBe('lunes, miércoles y viernes')
    expect(joinWeekdayNames([2])).toBe('martes')
  })

  it.each([
    [[1], 'Lunes'],
    [[1, 2], 'Lunes y martes'],
    [[1, 2, 3, 4, 5], 'Lunes a viernes'],
    [[6, 7, 5], 'Viernes a domingo'],
    [[1, 3, 5], 'Lunes, miércoles y viernes'],
    [[1, 2, 3, 4, 5, 6, 7], 'Todos los días'],
    [[], ''],
  ])('describes %j as «%s»', (days, text) => {
    expect(describeWeekdays(days)).toBe(text)
  })
})
