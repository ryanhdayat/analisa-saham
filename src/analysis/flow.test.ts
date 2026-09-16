import { expect, test, describe } from 'bun:test'
import { analyzeFlow } from './flow.ts'
import type { ForeignDay } from './flow.ts'

function days(netShares: number[], close = 1000): ForeignDay[] {
  return netShares.map((n, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    netShares: n,
    close,
  }))
}

describe('analyzeFlow', () => {
  const beli = days(Array.from({ length: 60 }, () => 1_000_000))

  test('menjumlah net lembar pada jendela 5, 20, dan 60 hari', () => {
    const v = analyzeFlow(beli).value!
    expect(v.net5).toBe(5_000_000)
    expect(v.net20).toBe(20_000_000)
    expect(v.net60).toBe(60_000_000)
  })

  test('nilai rupiah diestimasi dari close dan DILABELI estimasi', () => {
    const m = analyzeFlow(beli)
    expect(m.value!.value20).toBe(20_000_000 * 1000)
    expect(m.evidence.join(' ').toLowerCase()).toContain('estimasi')
  })

  test('satuan lembar disebut eksplisit, supaya tidak tertukar dengan rupiah', () => {
    expect(analyzeFlow(beli).evidence.join(' ').toLowerCase()).toContain('lembar')
  })

  test('persistensi adalah bagian hari bernet positif dalam 20 hari', () => {
    const campur = days([...Array.from({ length: 10 }, () => 1_000), ...Array.from({ length: 10 }, () => -1_000)])
    expect(analyzeFlow(campur).value!.persistence20).toBeCloseTo(0.5, 6)
  })

  test('akumulasi konsisten memberi skor lebih tinggi dari distribusi konsisten', () => {
    const jual = days(Array.from({ length: 60 }, () => -1_000_000))
    expect(analyzeFlow(beli).value!.flowScore).toBeGreaterThan(analyzeFlow(jual).value!.flowScore)
  })

  test('skor aliran selalu di 0..1', () => {
    for (const d of [beli, days(Array.from({ length: 60 }, () => -9e9))]) {
      const s = analyzeFlow(d).value!.flowScore
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  test('umur data cache diteruskan supaya bisa dicetak di tiap sel', () => {
    const m = analyzeFlow(beli, { asOf: '2026-09-12', daysOld: 4 })
    expect(m.staleness).toEqual({ asOf: '2026-09-12', daysOld: 4 })
    expect(m.verdict).toContain('2026-09-12')
  })

  test('tanpa data IDX hasilnya available false, bukan nol', () => {
    const m = analyzeFlow([])
    expect(m.available).toBe(false)
    expect(m.value).toBeNull()
  })
})
