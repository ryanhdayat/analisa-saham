import { expect, test, describe } from 'bun:test'
import { toWeekly } from './resample.ts'
import type { Bar } from './types.ts'

function bar(date: string, open: number, high: number, low: number, close: number, volume: number): Bar {
  return { date, open, high, low, close, volume }
}

describe('toWeekly', () => {
  // 2026-01-05 Senin, 2026-01-09 Jumat, 2026-01-12 Senin berikutnya.
  const daily = [
    bar('2026-01-05', 100, 110, 95, 105, 10),
    bar('2026-01-06', 105, 115, 100, 112, 20),
    bar('2026-01-09', 112, 118, 108, 109, 30),
    bar('2026-01-12', 109, 120, 105, 118, 40),
    bar('2026-01-13', 118, 125, 115, 120, 50),
  ]

  test('mengelompokkan per pekan ISO, Senin sampai Minggu', () => {
    expect(toWeekly(daily)).toHaveLength(2)
  })

  test('open pekan dari bar pertama, close dari bar terakhir', () => {
    const [first, second] = toWeekly(daily)
    expect(first!.open).toBe(100)
    expect(first!.close).toBe(109)
    expect(second!.open).toBe(109)
    expect(second!.close).toBe(120)
  })

  test('high dan low pekan adalah ekstrem seluruh bar di pekan itu', () => {
    const [first] = toWeekly(daily)
    expect(first!.high).toBe(118)
    expect(first!.low).toBe(95)
  })

  test('volume pekan dijumlah', () => {
    const [first, second] = toWeekly(daily)
    expect(first!.volume).toBe(60)
    expect(second!.volume).toBe(90)
  })

  test('bar pekan diberi tanggal hari bursa pertama pekan itu', () => {
    expect(toWeekly(daily)[0]!.date).toBe('2026-01-05')
  })

  test('pekan yang hanya punya satu hari bursa tetap jadi satu bar', () => {
    expect(toWeekly([bar('2026-03-04', 1, 2, 0.5, 1.5, 7)])).toEqual([
      { date: '2026-03-04', open: 1, high: 2, low: 0.5, close: 1.5, volume: 7 },
    ])
  })

  test('pekan yang melewati pergantian tahun tidak tercampur', () => {
    const across = [
      bar('2025-12-29', 10, 11, 9, 10, 1), // Senin
      bar('2025-12-31', 10, 12, 9, 11, 1),
      bar('2026-01-05', 11, 13, 10, 12, 1), // Senin pekan lain
    ]
    expect(toWeekly(across)).toHaveLength(2)
  })

  test('deret kosong menghasilkan deret kosong', () => {
    expect(toWeekly([])).toEqual([])
  })
})
