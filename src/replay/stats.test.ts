import { expect, test, describe } from 'bun:test'
import { bucketize, forwardReturn, rankColumns, sampleIndices, summarizeBucket, type Sample } from './stats.ts'
import type { Bar } from '../types.ts'

const bars = (closes: number[]): Bar[] =>
  closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: c, high: c, low: c, close: c, volume: 1 }))

const sample = (values: Sample['values'], fwd: number | null, outcome: Sample['outcome'] = null): Sample => ({
  code: 'X', date: '2026-01-01', values, fwd, outcome,
})

describe('forwardReturn', () => {
  test('close h bar ke depan dibagi close hari ini', () => {
    expect(forwardReturn(bars([100, 105, 110]), 0, 2)).toBeCloseTo(0.1, 9)
  })

  test('close nol (koin mati di data Yahoo) → null, bukan Infinity/NaN yang merusak rata-rata', () => {
    expect(forwardReturn(bars([0, 1, 2]), 0, 2)).toBeNull()
    expect(forwardReturn(bars([1, 1, 0]), 0, 2)).toBeNull()
  })

  test('melewati ujung data → null, bukan dianggap datar', () => {
    expect(forwardReturn(bars([100, 105]), 0, 2)).toBeNull()
  })
})

describe('sampleIndices', () => {
  test('mundur dari bar terakhir per langkah, hanya yang sejarahnya cukup', () => {
    // 20 bar, butuh 10 bar sejarah (indeks ≥ 9), langkah 5, maksimal 100 bar ke belakang.
    expect(sampleIndices(20, { step: 5, minHistory: 10, lookback: 100 })).toEqual([9, 14, 19])
  })

  test('lookback membatasi seberapa jauh ke belakang', () => {
    expect(sampleIndices(20, { step: 5, minHistory: 1, lookback: 10 })).toEqual([9, 14, 19])
  })
})

describe('bucketize', () => {
  test('kolom teks dikelompokkan per nilai, null jadi n/a', () => {
    const s = [sample({ FASE: 'pullback' }, 0.1), sample({ FASE: 'rebound' }, 0), sample({ FASE: null }, 0)]
    const b = bucketize(s, 'FASE')
    expect(b.map((x) => [x.label, x.samples.length])).toEqual([
      ['n/a', 1],
      ['pullback', 1],
      ['rebound', 1],
    ])
  })

  test('angka dengan sedikit nilai unik diperlakukan sebagai kategori', () => {
    const s = [0, 0.2, 0.2, 1].map((v) => sample({ TREND: v }, 0))
    expect(bucketize(s, 'TREND').map((x) => x.label)).toEqual(['0', '0,2', '1'])
  })

  test('angka kontinu dibagi lima kuantil berurutan', () => {
    const s = Array.from({ length: 100 }, (_, i) => sample({ RS60_POIN: i }, 0))
    const b = bucketize(s, 'RS60_POIN')
    expect(b).toHaveLength(5)
    expect(b.map((x) => x.samples.length)).toEqual([20, 20, 20, 20, 20])
    expect(b[0]!.label).toBe('Q1 (≤ 19)')
    expect(b[4]!.label).toBe('Q5 (> 79)')
  })
})

describe('summarizeBucket', () => {
  test('persen naik, rata-rata dan median return maju, serta hasil target/cut loss', () => {
    const s = [
      sample({}, 0.1, { status: 'target', ret: 0.2 }),
      sample({}, -0.05, { status: 'cut', ret: -0.08 }),
      sample({}, 0.02, { status: 'open', ret: 0.01 }),
      sample({}, null, null),
    ]
    const r = summarizeBucket('semua', s)
    expect(r).toMatchObject({ label: 'semua', n: 4, nFwd: 3, nSettled: 2 })
    expect(r.naik).toBeCloseTo(2 / 3, 9)
    expect(r.rata).toBeCloseTo((0.1 - 0.05 + 0.02) / 3, 9)
    expect(r.median).toBeCloseTo(0.02, 9)
    expect(r.kenaTarget).toBeCloseTo(0.5, 9)
    expect(r.rataTrade).toBeCloseTo((0.2 - 0.08) / 2, 9)
  })
})

describe('rankColumns', () => {
  test('kolom diurutkan dari selisih persen naik terbesar antar-kelompoknya', () => {
    const s = [
      ...Array.from({ length: 50 }, () => sample({ A: 'x', B: 'p' }, 0.1)),
      ...Array.from({ length: 50 }, () => sample({ A: 'y', B: 'p' }, -0.1)),
      ...Array.from({ length: 50 }, () => sample({ A: 'x', B: 'q' }, 0.1)),
      ...Array.from({ length: 50 }, () => sample({ A: 'y', B: 'q' }, -0.1)),
    ]
    const r = rankColumns(s, ['B', 'A'], 10)
    expect(r.map((c) => c.column)).toEqual(['A', 'B'])
    expect(r[0]!.spread).toBeCloseTo(1, 9)
    expect(r[1]!.spread).toBeCloseTo(0, 9)
  })

  test('kelompok n/a tidak ikut menentukan selisih — itu data yang hilang, bukan sinyal', () => {
    const s = [
      ...Array.from({ length: 50 }, () => sample({ A: 'x' }, 0.1)),
      ...Array.from({ length: 50 }, () => sample({ A: null }, 0)),
    ]
    expect(rankColumns(s, ['A'], 10)[0]!.spread).toBe(0)
  })

  test('kelompok di bawah ambang jumlah sampel tidak ikut menentukan selisih', () => {
    const s = [
      ...Array.from({ length: 50 }, () => sample({ A: 'x' }, 0.1)),
      sample({ A: 'langka' }, -0.1),
    ]
    expect(rankColumns(s, ['A'], 10)[0]!.spread).toBe(0)
  })
})
