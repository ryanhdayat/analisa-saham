import { expect, test, describe } from 'bun:test'
import { obv, adLine, analyzeFilters } from './filters.ts'
import type { Bar } from '../types.ts'

function b(close: number, volume = 1000, high = close + 5, low = close - 5): Bar {
  return { date: '2026-01-01', open: close, high, low, close, volume }
}

/** Deret naik/turun lurus sepanjang `count` bar. */
function ramp(from: number, to: number, count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const price = from + ((to - from) * i) / (count - 1)
    return {
      date: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      open: price,
      high: price + 5,
      low: price - 5,
      close: price,
      volume: 1_000_000,
    }
  })
}

describe('obv', () => {
  test('menambah volume di hari naik, mengurangi di hari turun', () => {
    expect(obv([b(100), b(110, 500), b(105, 300)])).toEqual([0, 500, 200])
  })

  test('harga tidak berubah tidak menggeser OBV', () => {
    expect(obv([b(100), b(100, 900)])).toEqual([0, 0])
  })
})

describe('adLine', () => {
  test('close di puncak rentang menyumbang seluruh volume', () => {
    expect(adLine([{ ...b(110), high: 110, low: 100, close: 110, volume: 1000 }])).toEqual([1000])
  })

  test('close di dasar rentang menyumbang negatif seluruh volume', () => {
    expect(adLine([{ ...b(100), high: 110, low: 100, close: 100, volume: 1000 }])).toEqual([-1000])
  })

  test('bar tanpa rentang tidak membagi dengan nol', () => {
    const result = adLine([{ ...b(100), high: 100, low: 100, close: 100, volume: 1000 }])
    expect(Number.isFinite(result[0]!)).toBe(true)
    expect(result[0]).toBe(0)
  })
})

describe('analyzeFilters', () => {
  test('deret naik panjang menghasilkan MA tersusun dan skor tinggi', () => {
    const m = analyzeFilters(ramp(1000, 3000, 260))
    expect(m.value!.stacked).toBe(true)
    expect(m.value!.trendScore).toBeGreaterThan(0.8)
  })

  test('deret turun panjang tidak tersusun dan skornya rendah', () => {
    const m = analyzeFilters(ramp(3000, 1000, 260))
    expect(m.value!.stacked).toBe(false)
    expect(m.value!.trendScore).toBeLessThan(0.3)
  })

  test('skor tren selalu di 0..1', () => {
    for (const bars of [ramp(1000, 3000, 260), ramp(3000, 1000, 260)]) {
      const s = analyzeFilters(bars).value!.trendScore
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  test('divergensi bullish: harga mencetak low baru, OBV justru lebih tinggi', () => {
    // Divergensi sungguhan butuh AKUMULASI BERSIH di antara dua low itu:
    // jual deras ke 900, pulih dengan volume besar, lalu merembes ke low sedikit
    // lebih rendah dengan volume tipis. OBV di low kedua berakhir lebih tinggi.
    const bars = [
      ...ramp(2000, 1000, 220),
      ...Array.from({ length: 20 }, (_, i) => b(1000 - i * 5, 5_000_000)), // low ~900
      ...Array.from({ length: 10 }, (_, i) => b(905 + i * 9, 4_000_000)), // pulih, OBV naik
      ...Array.from({ length: 10 }, (_, i) => b(990 - i * 10, 200_000)), // low ~890, volume tipis
    ]
    const m = analyzeFilters(bars)
    expect(m.value!.obvDivergence).toBe('bullish')
  })

  test('bar terlalu sedikit untuk MA 200 menghasilkan available false', () => {
    expect(analyzeFilters(ramp(1000, 2000, 50)).available).toBe(false)
  })

  test('bukti menyebut nilai MA-nya', () => {
    const ev = analyzeFilters(ramp(1000, 3000, 260)).evidence
    expect(ev.some((e) => /MA ?200/i.test(e))).toBe(true)
  })
})
