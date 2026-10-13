import { movingAverage, volumeProfile } from './indicators.ts'
import type { ChartData } from './yahoo.ts'
import type { ChartInput } from './types.ts'

/** Periode MA harga, sesuai permintaan. Urutannya menentukan urutan legenda. */
export const MA_PERIODS = [10, 20, 50, 100, 200] as const

/** Periode MA volume, mengikuti "Volume (20)" di TradingView. */
export const VOLUME_MA_PERIOD = 20

/** Pemanasan terpanjang yang dibutuhkan MA harga. */
export const WARMUP_BARS = Math.max(...MA_PERIODS)

/**
 * Susun semua yang dibutuhkan render untuk satu emiten.
 *
 * Urutannya penting: MA dihitung atas SELURUH riwayat, BARU dipotong ke jendela
 * tampil. Kalau dibalik — potong dulu lalu hitung — MA 200 baru muncul di ~50
 * candle terakhir dan garis birunya menggantung di tengah grafik, tidak seperti
 * TradingView yang menariknya penuh dari kiri.
 *
 * Karena itu pemanggil harus mengambil `displayDays + WARMUP_BARS` bar dari Yahoo.
 * Kalau riwayatnya memang lebih pendek (emiten baru IPO), MA yang bersangkutan
 * tetap null di awal — itu jujur, bukan kegagalan.
 */
export function buildChartInput(
  data: ChartData,
  displayDays: number,
  profileRows: number,
): ChartInput {
  const all = data.bars
  const start = Math.max(0, all.length - displayDays)

  const closes = all.map((b) => b.close)
  const volumes = all.map((b) => b.volume)

  const priceMA = new Map<number, Array<number | null>>()
  for (const period of MA_PERIODS) {
    priceMA.set(period, movingAverage(closes, period).slice(start))
  }

  const bars = all.slice(start)

  return {
    code: data.symbol.replace(/\.JK$/, ''),
    symbol: data.symbol,
    name: data.name,
    bars,
    priceMA,
    volumeMA: movingAverage(volumes, VOLUME_MA_PERIOD).slice(start),
    profile: volumeProfile(bars, profileRows),
    profileRows,
  }
}
