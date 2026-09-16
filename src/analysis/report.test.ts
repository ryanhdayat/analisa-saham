import { expect, test, describe } from 'bun:test'
import { buildRow, RANK_COLUMNS } from './report.ts'
import { volumeProfile } from '../indicators.ts'
import type { Bar } from '../types.ts'
import type { ForeignDay } from './flow.ts'

/** Uptrend bergelombang yang cukup panjang untuk MA 200 dan RS 60 hari. */
function healthy(count = 320, start = 1000, endPrice = 3000, volume = 20_000_000): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const trend = start + ((endPrice - start) * i) / (count - 1)
    const wave = Math.sin(i / 7) * trend * 0.04
    const price = trend + wave
    return {
      date: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      open: price - wave * 0.1,
      high: price * 1.015,
      low: price * 0.985,
      close: price,
      volume,
    }
  })
}

function flat(count = 320, price = 1000, volume = 20_000_000): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume,
  }))
}

function input(over: Partial<Parameters<typeof buildRow>[0]> = {}) {
  const bars = healthy()
  const displayBars = bars.slice(-250)
  return {
    code: 'UJI',
    name: 'Uji Tbk.',
    bars,
    displayBars,
    profile: volumeProfile(displayBars, 24),
    indexBars: flat(320),
    ...over,
  }
}

const foreign = (net: number): ForeignDay[] =>
  Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    netShares: net,
    close: 2000,
  }))

describe('buildRow — gerbang', () => {
  test('likuiditas di bawah ambang menggagalkan gerbang berikut alasannya', () => {
    const bars = healthy(320, 1000, 3000, 100) // nilai harian jauh di bawah Rp 5 M
    const row = buildRow(input({ bars, displayBars: bars.slice(-250) }))
    expect(row.gates.passed).toBe(false)
    expect(row.gates.failures.join(' ').toLowerCase()).toContain('likuid')
  })

  test('alasan gagal menyebut angkanya, bukan cuma label gagal', () => {
    const bars = healthy(320, 1000, 3000, 100)
    const row = buildRow(input({ bars, displayBars: bars.slice(-250) }))
    expect(row.gates.failures.join(' ')).toMatch(/Rp/)
  })

  test('emiten sehat dan likuid melewati gerbang likuiditas', () => {
    const row = buildRow(input())
    expect(row.gates.failures.join(' ').toLowerCase()).not.toContain('tidak likuid')
  })
})

describe('buildRow — peringkat', () => {
  test('memakai empat kolom saat semua data tersedia', () => {
    const row = buildRow(input({ foreignDays: foreign(1_000_000) }))
    expect(row.rank.used).toHaveLength(4)
    expect(row.rank.used).toEqual([...RANK_COLUMNS])
    expect(row.rank.degraded).toBe(false)
  })

  test('tanpa data asing, kolomnya dicoret dan ditandai terdegradasi', () => {
    const row = buildRow(input())
    expect(row.rank.used).not.toContain('asing')
    expect(row.rank.used).toHaveLength(3)
    expect(row.rank.degraded).toBe(true)
  })

  test('skor adalah rata-rata kolom yang DIPAKAI, bukan dibagi empat diam-diam', () => {
    const row = buildRow(input())
    const dipakai = row.rank.used.map((k) => row.rank.columns[k]!)
    const rataRata = dipakai.reduce((a, b) => a + b, 0) / dipakai.length
    expect(row.rank.score).toBeCloseTo(rataRata, 9)
  })

  test('skor selalu di 0..1', () => {
    for (const row of [buildRow(input()), buildRow(input({ foreignDays: foreign(-9e6) }))]) {
      expect(row.rank.score).toBeGreaterThanOrEqual(0)
      expect(row.rank.score).toBeLessThanOrEqual(1)
    }
  })

  test('Wyckoff dan VPA TIDAK PERNAH masuk kolom peringkat', () => {
    const row = buildRow(input({ foreignDays: foreign(1_000_000) }))
    const keys = Object.keys(row.rank.columns)
    expect(keys).not.toContain('wyckoff')
    expect(keys).not.toContain('vpa')
    expect(RANK_COLUMNS).not.toContain('wyckoff' as never)
  })

  test('akumulasi asing memberi skor lebih tinggi dari distribusi asing', () => {
    const beli = buildRow(input({ foreignDays: foreign(1_000_000) })).rank.score
    const jual = buildRow(input({ foreignDays: foreign(-1_000_000) })).rank.score
    expect(beli).toBeGreaterThan(jual)
  })
})

describe('buildRow — kelengkapan', () => {
  test('mengembalikan kedua belas metrik, termasuk yang tidak tersedia', () => {
    const row = buildRow(input())
    for (const key of ['volume', 'structure', 'levels', 'liquidity', 'vpa', 'wyckoff', 'flow', 'strength', 'filters', 'volatility', 'riskReward'] as const) {
      expect(row.metrics[key]).toBeDefined()
    }
  })

  test('metrik yang butuh IDX ditandai available false, bukan nol', () => {
    const row = buildRow(input())
    expect(row.metrics.flow.available).toBe(false)
    expect(row.metrics.flow.value).toBeNull()
  })

  test('umur data cache diteruskan ke metrik aliran asing', () => {
    const row = buildRow(
      input({ foreignDays: foreign(1_000_000), foreignStaleness: { asOf: '2026-09-12', daysOld: 4 } }),
    )
    expect(row.metrics.flow.staleness?.daysOld).toBe(4)
  })

  test('membawa kode, nama, close, dan tanggal bar terakhir', () => {
    const row = buildRow(input())
    expect(row.code).toBe('UJI')
    expect(row.name).toBe('Uji Tbk.')
    expect(row.date).toBe('2025-11-16')
    expect(row.close).toBeGreaterThan(0)
  })
})
