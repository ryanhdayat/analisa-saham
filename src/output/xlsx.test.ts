import { expect, test, describe } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { writeXlsx } from './xlsx.ts'
import type { ScanRow } from '../analysis/report.ts'

function row(over: Partial<ScanRow> = {}): ScanRow {
  const m = (value: unknown, available = true) => ({
    value, verdict: 'vonis contoh', confidence: 'sedang' as const, evidence: ['bukti satu', 'bukti dua'], available,
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
      vpa: m({ events: [], latest: null }),
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

async function roundTrip(rows: ScanRow[], skipped: ScanRow[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'xlsx-'))
  const path = join(dir, 'scan.xlsx')
  await writeXlsx(rows, skipped, path)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return { wb, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('writeXlsx', () => {
  test('menghasilkan workbook yang bisa dibuka kembali', async () => {
    const { wb, cleanup } = await roundTrip([row()])
    expect(wb.worksheets.length).toBeGreaterThan(0)
    await cleanup()
  })

  test('sheet pertama berisi scan dengan header dan datanya', async () => {
    const { wb, cleanup } = await roundTrip([row()])
    const ws = wb.getWorksheet('Scan')!
    expect(ws.getRow(1).getCell(1).value).toBe('KODE')
    expect(ws.getRow(2).getCell(1).value).toBe('BBCA')
    await cleanup()
  })

  test('angka disimpan sebagai angka, bukan teks, supaya bisa disortir', async () => {
    const { wb, cleanup } = await roundTrip([row()])
    const ws = wb.getWorksheet('Scan')!
    const header = ws.getRow(1).values as string[]
    const closeCol = header.indexOf('CLOSE')
    expect(typeof ws.getRow(2).getCell(closeCol).value).toBe('number')
    await cleanup()
  })

  test('metrik yang tidak tersedia ditulis n/a, bukan nol', async () => {
    const { wb, cleanup } = await roundTrip([row()])
    const ws = wb.getWorksheet('Scan')!
    const header = ws.getRow(1).values as string[]
    const col = header.indexOf('ASING20_LEMBAR')
    expect(ws.getRow(2).getCell(col).value).toBe('n/a')
    await cleanup()
  })

  test('header dibekukan supaya tetap terlihat saat digulir', async () => {
    const { wb, cleanup } = await roundTrip([row()])
    expect(wb.getWorksheet('Scan')!.views[0]?.state).toBe('frozen')
    await cleanup()
  })

  test('tiap emiten punya sheet bukti berisi vonis dan buktinya', async () => {
    const { wb, cleanup } = await roundTrip([row()])
    const ws = wb.getWorksheet('BBCA')
    expect(ws).toBeDefined()
    const teks = JSON.stringify(ws!.getSheetValues())
    expect(teks).toContain('vonis contoh')
    expect(teks).toContain('bukti satu')
    await cleanup()
  })

  test('emiten tersaring keluar punya sheetnya sendiri berikut alasannya', async () => {
    const gagal = row({ code: 'SRAJ', gates: { passed: false, failures: ['TIDAK LIKUID — Rp 0,42 M'] } })
    const { wb, cleanup } = await roundTrip([], [gagal])
    const teks = JSON.stringify(wb.getWorksheet('Tersaring')!.getSheetValues())
    expect(teks).toContain('SRAJ')
    expect(teks).toContain('TIDAK LIKUID')
    await cleanup()
  })

  test('peringatan degradasi ikut tertulis di workbook', async () => {
    const { wb, cleanup } = await roundTrip([row()])
    const teks = JSON.stringify(wb.getWorksheet('Scan')!.getSheetValues())
    expect(teks.toLowerCase()).toContain('terdegradasi')
    await cleanup()
  })
})
