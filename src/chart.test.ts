import { expect, test, describe } from 'bun:test'
import { buildChartInput, MA_PERIODS } from './chart.ts'
import type { Bar } from './types.ts'

/** Deret sintetis naik satu rupiah per hari, volume tetap. */
function series(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: 1000 + i,
    high: 1005 + i,
    low: 995 + i,
    close: 1000 + i,
    volume: 1_000_000,
  }))
}

const data = (bars: Bar[]) => ({ name: 'Uji Tbk.', symbol: 'UJI.JK', bars })

describe('buildChartInput', () => {
  test('hanya bar jendela tampil yang digambar', () => {
    const input = buildChartInput(data(series(500)), 250, 24)
    expect(input.bars).toHaveLength(250)
    expect(input.bars[0]!.close).toBe(1250) // bar ke-251 dari 500
  })

  test('MA 200 sudah bernilai di bar pertama yang digambar kalau pemanasan cukup', () => {
    const input = buildChartInput(data(series(500)), 250, 24)
    const ma200 = input.priceMA.get(200)!
    expect(ma200).toHaveLength(250)
    expect(ma200[0]).not.toBeNull()
    // Rata-rata 200 close yang berakhir di 1250 = 1250 - 99,5.
    expect(ma200[0]).toBeCloseTo(1150.5, 6)
  })

  test('riwayat kurang dari pemanasan menyisakan null di awal, bukan error', () => {
    const input = buildChartInput(data(series(60)), 250, 24)
    expect(input.bars).toHaveLength(60)
    const ma200 = input.priceMA.get(200)!
    expect(ma200.every((v) => v === null)).toBe(true)
    const ma10 = input.priceMA.get(10)!
    expect(ma10[0]).toBeNull()
    expect(ma10[9]).not.toBeNull()
  })

  test('semua periode MA yang diminta tersedia dan sejajar dengan bar', () => {
    const input = buildChartInput(data(series(500)), 250, 24)
    for (const p of MA_PERIODS) {
      expect(input.priceMA.get(p)).toHaveLength(250)
    }
    expect(input.volumeMA).toHaveLength(250)
  })

  test('MA volume memakai volume lembar mentah, bukan nol', () => {
    const input = buildChartInput(data(series(300)), 250, 24)
    expect(input.volumeMA[input.volumeMA.length - 1]).toBeCloseTo(1_000_000, 6)
  })

  test('profil volume dihitung atas bar yang digambar saja, bukan pemanasan', () => {
    const input = buildChartInput(data(series(500)), 250, 24)
    expect(input.profile.totalVolume).toBe(250 * 1_000_000)
    // Rentang bar yang digambar: low bar ke-251 sampai high bar terakhir.
    expect(input.profile.bins[0]!.low).toBeCloseTo(1245, 6)
    expect(input.profile.bins[23]!.high).toBeCloseTo(1504, 6)
  })

  test('jendela tampil lebih panjang dari riwayat memakai seluruh riwayat', () => {
    const input = buildChartInput(data(series(30)), 250, 24)
    expect(input.bars).toHaveLength(30)
  })

  test('jumlah baris profil diteruskan untuk legenda', () => {
    expect(buildChartInput(data(series(300)), 250, 12).profileRows).toBe(12)
  })
})
