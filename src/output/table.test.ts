import { expect, test, describe } from 'bun:test'
import { renderTable } from './table.ts'
import type { ScanRow } from '../analysis/report.ts'
import { CRYPTO, IDX } from '../market.ts'

function row(over: Partial<ScanRow> = {}): ScanRow {
  const m = (value: unknown, available = true) => ({
    value, verdict: 'v', confidence: 'sedang' as const, evidence: [], available,
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

describe('renderTable', () => {
  test('mencetak kode dan skor tiap emiten', () => {
    const out = renderTable([row()], [])
    expect(out).toContain('BBCA')
    expect(out).toContain('0,73')
  })

  test('memberi spanduk kalau ada baris yang terdegradasi', () => {
    const out = renderTable([row()], [])
    expect(out.toLowerCase()).toContain('terdegradasi')
    expect(out).toContain('asing')
  })

  test('tanpa degradasi tidak ada spanduk', () => {
    const lengkap = row({
      rank: { score: 0.7, columns: { trend: 0.8, rs60: 0.7, rvol: 0.7, asing: 0.6 }, used: ['trend', 'rs60', 'rvol', 'asing'], degraded: false },
    })
    expect(renderTable([lengkap], []).toLowerCase()).not.toContain('terdegradasi')
  })

  test('emiten yang tersaring keluar didaftar berikut alasannya', () => {
    const gagal = row({ code: 'SRAJ', gates: { passed: false, failures: ['TIDAK LIKUID — Rp 0.42 M per hari'] } })
    const out = renderTable([], [gagal])
    expect(out).toContain('SRAJ')
    expect(out).toContain('TIDAK LIKUID')
  })

  test('umur data asing dicetak di selnya, bukan cuma di header', () => {
    const basi = row()
    basi.metrics.flow = { ...basi.metrics.flow, available: true, value: { net20: 1, value20: 1 } as never, staleness: { asOf: '2026-09-12', daysOld: 4 } }
    basi.rank.columns.asing = 0.6
    basi.rank.used = ['trend', 'rs60', 'rvol', 'asing']
    basi.rank.degraded = false
    expect(renderTable([basi], [])).toContain('4h')
  })

  test('daftar kosong tetap mencetak sesuatu yang bisa dibaca', () => {
    expect(renderTable([], []).length).toBeGreaterThan(0)
  })
})

describe('renderTable — per pasar', () => {
  test('crypto tidak memberi spanduk hanya karena asing kosong', () => {
    // Baris yang sama terdegradasi di IDX, tapi TIDAK di crypto: asing memang
    // tidak punya padanan di sana. Kalau spanduknya tetap muncul, peringatan itu
    // menyala di setiap run dan berhenti berarti.
    expect(renderTable([row()], [], IDX).toLowerCase()).toContain('terdegradasi')
    expect(renderTable([row()], [], CRYPTO).toLowerCase()).not.toContain('terdegradasi')
  })

  test('crypto tetap memberi spanduk kalau kolom yang diharapkan hilang', () => {
    const kurang = row({
      rank: { score: 0.5, columns: { trend: 0.8, rs60: null, rvol: 0.7, asing: null }, used: ['trend', 'rvol'], degraded: true },
    })
    const out = renderTable([kurang], [], CRYPTO)
    expect(out.toLowerCase()).toContain('terdegradasi')
    expect(out).toContain('rs60')
    expect(out).not.toContain('asing,')
  })

  test('nilai harian dicetak dalam mata uang pasarnya', () => {
    // Fixture bawaannya angka rupiah (4,6 triliun), jadi pakai besaran yang wajar
    // untuk crypto supaya pernyataannya benar-benar menguji satuannya.
    expect(renderTable([row()], [], IDX)).toContain('Rp4600.0M')

    const m = (value: unknown) => ({ value, verdict: 'v', confidence: 'sedang' as const, evidence: [], available: true })
    const coin = row({
      metrics: { ...row().metrics, liquidity: m({ avgDailyValue: 3e10, passesGate: true, freeFloatPct: null }) },
    } as Partial<ScanRow>)
    const out = renderTable([coin], [], CRYPTO)
    expect(out).toContain('$30.0B')
    expect(out).not.toContain('Rp')
  })
})

describe('renderTable — kebersihan keluaran crypto', () => {
  test('kode panjang tidak terpotong', () => {
    // 'BTC-USD' terpotong jadi 'BTC-US' pada lebar 6 — ambigu dan salah.
    const coin = row({ code: 'BTC-USD' })
    const out = renderTable([coin], [], CRYPTO)
    expect(out).toContain('BTC-USD')
    expect(out).not.toMatch(/BTC-US[^D]/)
  })

  test('kode panjang tetap utuh di daftar tersaring keluar', () => {
    const coin = row({ code: 'RENDER-USD', gates: { passed: false, failures: ['R:R TIPIS'] } })
    expect(renderTable([], [coin], CRYPTO)).toContain('RENDER-USD')
  })

  test('kolom ASING20 tidak dicetak di pasar tanpa lapisan IDX', () => {
    expect(renderTable([row()], [], IDX)).toContain('ASING20')
    expect(renderTable([row()], [], CRYPTO)).not.toContain('ASING20')
  })

  test('catatan soal aliran asing hanya muncul di pasar yang punya datanya', () => {
    expect(renderTable([row()], [], IDX)).toContain('estimasi rupiah')
    expect(renderTable([row()], [], CRYPTO)).not.toContain('estimasi rupiah')
    // Catatan heuristik Wyckoff/VPA tetap relevan di kedua pasar.
    expect(renderTable([row()], [], CRYPTO)).toContain('heuristik')
  })
})

describe('renderTable — lebar kolom kode mengikuti isinya', () => {
  test('kode sepanjang apa pun tidak terpotong', () => {
    // Ticker crypto yang dibedakan Yahoo bisa 18 karakter (BABYSHARK37672-USD).
    // Lebar tetap apa pun akhirnya kurang; jadi diukur dari barisnya.
    const panjang = row({ code: 'BABYSHARK37672-USD' })
    expect(renderTable([panjang], [], CRYPTO)).toContain('BABYSHARK37672-USD')
  })

  test('juga di daftar tersaring keluar', () => {
    const panjang = row({ code: 'BROCCOLI35753-USD', gates: { passed: false, failures: ['R:R TIPIS'] } })
    expect(renderTable([], [panjang], CRYPTO)).toContain('BROCCOLI35753-USD')
  })

  test('kode pendek tidak mengecilkan kolom di bawah lebar minimum pasarnya', () => {
    // IDX empat huruf dengan minimum 6 — perataannya harus tetap seperti semula.
    const out = renderTable([row({ code: 'BBCA' })], [], IDX)
    expect(out).toContain('KODE  ')
  })
})
