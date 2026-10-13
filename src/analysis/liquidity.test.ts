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

describe('analyzeLiquidity — mata uang', () => {
  const dollar = (v: number) => `$${(v / 1e6).toFixed(2)}M`

  test('bawaannya tetap rupiah', () => {
    const m = analyzeLiquidity(bars(1000, 10_000_000))
    expect(m.verdict).toContain('Rp')
    expect(m.evidence.join(' ')).toContain('Rp')
  })

  test('formatter yang disuntikkan dipakai di putusan dan bukti', () => {
    // CSV yang melabeli dolar sebagai rupiah adalah kesalahan diam — persis
    // jenis yang paling sulit terlihat dan paling mahal kalau dipercaya.
    const m = analyzeLiquidity(bars(100, 500_000), 10e6, undefined, dollar)
    expect(m.verdict).toContain('$')
    expect(m.verdict).not.toContain('Rp')
    expect(m.evidence.join(' ')).not.toContain('Rp')
  })

  test('ambang dolar dinilai dengan formatter dolar juga', () => {
    const m = analyzeLiquidity(bars(100, 50_000), 10e6, undefined, dollar)
    expect(m.value!.passesGate).toBe(false)
    expect(m.verdict).toContain('$10.00M') // ambangnya, bukan Rp
  })
})

describe('analyzeLiquidity — konvensi nilai harian', () => {
  test('bawaannya close x volume', () => {
    expect(analyzeLiquidity(bars(1000, 10_000_000)).value!.avgDailyValue).toBeCloseTo(10e9, -3)
  })

  test('nilai harian bisa diambil langsung dari volume', () => {
    // Pasar yang volumenya sudah dalam mata uang kuotasi (crypto di Yahoo).
    const m = analyzeLiquidity(bars(80_000, 28e9), 10e6, undefined, undefined, (b) => b.volume)
    expect(m.value!.avgDailyValue).toBeCloseTo(28e9, -6)
  })
})
