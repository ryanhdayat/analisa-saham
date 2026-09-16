import { expect, test, describe } from 'bun:test'
import { movingAverage, volumeProfile } from './indicators.ts'
import type { Bar } from './types.ts'

/** Bar ringkas untuk fixture; tanggal tidak dipakai oleh matematika di sini. */
function bar(open: number, high: number, low: number, close: number, volume: number): Bar {
  return { date: '2026-01-01', open, high, low, close, volume }
}

describe('movingAverage', () => {
  test('null sebelum periode terpenuhi, rata-rata sesudahnya', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  test('periode 1 mengembalikan deret aslinya', () => {
    expect(movingAverage([7, 8, 9], 1)).toEqual([7, 8, 9])
  })

  test('deret lebih pendek dari periode menghasilkan null semua', () => {
    expect(movingAverage([1, 2], 5)).toEqual([null, null])
  })

  test('deret kosong menghasilkan deret kosong', () => {
    expect(movingAverage([], 20)).toEqual([])
  })

  test('tidak hanyut oleh akumulasi float pada deret panjang', () => {
    const values = Array.from({ length: 500 }, (_, i) => 6000 + (i % 7) * 12.5)
    const ma = movingAverage(values, 200)
    const last = ma[ma.length - 1]
    const expected = values.slice(-200).reduce((a, b) => a + b, 0) / 200
    expect(last).toBeCloseTo(expected, 9)
  })
})

describe('volumeProfile', () => {
  const bars: Bar[] = [
    bar(100, 110, 100, 108, 1000), // naik
    bar(108, 112, 104, 105, 2000), // turun
    bar(105, 120, 102, 118, 3000), // naik
  ]

  test('bin membentang dari low global ke high global', () => {
    const p = volumeProfile(bars, 4)
    expect(p.bins).toHaveLength(4)
    expect(p.bins[0]!.low).toBeCloseTo(100, 9)
    expect(p.bins[3]!.high).toBeCloseTo(120, 9)
  })

  test('total volume seluruh bin sama dengan volume masukan', () => {
    const p = volumeProfile(bars, 24)
    const summed = p.bins.reduce((a, b) => a + b.volume, 0)
    expect(summed).toBeCloseTo(6000, 6)
    expect(p.totalVolume).toBeCloseTo(6000, 6)
  })

  test('upVolume + downVolume sama dengan volume di tiap bin', () => {
    const p = volumeProfile(bars, 24)
    for (const b of p.bins) {
      expect(b.upVolume + b.downVolume).toBeCloseTo(b.volume, 6)
    }
  })

  test('hari naik masuk upVolume, hari turun masuk downVolume', () => {
    const p = volumeProfile([bar(100, 110, 100, 108, 1000)], 2)
    expect(p.bins.reduce((a, b) => a + b.upVolume, 0)).toBeCloseTo(1000, 6)
    expect(p.bins.reduce((a, b) => a + b.downVolume, 0)).toBe(0)
  })

  test('bar tanpa rentang (low === high) masuk utuh ke satu bin', () => {
    const flat: Bar[] = [bar(100, 110, 100, 105, 500), bar(104, 104, 104, 104, 900)]
    const p = volumeProfile(flat, 10)
    const holding = p.bins.filter((b) => b.volume > 0 && b.low <= 104 && b.high >= 104)
    expect(holding.length).toBeGreaterThan(0)
    expect(p.bins.reduce((a, b) => a + b.volume, 0)).toBeCloseTo(1400, 6)
  })

  test('share adalah bagian volume bin terhadap total, menjumlah jadi 1', () => {
    const p = volumeProfile(bars, 12)
    expect(p.bins.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 9)
  })

  test('pocIndex menunjuk bin dengan volume terbesar', () => {
    const p = volumeProfile(bars, 12)
    const max = Math.max(...p.bins.map((b) => b.volume))
    expect(p.bins[p.pocIndex]!.volume).toBeCloseTo(max, 9)
  })

  test('seluruh bar datar di satu harga tetap menghasilkan profil yang sah', () => {
    const p = volumeProfile([bar(50, 50, 50, 50, 700)], 5)
    expect(p.totalVolume).toBeCloseTo(700, 6)
    expect(p.bins.reduce((a, b) => a + b.volume, 0)).toBeCloseTo(700, 6)
  })

  test('bar kosong menghasilkan profil kosong, bukan lempar', () => {
    const p = volumeProfile([], 24)
    expect(p.bins).toHaveLength(0)
    expect(p.totalVolume).toBe(0)
  })
})
