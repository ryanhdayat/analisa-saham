import { metric, unavailable, type Confidence, type Metric } from './metric.ts'
import type { Bar } from '../types.ts'

export type Structure = 'uptrend' | 'downtrend' | 'sideways'
export type Phase = 'pullback' | 'rebound' | 'impulse' | 'datar'

export interface Swing {
  index: number
  date: string
  price: number
}

export interface TimeframeRead {
  structure: Structure
  phase: Phase
  swingHighs: Swing[]
  swingLows: Swing[]
}

export interface StructureRead {
  daily: TimeframeRead
  weekly: TimeframeRead
  /** Struktur harian dan mingguan menunjuk arah yang sama. */
  aligned: boolean
}

export const SWING_LOOKBACK = 3

/**
 * Pivot fraktal: sebuah bar jadi swing high kalau high-nya tertinggi di jendela
 * `lookback` bar ke kiri DAN ke kanan. Karena butuh konfirmasi ke kanan, swing
 * terbaru selalu tertinggal `lookback` bar — itu memang sifatnya, bukan bug.
 * Level yang belum dikonfirmasi bukan level.
 */
export function findSwings(bars: Bar[], lookback = SWING_LOOKBACK): { highs: Swing[]; lows: Swing[] } {
  const highs: Swing[] = []
  const lows: Swing[] = []

  for (let i = lookback; i < bars.length - lookback; i++) {
    const bar = bars[i]!
    const window = bars.slice(i - lookback, i + lookback + 1)
    if (window.every((w) => bar.high >= w.high)) {
      highs.push({ index: i, date: bar.date, price: bar.high })
    }
    if (window.every((w) => bar.low <= w.low)) {
      lows.push({ index: i, date: bar.date, price: bar.low })
    }
  }

  return { highs, lows }
}

/** Ambang gerak yang dianggap berarti; di bawah ini dua swing dianggap sederajat. */
const MENDATAR = 0.01

function readTimeframe(bars: Bar[]): TimeframeRead | null {
  const { highs, lows } = findSwings(bars)
  if (highs.length < 2 || lows.length < 2) return null

  const [h1, h2] = highs.slice(-2) as [Swing, Swing]
  const [l1, l2] = lows.slice(-2) as [Swing, Swing]

  const higherHighs = h2.price > h1.price * (1 + MENDATAR)
  const lowerHighs = h2.price < h1.price * (1 - MENDATAR)
  const higherLows = l2.price > l1.price * (1 + MENDATAR)
  const lowerLows = l2.price < l1.price * (1 - MENDATAR)

  const structure: Structure =
    higherHighs && higherLows ? 'uptrend' : lowerHighs && lowerLows ? 'downtrend' : 'sideways'

  const close = bars[bars.length - 1]!.close
  let phase: Phase = 'datar'
  if (structure === 'uptrend') phase = close < h2.price ? 'pullback' : 'impulse'
  else if (structure === 'downtrend') phase = close > l2.price ? 'rebound' : 'impulse'

  return { structure, phase, swingHighs: highs.slice(-4), swingLows: lows.slice(-4) }
}

const FASE: Record<Phase, string> = {
  pullback: 'pullback — mundur di dalam tren, peluang beli kalau strukturnya bertahan',
  rebound: 'rebound — naik di dalam downtrend, sering jadi jebakan',
  impulse: 'impuls — bergerak searah struktur',
  datar: 'datar — tidak ada fase yang jelas',
}

/**
 * Pisahkan STRUKTUR dari FASE.
 *
 * Uptrend/downtrend/sideways menggambarkan struktur: apakah puncak dan lembah
 * meninggi atau merendah. Pullback dan rebound adalah fase DI DALAM struktur itu.
 * Bedanya menentukan: pullback di dalam uptrend peluang beli, rebound di dalam
 * downtrend justru jebakan — grafiknya bisa terlihat mirip.
 *
 * Dikonfirmasi di dua timeframe: mingguan untuk arah, harian untuk entry. Kalau
 * keduanya bertentangan, keyakinannya turun, bukan dipilih salah satu diam-diam.
 */
export function analyzeStructure(daily: Bar[], weekly: Bar[]): Metric<StructureRead> {
  const d = readTimeframe(daily)
  if (!d) return unavailable('Belum ada dua swing high dan dua swing low harian untuk membaca struktur.')

  const w = readTimeframe(weekly) ?? d
  const aligned = d.structure === w.structure

  const confidence: Confidence = aligned ? (d.structure === 'sideways' ? 'sedang' : 'tinggi') : 'rendah'

  const evidence = [
    `Swing high harian terakhir: ${d.swingHighs.slice(-2).map((s) => `${s.date} @ ${Math.round(s.price)}`).join(' → ')}.`,
    `Swing low harian terakhir: ${d.swingLows.slice(-2).map((s) => `${s.date} @ ${Math.round(s.price)}`).join(' → ')}.`,
  ]
  if (!aligned) {
    evidence.push(`Mingguan ${w.structure} sementara harian ${d.structure} — arahnya belum satu suara.`)
  }

  return metric(
    { daily: d, weekly: w, aligned },
    `harian ${d.structure}, mingguan ${w.structure}; ${FASE[d.phase]}`,
    confidence,
    evidence,
  )
}
