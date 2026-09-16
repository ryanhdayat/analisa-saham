import { expect, test, describe } from 'bun:test'
import { candidateDates, buildForeignDays, buildFreeFloat, stalenessFrom, toIsoDate, exchangeToday } from './idx-shape.ts'
import type { RawStockSummary } from './idx-types.ts'

function rawRow(code: string, over: Partial<RawStockSummary> = {}): RawStockSummary {
  return {
    StockCode: code,
    Close: 1000,
    ForeignBuy: 0,
    ForeignSell: 0,
    ListedShares: 1000,
    TradebleShares: 1000,
    WeightForIndex: 400,
    ...over,
  } as RawStockSummary
}

describe('candidateDates', () => {
  test('berjalan mundur dan melewati Sabtu Minggu', () => {
    // 2026-09-16 Rabu.
    const d = candidateDates(new Date(Date.UTC(2026, 8, 16)), 5)
    expect(d).toEqual(['20260916', '20260915', '20260914', '20260911', '20260910'])
  })

  test('jumlahnya sesuai yang diminta', () => {
    expect(candidateDates(new Date(Date.UTC(2026, 8, 16)), 40)).toHaveLength(40)
  })

  test('format YYYYMMDD tanpa pemisah', () => {
    expect(candidateDates(new Date(Date.UTC(2026, 0, 5)), 1)).toEqual(['20260105'])
  })
})

describe('toIsoDate', () => {
  test('mengubah YYYYMMDD jadi YYYY-MM-DD', () => {
    expect(toIsoDate('20260916')).toBe('2026-09-16')
  })
})

describe('buildForeignDays', () => {
  const byDate = new Map([
    ['20260914', [rawRow('BBCA', { ForeignBuy: 500, ForeignSell: 200, Close: 6400 }), rawRow('BBRI')]],
    ['20260915', [rawRow('BBCA', { ForeignBuy: 100, ForeignSell: 400, Close: 6350 })]],
  ])

  test('net lembar adalah beli dikurangi jual', () => {
    const days = buildForeignDays(byDate, 'BBCA')
    expect(days.map((d) => d.netShares)).toEqual([300, -300])
  })

  test('urut menaik menurut tanggal, supaya jendela 20 hari benar', () => {
    expect(buildForeignDays(byDate, 'BBCA').map((d) => d.date)).toEqual(['2026-09-14', '2026-09-15'])
  })

  test('close tiap hari ikut, untuk mengestimasi rupiah', () => {
    expect(buildForeignDays(byDate, 'BBCA')[0]!.close).toBe(6400)
  })

  test('emiten yang tidak ada di suatu hari cukup dilewati, bukan dinolkan', () => {
    expect(buildForeignDays(byDate, 'BBRI')).toHaveLength(1)
  })

  test('emiten yang tidak ada sama sekali menghasilkan daftar kosong', () => {
    expect(buildForeignDays(byDate, 'TIDAKADA')).toEqual([])
  })
})

describe('buildFreeFloat', () => {
  test('memakai WeightForIndex, BUKAN TradebleShares', () => {
    // Diverifikasi terhadap stock-summary-20260916 asli: TradebleShares sama persis
    // dengan ListedShares di 908 dari 963 emiten, jadi ia BUKAN free float.
    // WeightForIndex-lah lembar yang sudah disesuaikan free float.
    const byDate = new Map([
      ['20260916', [rawRow('BBCA', { WeightForIndex: 38391910182, TradebleShares: 122042299500, ListedShares: 122042299500 })]],
    ])
    expect(buildFreeFloat(byDate, 'BBCA')).toEqual({
      freeFloatShares: 38391910182,
      listedShares: 122042299500,
    })
  })

  test('menghasilkan free float BBCA ~31,5%, bukan 100%', () => {
    const byDate = new Map([
      ['20260916', [rawRow('BBCA', { WeightForIndex: 38391910182, ListedShares: 122042299500 })]],
    ])
    const ff = buildFreeFloat(byDate, 'BBCA')!
    expect((ff.freeFloatShares / ff.listedShares) * 100).toBeCloseTo(31.5, 1)
  })

  test('mengambil dari hari terbaru', () => {
    const byDate = new Map([
      ['20260914', [rawRow('BBCA', { WeightForIndex: 300, ListedShares: 1000 })]],
      ['20260915', [rawRow('BBCA', { WeightForIndex: 450, ListedShares: 1000 })]],
    ])
    expect(buildFreeFloat(byDate, 'BBCA')!.freeFloatShares).toBe(450)
  })

  test('emiten yang tidak ada menghasilkan undefined, bukan nol', () => {
    expect(buildFreeFloat(new Map(), 'BBCA')).toBeUndefined()
  })
})

describe('stalenessFrom', () => {
  test('data hari ini tidak dianggap basi', () => {
    expect(stalenessFrom('2026-09-16', new Date(Date.UTC(2026, 8, 16)))).toBeUndefined()
  })

  test('data kemarin dan sebelumnya membawa umurnya', () => {
    expect(stalenessFrom('2026-09-12', new Date(Date.UTC(2026, 8, 16)))).toEqual({
      asOf: '2026-09-12',
      daysOld: 4,
    })
  })
})

describe('zona waktu bursa — bukan UTC, bukan zona mesin', () => {
  // 2026-09-16T17:15:00Z = 2026-09-17 00:15 WIB. Tanggal bursanya SUDAH 17.
  const lewatTengahMalamJakarta = new Date('2026-09-16T17:15:00Z')

  test('tanggal bursa hari ini dibaca di Asia/Jakarta', () => {
    expect(exchangeToday(lewatTengahMalamJakarta)).toBe('2026-09-17')
  })

  test('candidateDates mulai dari tanggal bursa, bukan tanggal UTC', () => {
    // Memakai UTC akan melewatkan 20260917 sepenuhnya dan menarik data basi.
    expect(candidateDates(lewatTengahMalamJakarta, 3)).toEqual(['20260917', '20260916', '20260915'])
  })

  test('data kemarin terbaca berumur 1 hari, bukan 0', () => {
    expect(stalenessFrom('2026-09-16', lewatTengahMalamJakarta)).toEqual({
      asOf: '2026-09-16',
      daysOld: 1,
    })
  })

  test('data hari bursa ini tetap dianggap segar', () => {
    expect(stalenessFrom('2026-09-17', lewatTengahMalamJakarta)).toBeUndefined()
  })
})
