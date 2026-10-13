import { columnsFor } from './columns.ts'
import { IDX, type Market } from '../market.ts'
import type { ScanRow } from '../analysis/report.ts'

/**
 * Angka bergaya Indonesia: desimal koma, TANPA pemisah ribuan.
 *
 * Pemisah ribuan sengaja dibuang. Excel berlokal Indonesia memang memakai titik
 * untuk ribuan, tapi begitu ada pemisah di berkas CSV, sel yang panjang gampang
 * terbaca sebagai teks dan kolomnya berhenti bisa dijumlah.
 */
export function csvNumber(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return value.toFixed(decimals).replace('.', ',')
}

/** Kutip kalau mengandung pemisah, kutip, atau baris baru. */
function quote(field: string): string {
  if (/[;"\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`
  return field
}

/**
 * CSV dengan pemisah TITIK KOMA.
 *
 * Excel berlokal Indonesia memakai titik koma sebagai pemisah daftar. Kalau
 * berkasnya dipisah koma, seluruh baris masuk ke kolom A dan berkasnya praktis
 * tidak terpakai — jadi ini bukan selera, melainkan syarat supaya bisa dibuka.
 */
export function toCsv(rows: ScanRow[], market: Market = IDX): string {
  const COLUMNS = columnsFor(market)
  const lines = [COLUMNS.map((c) => quote(c.header)).join(';')]

  for (const row of rows) {
    const cells = COLUMNS.map((c) => {
      const value = c.value(row)
      if (value === null) return 'n/a'
      if (typeof value === 'number') return csvNumber(value, c.decimals ?? 2)
      return quote(value)
    })
    lines.push(cells.join(';'))
  }

  return lines.join('\n')
}
