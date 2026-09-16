import type { ScanRow } from '../analysis/report.ts'

/**
 * Detail penuh satu emiten untuk skrip — termasuk bukti tiap metrik dan kolom
 * peringkat yang dipakai, supaya konsumennya bisa tahu run ini terdegradasi atau
 * tidak tanpa menebak dari nilai yang hilang.
 */
export function toJson(row: ScanRow): string {
  return JSON.stringify(row, null, 2)
}
