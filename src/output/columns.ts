import type { ScanRow } from '../analysis/report.ts'
import { IDX, type Market } from '../market.ts'

/**
 * Definisi kolom dipakai bersama oleh tabel terminal, CSV, dan Excel — supaya
 * ketiganya tidak pernah berbeda isi. Menambah kolom cukup di satu tempat.
 */
export interface Column {
  header: string
  /** null berarti datanya memang tidak ada; jangan dipalsukan jadi nol. */
  value: (row: ScanRow) => string | number | null
  /** Jumlah desimal untuk nilai numerik. */
  decimals?: number
  width?: number
}

const v = <T,>(m: { value: T | null; available: boolean }) => (m.available ? m.value : null)

/**
 * Kolom untuk satu pasar. Header yang membawa satuan uang ikut mata uang pasarnya —
 * CSV yang melabeli dolar sebagai rupiah adalah kesalahan yang paling sulit terlihat.
 */
export function columnsFor(market: Market): Column[] {
  return [
  { header: 'KODE', value: (r) => r.code, width: 6 },
  { header: 'NAMA', value: (r) => r.name, width: 28 },
  { header: 'TANGGAL', value: (r) => r.date, width: 10 },
  { header: 'CLOSE', value: (r) => r.close, decimals: 0, width: 9 },
  { header: 'SKOR', value: (r) => r.rank.score, decimals: 2, width: 6 },
  { header: 'TREND', value: (r) => r.rank.columns.trend, decimals: 2, width: 6 },
  { header: 'RS60', value: (r) => r.rank.columns.rs60, decimals: 2, width: 6 },
  { header: 'RVOL_SKOR', value: (r) => r.rank.columns.rvol, decimals: 2, width: 9 },
  { header: 'ASING_SKOR', value: (r) => r.rank.columns.asing, decimals: 2, width: 10 },
  { header: 'KOLOM_DIPAKAI', value: (r) => r.rank.used.join('|'), width: 24 },
  { header: 'RVOL', value: (r) => v(r.metrics.volume)?.rvol ?? null, decimals: 2, width: 6 },
  { header: 'VOLUME_BACA', value: (r) => v(r.metrics.volume)?.classification ?? null, width: 18 },
  { header: 'TREN_HARIAN', value: (r) => v(r.metrics.structure)?.daily.structure ?? null, width: 11 },
  { header: 'TREN_MINGGUAN', value: (r) => v(r.metrics.structure)?.weekly.structure ?? null, width: 13 },
  { header: 'FASE', value: (r) => v(r.metrics.structure)?.daily.phase ?? null, width: 9 },
  { header: 'RS60_POIN', value: (r) => v(r.metrics.strength)?.rs60 ?? null, decimals: 1, width: 9 },
  { header: 'RS_SEKTOR_POIN', value: (r) => v(r.metrics.strength)?.vsSector60 ?? null, decimals: 1, width: 14 },
  { header: 'MA_TERSUSUN', value: (r) => (v(r.metrics.filters) ? (v(r.metrics.filters)!.stacked ? 'ya' : 'tidak') : null), width: 11 },
  { header: 'DIVERGENSI_OBV', value: (r) => v(r.metrics.filters)?.obvDivergence ?? null, width: 14 },
  { header: 'ATR_PERSEN', value: (r) => v(r.metrics.volatility)?.atrPct ?? null, decimals: 2, width: 10 },
  { header: `NILAI_HARIAN_${market.currencyCode}`, value: (r) => v(r.metrics.liquidity)?.avgDailyValue ?? null, decimals: 0, width: 15 },
  { header: 'FREE_FLOAT_PERSEN', value: (r) => v(r.metrics.liquidity)?.freeFloatPct ?? null, decimals: 1, width: 17 },
  { header: 'ENTRY', value: (r) => v(r.metrics.riskReward)?.entry ?? null, decimals: 0, width: 8 },
  { header: 'STOP', value: (r) => v(r.metrics.riskReward)?.stop ?? null, decimals: 0, width: 8 },
  { header: 'TARGET', value: (r) => v(r.metrics.riskReward)?.target ?? null, decimals: 0, width: 8 },
  { header: 'RR', value: (r) => v(r.metrics.riskReward)?.ratio ?? null, decimals: 2, width: 6 },
  { header: 'VPA_TERAKHIR', value: (r) => v(r.metrics.vpa)?.latest?.signal ?? null, width: 16 },
  { header: 'VPA_TANGGAL', value: (r) => v(r.metrics.vpa)?.latest?.date ?? null, width: 11 },
  { header: 'WYCKOFF', value: (r) => v(r.metrics.wyckoff)?.phase ?? null, width: 12 },
  { header: 'ASING20_LEMBAR', value: (r) => v(r.metrics.flow)?.net20 ?? null, decimals: 0, width: 14 },
  { header: 'ASING20_RP_ESTIMASI', value: (r) => v(r.metrics.flow)?.value20 ?? null, decimals: 0, width: 19 },
  { header: 'ASING_UMUR_HARI', value: (r) => r.metrics.flow.staleness?.daysOld ?? null, decimals: 0, width: 15 },
  { header: 'GERBANG', value: (r) => (r.gates.passed ? 'lolos' : r.gates.failures.join(' | ')), width: 40 },
  ]
}

/** Bawaan IDX, supaya pemanggil yang belum menyebut pasar tidak berubah artinya. */
export const COLUMNS: Column[] = columnsFor(IDX)
