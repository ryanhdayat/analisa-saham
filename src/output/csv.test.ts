import { expect, test, describe } from 'bun:test'
import { toCsv, csvNumber } from './csv.ts'
import type { ScanRow } from '../analysis/report.ts'
import { CRYPTO, IDX } from '../market.ts'

function row(over: Partial<ScanRow> = {}): ScanRow {
  const m = (value: unknown, available = true) => ({
    value,
    verdict: 'v',
    confidence: 'sedang' as const,
    evidence: [],
    available,
  })
  return {
    code: 'BBCA',
    name: 'Bank Central Asia Tbk.',
    close: 6325,
    date: '2026-09-16',
    metrics: {
      volume: m({ rvol: 1.55, classification: 'permintaan-sejati', confirmationScore: 0.7, relativeSpread: 1, recent: [] }),
      structure: m({ daily: { structure: 'uptrend', phase: 'pullback' }, weekly: { structure: 'uptrend' }, aligned: true }),
      levels: m({ supports: [], resistances: [] }),
      liquidity: m({ avgDailyValue: 4.6e12, passesGate: true, freeFloatPct: 45.2 }),
      vpa: m({ events: [], latest: { signal: 'spring', date: '2026-09-08', index: 1, rvol: 2.4, note: '' } }),
      wyckoff: m({ phase: 'markup', reasons: [] }),
      flow: m(null, false),
      strength: m({ rs20: 1, rs60: 8.2, vsSector60: null, vsSector20: null, hiddenDemand: false, rsScore: 0.7 }),
      filters: m({ ma20: 1, ma50: 2, ma200: 3, stacked: true, trendScore: 0.8, obvDivergence: null, adDivergence: null }),
      volatility: m({ atr: 120, atrPct: 1.9, suggestedStop: 240 }),
      riskReward: m({ entry: 6325, stop: 6000, target: 7000, ratio: 2.08, passesGate: true }),
    },
    gates: { passed: true, failures: [] },
    rank: { score: 0.73, columns: { trend: 0.8, rs60: 0.7, rvol: 0.7, asing: null }, used: ['trend', 'rs60', 'rvol'], degraded: true },
    ...over,
  } as ScanRow
}

describe('csvNumber', () => {
  test('desimal pakai koma, sesuai Excel berlokal Indonesia', () => {
    expect(csvNumber(1.55, 2)).toBe('1,55')
  })

  test('tanpa pemisah ribuan, supaya Excel membacanya sebagai angka', () => {
    expect(csvNumber(1234567.5, 1)).toBe('1234567,5')
  })

  test('null jadi n/a, bukan nol', () => {
    expect(csvNumber(null, 2)).toBe('n/a')
  })
})

describe('toCsv', () => {
  const csv = toCsv([row()])
  const lines = csv.split('\n')

  test('memakai titik koma sebagai pemisah kolom', () => {
    expect(lines[0]).toContain(';')
    expect(lines[0]!.split(';').length).toBeGreaterThan(10)
  })

  test('baris data punya kolom sebanyak headernya', () => {
    expect(lines[1]!.split(';')).toHaveLength(lines[0]!.split(';').length)
  })

  test('kode emiten ada di kolom pertama', () => {
    expect(lines[0]!.split(';')[0]).toBe('KODE')
    expect(lines[1]!.split(';')[0]).toBe('BBCA')
  })

  test('metrik yang tidak tersedia ditulis n/a, tidak dipalsukan jadi nol', () => {
    expect(csv).toContain('n/a')
    expect(csv).not.toMatch(/;0;0;0/)
  })

  test('kolom peringkat yang dipakai ikut dicatat, supaya baris bisa dibandingkan', () => {
    expect(lines[0]).toContain('KOLOM_DIPAKAI')
    expect(lines[1]).toContain('trend|rs60|rvol')
  })

  test('nilai bertitik koma dikutip supaya tidak memecah kolom', () => {
    const berbahaya = row({ name: 'Emiten; Bermasalah' })
    const out = toCsv([berbahaya]).split('\n')[1]!
    expect(out.split(';')).toHaveLength(out.split(';').length) // tetap konsisten
    expect(out).toContain('"Emiten; Bermasalah"')
  })

  test('tanda kutip di dalam nilai digandakan sesuai aturan CSV', () => {
    const out = toCsv([row({ name: 'PT "Aneh" Tbk' })]).split('\n')[1]!
    expect(out).toContain('""Aneh""')
  })

  test('daftar kosong tetap menghasilkan header', () => {
    expect(toCsv([]).split('\n')[0]).toContain('KODE')
  })
})

describe('toCsv — header mata uang', () => {
  test('IDX melabeli nilai harian sebagai rupiah', () => {
    expect(toCsv([row()], IDX).split('\n')[0]).toContain('NILAI_HARIAN_RP')
  })

  test('crypto melabeli nilai harian sebagai dolar', () => {
    // CSV yang melabeli dolar sebagai rupiah adalah kesalahan diam.
    const header = toCsv([row()], CRYPTO).split('\n')[0]!
    expect(header).toContain('NILAI_HARIAN_USD')
    expect(header).not.toContain('NILAI_HARIAN_RP')
  })

  test('tanpa pasar disebut, bawaannya IDX', () => {
    expect(toCsv([row()]).split('\n')[0]).toBe(toCsv([row()], IDX).split('\n')[0])
  })
})
