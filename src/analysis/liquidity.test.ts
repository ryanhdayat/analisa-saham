import { expect, test, describe } from 'bun:test'
import { analyzeLiquidity, MIN_VALUE_DEFAULT } from './liquidity.ts'
import type { Bar } from '../types.ts'

function bars(close: number, volume: number, count = 25): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close + 5,
    low: close - 5,
    close,
    volume,
  }))
}

describe('analyzeLiquidity', () => {
  test('nilai harian adalah rata-rata close x volume', () => {
    // 1.000 x 10.000.000 lembar = Rp 10 miliar per hari.
    expect(analyzeLiquidity(bars(1000, 10_000_000)).value!.avgDailyValue).toBeCloseTo(10e9, -3)
  })

  test('di atas ambang lolos gerbang', () => {
    expect(analyzeLiquidity(bars(1000, 10_000_000)).value!.passesGate).toBe(true)
  })

  test('di bawah ambang gagal gerbang', () => {
    // Rp 500 juta per hari.
    expect(analyzeLiquidity(bars(1000, 500_000)).value!.passesGate).toBe(false)
  })

  test('vonis menyebut angkanya dan ambangnya, bukan cuma gagal', () => {
    const v = analyzeLiquidity(bars(1000, 500_000)).verdict
    expect(v).toMatch(/500|0,5|0\.5/)
    expect(v).toMatch(/5/)
  })

  test('ambang bisa diubah', () => {
    const b = bars(1000, 500_000)
    expect(analyzeLiquidity(b, 100e6).value!.passesGate).toBe(true)
    expect(analyzeLiquidity(b, 100e9).value!.passesGate).toBe(false)
  })

  test('ambang bawaan Rp 5 miliar', () => {
    expect(MIN_VALUE_DEFAULT).toBe(5e9)
  })

  test('free float dihitung kalau data IDX ada', () => {
    const m = analyzeLiquidity(bars(1000, 10_000_000), MIN_VALUE_DEFAULT, {
      freeFloatShares: 300,
      listedShares: 1000,
    })
    expect(m.value!.freeFloatPct).toBeCloseTo(30, 6)
  })

  test('free float null kalau data IDX tidak ada, bukan nol', () => {
    const m = analyzeLiquidity(bars(1000, 10_000_000))
    expect(m.value!.freeFloatPct).toBeNull()
    expect(m.evidence.some((e) => /free float/i.test(e))).toBe(true)
  })

  test('free float nol lembar tidak dibagi nol', () => {
    const m = analyzeLiquidity(bars(1000, 10_000_000), MIN_VALUE_DEFAULT, {
      freeFloatShares: 0,
      listedShares: 0,
    })
    expect(m.value!.freeFloatPct).toBeNull()
  })
})
