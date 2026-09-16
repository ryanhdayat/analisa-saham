import ExcelJS from 'exceljs'
import { COLUMNS } from './columns.ts'
import { RANK_COLUMNS } from '../analysis/report.ts'
import type { ScanRow } from '../analysis/report.ts'
import type { Metric } from '../analysis/metric.ts'

const WARNA = {
  header: 'FF1E222D',
  headerText: 'FFFFFFFF',
  lolos: 'FF26A69A',
  gagal: 'FFEF5350',
  peringatan: 'FFFFF3CD',
}

/** Nama sheet Excel maksimal 31 karakter dan tidak boleh memuat : \ / ? * [ ] */
function sheetName(raw: string): string {
  return raw.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)
}

/**
 * Workbook scan: satu sheet ringkas untuk disortir, satu sheet bukti per emiten.
 *
 * Angka ditulis sebagai angka — bukan string berformat — supaya kolomnya bisa
 * disortir dan difilter di Excel. Yang memang tidak tersedia ditulis `n/a`
 * sebagai teks, sehingga tidak pernah ikut terhitung sebagai nol.
 */
export async function writeXlsx(rows: ScanRow[], skipped: ScanRow[], path: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()

  const ws = wb.addWorksheet('Scan')
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width ?? 14 }))

  for (const row of rows) {
    const record: Record<string, string | number> = {}
    for (const c of COLUMNS) {
      const value = c.value(row)
      record[c.header] = value === null ? 'n/a' : value
    }
    const added = ws.addRow(record)
    const gerbang = added.getCell(COLUMNS.findIndex((c) => c.header === 'GERBANG') + 1)
    gerbang.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: row.gates.passed ? WARNA.lolos : WARNA.gagal },
    }
  }

  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: WARNA.headerText } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARNA.header } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }

  // Peringatan degradasi ditulis DI DALAM workbook, bukan hanya di terminal —
  // berkas ini akan dibuka lagi besok, jauh dari konteks run-nya.
  const hilang = new Set<string>()
  for (const r of rows) for (const c of RANK_COLUMNS) if (!r.rank.used.includes(c)) hilang.add(c)
  if (hilang.size > 0) {
    const note = ws.addRow({})
    note.getCell(1).value =
      `PERINGATAN — peringkat TERDEGRADASI: kolom ${[...hilang].join(', ')} tidak tersedia saat run ini. ` +
      `Skor hanya dari kolom yang ada, jadi tidak sebanding dengan run yang lengkap.`
    note.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARNA.peringatan } }
  }

  if (skipped.length > 0) {
    const out = wb.addWorksheet('Tersaring')
    out.columns = [
      { header: 'KODE', key: 'kode', width: 8 },
      { header: 'NAMA', key: 'nama', width: 30 },
      { header: 'ALASAN', key: 'alasan', width: 80 },
    ]
    out.getRow(1).font = { bold: true }
    for (const r of skipped) {
      out.addRow({ kode: r.code, nama: r.name, alasan: r.gates.failures.join(' | ') })
    }
  }

  for (const row of [...rows, ...skipped]) {
    const detail = wb.addWorksheet(sheetName(row.code))
    detail.columns = [
      { header: 'METRIK', key: 'metrik', width: 16 },
      { header: 'TERSEDIA', key: 'ada', width: 10 },
      { header: 'KEYAKINAN', key: 'yakin', width: 11 },
      { header: 'VONIS', key: 'vonis', width: 70 },
      { header: 'BUKTI', key: 'bukti', width: 100 },
    ]
    detail.getRow(1).font = { bold: true }
    for (const [name, m] of Object.entries(row.metrics) as Array<[string, Metric<unknown>]>) {
      detail.addRow({
        metrik: name,
        ada: m.available ? 'ya' : 'tidak',
        yakin: m.confidence,
        vonis: m.verdict,
        bukti: m.evidence.join(' | '),
      })
    }
  }

  await wb.xlsx.writeFile(path)
}
