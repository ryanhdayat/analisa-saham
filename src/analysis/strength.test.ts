import { expect, test, describe } from 'bun:test'
import { analyzeStrength } from './strength.ts'
import type { Bar } from '../types.ts'

/** Deret dengan tanggal berurutan dan harga yang ditentukan. */
function series(prices: number[]): Bar[] {
  return prices.map((p, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    volume: 1_000_000,
  }))
}

const naik = (n: number, pct: number) =>
  series(Array.from({ length: n }, (_, i) => 1000 * (1 + (pct / 100) * (i / (n - 1)))))

describe('analyzeStrength', () => {
  test('emiten naik lebih kencang dari IHSG punya RS positif', () => {
    const m = analyzeStrength(naik(70, 20), naik(70, 5))
    expect(m.value!.rs60).toBeGreaterThan(0)
  })

  test('emiten tertinggal dari IHSG punya RS negatif', () => {
    const m = analyzeStrength(naik(70, 2), naik(70, 15))
    expect(m.value!.rs60).toBeLessThan(0)
  })

  test('bertahan saat IHSG turun ditandai sebagai permintaan tersembunyi', () => {
    const m = analyzeStrength(naik(70, 3), naik(70, -10))
    expect(m.value!.hiddenDemand).toBe(true)
    expect(m.verdict).toMatch(/tersembunyi/i)
  })

  test('ikut turun bersama IHSG bukan permintaan tersembunyi', () => {
    expect(analyzeStrength(naik(70, -12), naik(70, -10)).value!.hiddenDemand).toBe(false)
  })

  test('tanggal disejajarkan: hari yang tidak ada di indeks tidak dipakai', () => {
    // Indeks kehilangan separuh harinya; yang tersisa masih cukup untuk 60 hari.
    const stock = naik(200, 10)
    const index = naik(200, 5).filter((_, i) => i % 2 === 0)
    const m = analyzeStrength(stock, index)
    expect(m.available).toBe(true)
    expect(Number.isFinite(m.value!.rs60)).toBe(true)
  })

  test('kekuatan relatif terhadap sektor kosong kalau data sektor tidak ada', () => {
    const m = analyzeStrength(naik(70, 10), naik(70, 5))
    expect(m.value!.vsSector60).toBeNull()
  })

  test('kekuatan relatif terhadap sektor terisi kalau datanya ada', () => {
    const m = analyzeStrength(naik(70, 10), naik(70, 5), naik(70, 8))
    expect(m.value!.vsSector60).toBeCloseTo(2, 0)
  })

  test('skor RS dinormalkan ke 0..1 untuk pemeringkatan', () => {
    for (const m of [analyzeStrength(naik(70, 30), naik(70, 0)), analyzeStrength(naik(70, -30), naik(70, 0))]) {
      expect(m.value!.rsScore).toBeGreaterThanOrEqual(0)
      expect(m.value!.rsScore).toBeLessThanOrEqual(1)
    }
    const kuat = analyzeStrength(naik(70, 30), naik(70, 0)).value!.rsScore
    const lemah = analyzeStrength(naik(70, -30), naik(70, 0)).value!.rsScore
    expect(kuat).toBeGreaterThan(lemah)
  })

  test('riwayat terlalu pendek menghasilkan available false', () => {
    expect(analyzeStrength(naik(10, 5), naik(10, 5)).available).toBe(false)
  })

  test('tidak ada tanggal yang beririsan menghasilkan available false', () => {
    const stock = naik(70, 10)
    const index = series(Array.from({ length: 70 }, () => 1000)).map((b, i) => ({
      ...b,
      date: new Date(Date.UTC(2030, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    }))
    expect(analyzeStrength(stock, index).available).toBe(false)
  })
})
