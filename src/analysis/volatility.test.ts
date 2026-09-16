import { expect, test, describe } from 'bun:test'
import { trueRange, atr } from './volatility.ts'
import type { Bar } from '../types.ts'

function bar(high: number, low: number, close: number): Bar {
  return { date: '2026-01-01', open: close, high, low, close, volume: 1 }
}

describe('trueRange', () => {
  test('bar pertama memakai rentang harian, karena tidak ada close sebelumnya', () => {
    expect(trueRange(bar(110, 100, 105), undefined)).toBe(10)
  })

  test('gap naik membuat true range lebih lebar dari rentang harian', () => {
    // Close kemarin 90; hari ini 100..110. TR = high - close kemarin = 20.
    expect(trueRange(bar(110, 100, 105), bar(95, 85, 90))).toBe(20)
  })

  test('gap turun juga diperhitungkan', () => {
    // Close kemarin 130; hari ini 100..110. TR = close kemarin - low = 30.
    expect(trueRange(bar(110, 100, 105), bar(135, 125, 130))).toBe(30)
  })
})

describe('atr', () => {
  test('null sebelum periode terpenuhi', () => {
    const bars = Array.from({ length: 5 }, () => bar(110, 100, 105))
    const result = atr(bars, 14)
    expect(result.every((v) => v === null)).toBe(true)
  })

  test('true range konstan menghasilkan ATR sama dengan nilai itu', () => {
    const bars = Array.from({ length: 40 }, () => bar(110, 100, 105))
    const result = atr(bars, 14)
    expect(result[result.length - 1]).toBeCloseTo(10, 9)
  })

  test('nilai pertama adalah rata-rata sederhana periode pertama', () => {
    const bars = [
      bar(110, 100, 105),
      bar(112, 104, 108),
      bar(120, 106, 118),
    ]
    const result = atr(bars, 3)
    // TR: 10, 8, 14 → rata-rata 32/3.
    expect(result[2]).toBeCloseTo(32 / 3, 9)
    expect(result[1]).toBeNull()
  })

  test('sesudahnya dihaluskan cara Wilder, bukan rata-rata bergerak biasa', () => {
    const bars = [bar(110, 100, 105), bar(112, 104, 108), bar(120, 106, 118), bar(130, 120, 125)]
    const result = atr(bars, 3)
    const prev = 32 / 3
    const tr4 = 130 - 118 // high - close kemarin = 12, lebih lebar dari 10
    expect(result[3]).toBeCloseTo((prev * 2 + tr4) / 3, 9)
  })

  test('deret lebih pendek dari periode tidak melempar', () => {
    expect(() => atr([bar(110, 100, 105)], 14)).not.toThrow()
  })
})
