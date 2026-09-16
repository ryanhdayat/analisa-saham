import { expect, test, describe } from 'bun:test'
import { findSwings, analyzeStructure } from './structure.ts'
import type { Bar } from '../types.ts'

/**
 * Deret zigzag: berjalan lurus dari satu harga pivot ke pivot berikutnya,
 * `steps` bar tiap ruas. Menghasilkan swing yang terpisah rapi.
 */
function zigzag(pivots: number[], steps = 5): Bar[] {
  const bars: Bar[] = []
  let day = 0
  const nextDate = () => {
    day++
    const d = new Date(Date.UTC(2026, 0, 1) + day * 86400000)
    return d.toISOString().slice(0, 10)
  }
  for (let p = 0; p < pivots.length - 1; p++) {
    const from = pivots[p]!
    const to = pivots[p + 1]!
    for (let s = 1; s <= steps; s++) {
      const price = from + ((to - from) * s) / steps
      const prev = bars[bars.length - 1]?.close ?? from
      bars.push({ date: nextDate(), open: prev, high: price + 2, low: price - 2, close: price, volume: 1_000_000 })
    }
  }
  return bars
}

describe('findSwings', () => {
  test('menemukan puncak dan lembah zigzag', () => {
    const { highs, lows } = findSwings(zigzag([100, 130, 115, 150]), 3)
    expect(highs.map((h) => Math.round(h.price))).toContain(132) // 130 + 2
    expect(lows.map((l) => Math.round(l.price))).toContain(113) // 115 - 2
  })

  test('deret naik lurus tanpa belokan tidak punya swing di tengah', () => {
    const straight = zigzag([100, 200], 20)
    expect(findSwings(straight, 3).highs).toHaveLength(0)
  })

  test('deret terlalu pendek tidak melempar', () => {
    expect(() => findSwings(zigzag([100, 110], 1), 3)).not.toThrow()
  })
})

describe('analyzeStructure', () => {
  const naik = zigzag([100, 130, 115, 150, 135, 170])
  const turun = zigzag([170, 140, 155, 120, 135, 100])
  const datar = zigzag([100, 120, 100, 120, 100, 120])

  test('puncak dan lembah yang sama-sama meninggi adalah uptrend', () => {
    expect(analyzeStructure(naik, naik).value!.daily.structure).toBe('uptrend')
  })

  test('puncak dan lembah yang sama-sama menurun adalah downtrend', () => {
    expect(analyzeStructure(turun, turun).value!.daily.structure).toBe('downtrend')
  })

  test('puncak dan lembah yang mendatar adalah sideways', () => {
    expect(analyzeStructure(datar, datar).value!.daily.structure).toBe('sideways')
  })

  test('harga mundur dari puncak terakhir dalam uptrend adalah pullback', () => {
    const pullback = [...naik, ...zigzag([170, 155], 5).slice(0, 5)]
    expect(analyzeStructure(pullback, pullback).value!.daily.phase).toBe('pullback')
  })

  test('harga naik dari lembah terakhir dalam downtrend adalah rebound', () => {
    const rebound = [...turun, ...zigzag([100, 115], 5).slice(0, 5)]
    expect(analyzeStructure(rebound, rebound).value!.daily.phase).toBe('rebound')
  })

  test('harian dan mingguan sejalan menaikkan keyakinan', () => {
    const sejalan = analyzeStructure(naik, naik)
    const bertentangan = analyzeStructure(naik, turun)
    expect(sejalan.value!.aligned).toBe(true)
    expect(bertentangan.value!.aligned).toBe(false)
    expect(sejalan.confidence).toBe('tinggi')
    expect(bertentangan.confidence).toBe('rendah')
  })

  test('vonis menyebut kedua timeframe', () => {
    const v = analyzeStructure(naik, turun).verdict
    expect(v).toContain('harian')
    expect(v).toContain('mingguan')
  })

  test('bukti mencantumkan tanggal swing, bukan cuma label struktur', () => {
    const ev = analyzeStructure(naik, naik).evidence
    expect(ev.some((e) => /\d{4}-\d{2}-\d{2}/.test(e))).toBe(true)
  })

  test('bar terlalu sedikit untuk dua swing menghasilkan available false', () => {
    const pendek = zigzag([100, 110], 3)
    expect(analyzeStructure(pendek, pendek).available).toBe(false)
  })
})
