import { movingAverage } from '../indicators.ts'
import { metric, unavailable, type Metric } from './metric.ts'
import type { LevelsRead } from './levels.ts'
import type { Bar } from '../types.ts'

export type VpaSignal = 'stopping-volume' | 'no-supply' | 'no-demand' | 'upthrust' | 'spring'

export interface VpaEvent {
  signal: VpaSignal
  date: string
  index: number
  rvol: number
  note: string
}

export interface VpaRead {
  events: VpaEvent[]
  latest: VpaEvent | null
}

const PERIOD = 20
const LOOKBACK = 30
/** Jendela untuk menilai "terendah/tertinggi belakangan". */
const EKSTREM = 20

const AMBANG = {
  climaxVolume: 2,
  keringVolume: 0.7,
  upthrustVolume: 1.5,
  springVolume: 1.2,
  spreadSempit: 0.7,
}

const DESKRIPSI: Record<VpaSignal, string> = {
  'stopping-volume': 'stopping volume / selling climax — jual deras diserap di dekat dasar',
  'no-supply': 'no supply / test — turun tanpa penjual, biasanya bullish setelah akumulasi',
  'no-demand': 'no demand — naik tanpa pembeli, biasanya bearish',
  upthrust: 'upthrust — menembus ke atas lalu ditolak, biasanya bearish',
  spring: 'spring / shakeout — menembus support sesaat lalu pulih',
}

/**
 * Bar penanda ala VPA.
 *
 * Semua di bawah ini ATURAN HEURISTIK, bukan vonis. Ambangnya konvensi yang lazim
 * dipakai, bukan hukum; dinamai supaya bisa diperdebatkan. Yang dikembalikan
 * adalah KEJADIAN berikut tanggal dan angkanya, supaya tiap sinyal bisa dicek
 * ulang di grafik alih-alih dipercaya begitu saja.
 *
 * Keyakinannya dibatasi maksimal `sedang`: pola yang sama bisa ditafsirkan berbeda,
 * dan aturan sekaku ini pasti menghasilkan positif palsu.
 */
export function analyzeVpa(bars: Bar[], levels: LevelsRead): Metric<VpaRead> {
  if (bars.length < PERIOD + 2) {
    return unavailable(`Butuh minimal ${PERIOD + 2} bar untuk membaca sinyal VPA, baru ada ${bars.length}.`)
  }

  const volMA = movingAverage(bars.map((b) => b.volume), PERIOD)
  const spreadMA = movingAverage(bars.map((b) => b.high - b.low), PERIOD)
  const events: VpaEvent[] = []

  const start = Math.max(PERIOD, bars.length - LOOKBACK)
  for (let i = start; i < bars.length; i++) {
    const bar = bars[i]!
    const prev = bars[i - 1]!
    const vAvg = volMA[i - 1]
    const sAvg = spreadMA[i - 1]
    if (vAvg == null || vAvg === 0 || sAvg == null || sAvg === 0) continue

    const rvol = bar.volume / vAvg
    const relSpread = (bar.high - bar.low) / sAvg
    const range = bar.high - bar.low
    const closePos = range > 0 ? (bar.close - bar.low) / range : 0.5
    const window = bars.slice(Math.max(0, i - EKSTREM), i)
    const lowestBefore = Math.min(...window.map((w) => w.low))
    const highestBefore = Math.max(...window.map((w) => w.high))
    const naik = bar.close >= prev.close

    const add = (signal: VpaSignal, note: string) =>
      events.push({ signal, date: bar.date, index: i, rvol, note })

    // Spring diperiksa lebih dulu: ia menjelaskan bar yang menembus support lalu
    // pulih lebih tepat daripada label lain yang juga cocok di bar yang sama.
    const ditembus = levels.supports.find((s) => bar.low < s.price && bar.close > s.price)
    if (ditembus && rvol >= AMBANG.springVolume) {
      add('spring', `menembus support ${ditembus.price} ke ${Math.round(bar.low)} lalu ditutup ${Math.round(bar.close)}`)
      continue
    }

    if (rvol >= AMBANG.climaxVolume && bar.low <= lowestBefore && closePos >= 2 / 3) {
      add('stopping-volume', `low terendah ${EKSTREM} bar pada RVOL ${rvol.toFixed(1)}×, ditutup di sepertiga atas`)
      continue
    }

    if (bar.high > highestBefore && closePos <= 1 / 3 && rvol >= AMBANG.upthrustVolume) {
      add('upthrust', `menembus ${Math.round(highestBefore)} ke ${Math.round(bar.high)} lalu ditutup ${Math.round(bar.close)}`)
      continue
    }

    if (!naik && rvol <= AMBANG.keringVolume && relSpread <= AMBANG.spreadSempit) {
      const diAtasSupport = levels.supports.some((s) => bar.low > s.price)
      if (diAtasSupport) {
        add('no-supply', `bar turun spread sempit pada RVOL ${rvol.toFixed(2)}×, masih di atas support`)
        continue
      }
    }

    if (naik && rvol <= AMBANG.keringVolume) {
      add('no-demand', `bar naik pada RVOL ${rvol.toFixed(2)}× — tidak ada pembeli yang mengejar`)
    }
  }

  const latest = events[events.length - 1] ?? null

  return metric(
    { events, latest },
    latest
      ? `${DESKRIPSI[latest.signal]} (${latest.date})`
      : `tidak ada bar penanda dalam ${LOOKBACK} bar terakhir`,
    latest ? 'sedang' : 'rendah',
    events.map((e) => `${e.date} ${e.signal}: ${e.note}.`),
  )
}
