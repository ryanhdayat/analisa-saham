import { expect, test, describe } from 'bun:test'
import { analyzeVolume } from './volume.ts'
import type { Bar } from '../types.ts'

/** Deret dasar bervolume rata, supaya RVOL bar terakhir mudah dikendalikan. */
function base(count: number, volume = 1_000_000): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: 1000,
    high: 1010,
    low: 990,
    close: 1000,
    volume,
  }))
}

function append(bars: Bar[], b: Partial<Bar> & { close: number; volume: number }): Bar[] {
  const prev = bars[bars.length - 1]!
  return [
    ...bars,
    {
      date: '2026-02-02',
      open: b.open ?? prev.close,
      high: b.high ?? Math.max(prev.close, b.close) + 5,
      low: b.low ?? Math.min(prev.close, b.close) - 5,
      close: b.close,
      volume: b.volume,
    },
  ]
}

describe('analyzeVolume', () => {
  test('RVOL adalah volume hari ini dibagi rata-rata 20 hari', () => {
    const bars = append(base(25), { close: 1010, volume: 2_000_000 })
    expect(analyzeVolume(bars).value!.rvol).toBeCloseTo(2, 1)
  })

  test('naik dengan volume di atas rata-rata: permintaan sejati', () => {
    const bars = append(base(25), { close: 1030, volume: 1_600_000 })
    expect(analyzeVolume(bars).value!.classification).toBe('permintaan-sejati')
  })

  test('naik dengan volume mengering: rally lemah', () => {
    const bars = append(base(25), { close: 1030, volume: 600_000 })
    expect(analyzeVolume(bars).value!.classification).toBe('rally-lemah')
  })

  test('turun dengan volume mengering: koreksi sehat', () => {
    const bars = append(base(25), { close: 970, volume: 600_000 })
    expect(analyzeVolume(bars).value!.classification).toBe('koreksi-sehat')
  })

  test('turun dengan volume membesar: tekanan jual nyata', () => {
    const bars = append(base(25), { close: 970, volume: 1_800_000 })
    expect(analyzeVolume(bars).value!.classification).toBe('tekanan-jual')
  })

  test('volume sangat tinggi dengan spread sempit: absorpsi, mengalahkan klasifikasi lain', () => {
    // Spread 2 lawan rata-rata 20, volume 2x rata-rata, harga nyaris tak bergerak.
    const bars = append(base(25), { close: 1001, volume: 2_000_000, high: 1002, low: 1000 })
    expect(analyzeVolume(bars).value!.classification).toBe('absorpsi')
  })

  test('vonis menyebut RVOL-nya, bukan cuma label', () => {
    const bars = append(base(25), { close: 1030, volume: 1_600_000 })
    expect(analyzeVolume(bars).verdict).toMatch(/1[,.]6/)
  })

  test('bukti memuat tanggal dan angka, bukan kalimat kosong', () => {
    const bars = append(base(25), { close: 1030, volume: 1_600_000 })
    const ev = analyzeVolume(bars).evidence
    expect(ev.length).toBeGreaterThan(0)
    expect(ev.some((e) => e.includes('2026-02-02'))).toBe(true)
  })

  test('skor konfirmasi 0..1 dan naik saat volume mengikuti arah harga', () => {
    const confirming = analyzeVolume(append(base(25), { close: 1030, volume: 1_600_000 }))
    const contradicting = analyzeVolume(append(base(25), { close: 1030, volume: 300_000 }))
    const a = confirming.value!.confirmationScore
    const b = contradicting.value!.confirmationScore
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(1)
    expect(a).toBeGreaterThan(b)
  })

  test('bar terlalu sedikit untuk rata-rata 20 hari menghasilkan available false', () => {
    const m = analyzeVolume(base(8))
    expect(m.available).toBe(false)
    expect(m.value).toBeNull()
  })
})
