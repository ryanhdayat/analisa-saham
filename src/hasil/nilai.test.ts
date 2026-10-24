import { expect, test, describe } from 'bun:test'
import { bolehCatat, buildPicks, cutLoss, judge, judgeIdx, pilihanFromRows, summarize, yahooRangeSince, type Pilihan } from './nilai.ts'
import { CRYPTO, IDX } from '../market.ts'
import type { ScanRow } from '../analysis/report.ts'
import type { Bar } from '../types.ts'

function bar(date: string, low: number, high: number, close = (low + high) / 2, open = close): Bar {
  return { date, open, high, low, close, volume: 1000 }
}

const pilihan = (over: Partial<Pilihan> = {}): Pilihan => ({
  code: 'BBCA',
  name: 'Bank Central Asia',
  date: '2026-10-01',
  entry: 1000,
  stop: 920,
  target: 1200,
  ...over,
})

describe('cutLoss', () => {
  test('stop analisa di antara 5% dan 10% dipakai apa adanya', () => {
    expect(cutLoss(1000, 930)).toBe(930)
  })

  test('stop lebih dalam dari 10% dikencangkan ke -10%', () => {
    expect(cutLoss(1000, 600)).toBeCloseTo(900, 6)
  })

  test('stop lebih dangkal dari 5% dilonggarkan ke -5%', () => {
    expect(cutLoss(1000, 980)).toBeCloseTo(950, 6)
  })
})

describe('judge', () => {
  test('high menyentuh target → benar, keluar di target', () => {
    const h = judge(pilihan(), [bar('2026-10-01', 990, 1010), bar('2026-10-02', 1000, 1100), bar('2026-10-03', 1100, 1210)])
    expect(h.status).toBe('target')
    expect(h.settled).toBe('2026-10-03')
    expect(h.exit).toBe(1200)
    expect(h.ret).toBeCloseTo(0.2, 6)
    expect(h.days).toBe(2)
  })

  test('low menyentuh cut loss → salah, keluar di cut loss', () => {
    const h = judge(pilihan(), [bar('2026-10-02', 910, 1000)])
    expect(h.status).toBe('cut')
    expect(h.exit).toBe(920)
    expect(h.ret).toBeCloseTo(-0.08, 6)
  })

  test('target dan cut loss di hari yang sama dihitung cut loss', () => {
    const h = judge(pilihan(), [bar('2026-10-02', 900, 1250)])
    expect(h.status).toBe('cut')
  })

  test('gap turun di bawah cut loss keluar di harga buka, bukan di cut loss', () => {
    const h = judge(pilihan(), [bar('2026-10-02', 850, 890, 880, 880)])
    expect(h.exit).toBe(880)
  })

  test('bar pada tanggal scan sendiri diabaikan', () => {
    // Entry adalah close hari scan; low/high hari itu terjadi sebelum entry.
    const h = judge(pilihan(), [bar('2026-10-01', 800, 1300)])
    expect(h.status).toBe('open')
    expect(h.days).toBe(0)
  })

  test('belum kena keduanya → terbuka, dinilai dari close terakhir', () => {
    const h = judge(pilihan(), [bar('2026-10-02', 1000, 1150, 1120)])
    expect(h.status).toBe('open')
    expect(h.settled).toBeNull()
    expect(h.last).toEqual({ date: '2026-10-02', close: 1120 })
    expect(h.ret).toBeCloseTo(0.12, 6)
    expect(h.progress).toBeCloseTo(0.6, 6) // 120 dari 200 menuju target
  })

  test('tanpa bar setelah scan → terbuka di harga entry', () => {
    const h = judge(pilihan(), [])
    expect(h.status).toBe('open')
    expect(h.last).toBeNull()
    expect(h.ret).toBe(0)
  })
})

describe('buildPicks', () => {
  const bars = new Map([
    ['BBCA', [bar('2026-10-02', 1000, 1100), bar('2026-10-03', 1100, 1210), bar('2026-10-06', 1150, 1190)]],
  ])

  test('satu pilihan terbuka per emiten: lolos lagi saat masih terbuka diabaikan', () => {
    const picks = buildPicks([pilihan({ date: '2026-10-01' }), pilihan({ date: '2026-10-02', entry: 1050 })], bars)
    expect(picks).toHaveLength(1)
    expect(picks[0]!.date).toBe('2026-10-01')
  })

  test('setelah selesai, lolos berikutnya membuka pilihan baru', () => {
    const picks = buildPicks(
      [pilihan({ date: '2026-10-01' }), pilihan({ date: '2026-10-06', entry: 1170, stop: 1100, target: 1400 })],
      bars,
    )
    // Terbaru lebih dulu.
    expect(picks.map((p) => [p.date, p.status])).toEqual([
      ['2026-10-06', 'open'],
      ['2026-10-01', 'target'],
    ])
  })

  test('scan pada hari pilihan lama selesai boleh membuka pilihan baru', () => {
    const picks = buildPicks([pilihan({ date: '2026-10-01' }), pilihan({ date: '2026-10-03', entry: 1150 })], bars)
    expect(picks.map((p) => p.date)).toEqual(['2026-10-03', '2026-10-01'])
  })

  test('urutan masukan tidak berpengaruh', () => {
    const a = buildPicks([pilihan({ date: '2026-10-02' }), pilihan({ date: '2026-10-01' })], bars)
    expect(a.map((p) => p.date)).toEqual(['2026-10-01'])
  })
})

describe('pilihanFromRows', () => {
  const row = (code: string, passed: boolean, rr: unknown = { entry: 0.00031, stop: 0.00028, target: 0.0004 }) =>
    ({
      code,
      name: `${code} coin`,
      date: '2026-10-21',
      close: 0.00031,
      gates: { passed, failures: [] },
      metrics: {
        riskReward: { available: rr !== null, value: rr },
        ...Object.fromEntries(['wyckoff', 'vpa', 'structure', 'filters', 'volume'].map((k) => [k, { available: false, value: null }])),
      },
    }) as unknown as ScanRow

  test('hanya emiten lolos gerbang, dengan harga utuh tanpa pembulatan', () => {
    expect(pilihanFromRows([row('AAA-USD', true), row('BBB-USD', false)])).toEqual([
      { code: 'AAA-USD', name: 'AAA-USD coin', date: '2026-10-21', entry: 0.00031, stop: 0.00028, target: 0.0004, label: 'bersih' },
    ])
  })

  test('baris dengan catatan risiko dicatat hati-hati', () => {
    const [p] = pilihanFromRows([row('AAA', true, { entry: 1000, stop: 940, target: 1030, ratio: 0.5 })])
    expect(p!.label).toBe('hati-hati')
  })

  test('baris tanpa catatan dicatat bersih', () => {
    const [p] = pilihanFromRows([row('AAA', true, { entry: 1000, stop: 940, target: 1200, ratio: 3.3 })])
    expect(p!.label).toBe('bersih')
  })

  test('lolos tanpa rencana risk/reward dilewati', () => {
    expect(pilihanFromRows([row('AAA-USD', true, null)])).toEqual([])
  })
})

describe('bolehCatat', () => {
  const ok = { watchlist: true, draft: false, total: 900, failed: 0 }

  test('run watchlist penuh yang final dan lengkap dicatat', () => {
    expect(bolehCatat(ok)).toBe(true)
  })

  test('scan beberapa kode atau DRAFT tidak dicatat', () => {
    expect(bolehCatat({ ...ok, watchlist: false })).toBe(false)
    expect(bolehCatat({ ...ok, draft: true })).toBe(false)
  })

  test('semua gagal diambil (mis. Yahoo membalas 429) tidak menimpa catatan dengan daftar kosong', () => {
    expect(bolehCatat({ ...ok, failed: 900 })).toBe(false)
  })

  test('lebih dari 5% gagal: daftarnya tidak lengkap, jangan dicatat', () => {
    expect(bolehCatat({ ...ok, failed: 46 })).toBe(false)
    expect(bolehCatat({ ...ok, failed: 45 })).toBe(true)
  })
})

describe('yahooRangeSince', () => {
  const now = new Date('2026-10-22T11:00:00Z')

  test('rentang Yahoo terkecil yang mencakup pilihan tertua, dengan bantalan seminggu', () => {
    expect(yahooRangeSince('2026-10-21', now)).toBe('1mo')
    expect(yahooRangeSince('2026-08-01', now)).toBe('3mo')
    expect(yahooRangeSince('2026-06-01', now)).toBe('6mo')
    expect(yahooRangeSince('2025-12-01', now)).toBe('1y')
    expect(yahooRangeSince('2025-10-20', now)).toBe('2y')
  })

  test('lebih tua dari sepuluh tahun → max', () => {
    expect(yahooRangeSince('2015-01-01', now)).toBe('max')
  })
})

describe('summarize', () => {
  test('benar = naik, termasuk yang masih terbuka; rata-rata return semua pilihan', () => {
    const b = new Map([
      ['A', [bar('2026-10-02', 1000, 1250)]], // target, +20%
      ['B', [bar('2026-10-02', 800, 1000, 900, 1000)]], // cut, -8%
      ['C', [bar('2026-10-02', 990, 1060, 1040)]], // terbuka, +4%
    ])
    const s = summarize(buildPicks([pilihan({ code: 'A' }), pilihan({ code: 'B' }), pilihan({ code: 'C' })], b))
    expect(s).toMatchObject({ total: 3, target: 1, cut: 1, open: 1, benar: 2 })
    expect(s.avgReturn).toBeCloseTo((0.2 - 0.08 + 0.04) / 3, 6)
  })

  test('pilihan tanpa bar setelah scan belum dinilai: tidak ikut persentase benar maupun rata-rata', () => {
    const b = new Map([['A', [bar('2026-10-02', 1000, 1250)]]]) // target, +20%
    const s = summarize(buildPicks([pilihan({ code: 'A' }), pilihan({ code: 'B' })], b))
    expect(s).toMatchObject({ total: 2, open: 1, dinilai: 1, benar: 1 })
    expect(s.avgReturn).toBeCloseTo(0.2, 6)
  })
})

describe('judgeIdx — Buy limit dipasang pagi setelah scan', () => {
  // pilihan(): entry 1000, cut loss 920, target 1200.
  test('buka di atas target → dilewati, tidak terbeli', () => {
    const h = judgeIdx(pilihan(), [bar('2026-10-02', 1190, 1250, 1220, 1210)])
    expect(h).toMatchObject({ status: 'dilewati', isi: null, ret: 0, settled: '2026-10-02' })
  })

  test('buka di bawah cut loss → dilewati, bukan terbeli lalu kena cut loss', () => {
    expect(judgeIdx(pilihan(), [bar('2026-10-02', 880, 905, 900, 900)]).status).toBe('dilewati')
  })

  test('low sepanjang hari di atas harga beli → tidak terbeli', () => {
    const h = judgeIdx(pilihan(), [bar('2026-10-02', 1010, 1050, 1040, 1020)])
    expect(h).toMatchObject({ status: 'tidak-terbeli', isi: null, ret: 0, settled: '2026-10-02' })
  })

  test('buka di bawah harga beli → terisi di harga buka', () => {
    const h = judgeIdx(pilihan(), [bar('2026-10-02', 960, 1010, 1000, 980)])
    expect(h.isi).toBe(980)
    expect(h.status).toBe('open')
    expect(h.ret).toBeCloseTo(1000 / 980 - 1, 9)
  })

  test('terisi lalu cut loss tersentuh di hari yang sama → cut', () => {
    const h = judgeIdx(pilihan(), [bar('2026-10-02', 915, 1005, 930, 990)])
    expect(h).toMatchObject({ status: 'cut', isi: 990, exit: 920, settled: '2026-10-02' })
    expect(h.ret).toBeCloseTo(920 / 990 - 1, 9)
  })

  test('terisi, kena target di hari berikutnya; return dari harga terisi', () => {
    const h = judgeIdx(pilihan(), [bar('2026-10-02', 980, 1010, 1000, 990), bar('2026-10-03', 1100, 1210)])
    expect(h).toMatchObject({ status: 'target', isi: 990, exit: 1200, days: 2 })
    expect(h.ret).toBeCloseTo(1200 / 990 - 1, 9)
  })

  test('cut loss dan target memakai harga rencana yang dibulatkan ke fraksi BEI', () => {
    const h = judgeIdx(pilihan({ entry: 11375, stop: 10560, target: 11720 }), [])
    expect(h.cut).toBe(10550)
    expect(h.target).toBe(11700)
    expect(h.status).toBe('open')
    expect(h.isi).toBeNull()
  })
})

describe('buildPicks — pasar', () => {
  const bars = new Map([['BBCA', [bar('2026-10-02', 1190, 1250, 1220, 1210), bar('2026-10-03', 1225, 1250, 1240, 1230)]]])

  test('IDX: pilihan dilewati selesai di hari itu, scan hari itu boleh membuka pilihan baru', () => {
    const picks = buildPicks([pilihan({ date: '2026-10-01' }), pilihan({ date: '2026-10-02', entry: 1220, stop: 1150, target: 1300 })], bars, IDX)
    expect(picks.map((p) => [p.date, p.status])).toEqual([
      ['2026-10-02', 'tidak-terbeli'],
      ['2026-10-01', 'dilewati'],
    ])
  })

  test('crypto memakai penilaian lama: masuk di close hari scan', () => {
    const [h] = buildPicks([pilihan({ date: '2026-10-01' })], bars, CRYPTO)
    expect(h!.status).toBe('target')
    expect(h!.isi).toBe(1000)
  })
})

describe('summarize — dilewati dan tidak terbeli', () => {
  test('tidak ikut dinilai, tapi dihitung terpisah', () => {
    const picks = [
      judgeIdx(pilihan(), [bar('2026-10-02', 1190, 1250, 1220, 1210)]),
      judgeIdx(pilihan(), [bar('2026-10-02', 1010, 1050, 1040, 1020)]),
      judgeIdx(pilihan(), [bar('2026-10-02', 960, 1010, 1000, 980)]),
    ]
    expect(summarize(picks)).toMatchObject({ total: 3, dinilai: 1, dilewati: 1, tidakTerbeli: 1 })
  })
})
