import { metric, unavailable, type Metric } from './metric.ts'
import type { Bar } from '../types.ts'

/**
 * Ambang bawaan Rp 5 miliar per hari.
 *
 * Grafik secantik apa pun tidak menolong kalau emitennya hanya bertransaksi
 * ratusan juta sehari: harganya gampang digerakkan segelintir order, dan keluar
 * dari posisi jadi masalah tersendiri. Angka ini bergantung ukuran posisi —
 * naikkan lewat `--min-likuiditas` kalau posisimu besar.
 */
export const MIN_VALUE_DEFAULT = 5e9

const PERIOD = 20

export interface FreeFloatInput {
  /** Lembar yang sudah disesuaikan free float — `WeightForIndex` dari IDX. */
  freeFloatShares: number
  listedShares: number
}

export interface LiquidityRead {
  /** Rata-rata nilai transaksi harian, rupiah. */
  avgDailyValue: number
  passesGate: boolean
  /** Persen free float, atau null kalau data IDX tidak tersedia. */
  freeFloatPct: number | null
}

const miliar = (v: number) => `Rp ${(v / 1e9).toFixed(2)} M`

export function analyzeLiquidity(
  bars: Bar[],
  minValue = MIN_VALUE_DEFAULT,
  freeFloat?: FreeFloatInput,
): Metric<LiquidityRead> {
  if (bars.length === 0) return unavailable('Tidak ada bar untuk menghitung likuiditas.')

  const window = bars.slice(-PERIOD)
  const avgDailyValue = window.reduce((a, b) => a + b.close * b.volume, 0) / window.length
  const passesGate = avgDailyValue >= minValue

  // Free float nol lembar bukan "0%", melainkan data yang tidak masuk akal.
  const freeFloatPct =
    freeFloat && freeFloat.listedShares > 0 && freeFloat.freeFloatShares > 0
      ? (freeFloat.freeFloatShares / freeFloat.listedShares) * 100
      : null

  const evidence = [
    `Nilai transaksi rata-rata ${window.length} hari: ${miliar(avgDailyValue)} per hari.`,
    freeFloatPct === null
      ? 'Free float: tidak tersedia (butuh data IDX).'
      : `Free float: ${freeFloatPct.toFixed(1)}% dari saham tercatat.`,
  ]

  const verdict = passesGate
    ? `likuid — ${miliar(avgDailyValue)} per hari, di atas ambang ${miliar(minValue)}`
    : `TIDAK LIKUID — ${miliar(avgDailyValue)} per hari, di bawah ambang ${miliar(minValue)}`

  return metric({ avgDailyValue, passesGate, freeFloatPct }, verdict, 'tinggi', evidence)
}
