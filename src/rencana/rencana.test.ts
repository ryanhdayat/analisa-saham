import { expect, test, describe } from 'bun:test'
import { biaya, hitungLot, rencanaIdx, returnBersih } from './rencana.ts'

// Angka nyata scan 23 Okt 2026.
describe('rencanaIdx', () => {
  test('ULTJ: cut loss dijepit −5%, lot dibatasi 20% modal', () => {
    expect(rencanaIdx(2100, 2022.543, 2190)).toMatchObject({ beli: 2100, jualRugi: 1995, jualUntung: 2190, lot: 95 })
  })

  test('AADI: lot dari aturan rugi 1%', () => {
    expect(rencanaIdx(11375, 10560, 11700).lot).toBe(12)
  })

  test('rugi dan untung rupiah sudah dipotong biaya', () => {
    const r = rencanaIdx(2100, 2022.543, 2190)
    expect(r.rugiRp).toBeCloseTo(95 * 100 * (1995 - 2100) - biaya(2100, 1995, 95), 6)
    expect(r.untungRp).toBeCloseTo(95 * 100 * (2190 - 2100) - biaya(2100, 2190, 95), 6)
    expect(r.nilai).toBe(95 * 100 * 2100)
  })

  test('modal terlalu kecil → lot 0', () => {
    expect(rencanaIdx(11375, 10560, 11700, 1_000_000).lot).toBe(0)
  })
})

describe('hitungLot', () => {
  test('menolak modal tidak sah', () => {
    for (const m of [0, -5, NaN, Infinity]) expect(hitungLot(2100, 1995, m)).toBe(0)
  })

  test('jual rugi tidak di bawah harga beli → 0', () => {
    expect(hitungLot(2100, 2100, 1e8)).toBe(0)
  })
})

describe('returnBersih', () => {
  test('memotong biaya beli dan jual', () => {
    expect(returnBersih(1000, 1000)).toBeCloseTo(0.9975 / 1.0015 - 1, 9)
  })
})
