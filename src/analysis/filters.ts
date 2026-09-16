import { movingAverage } from '../indicators.ts'
import { metric, unavailable, type Metric } from './metric.ts'
import type { Bar } from '../types.ts'

export type Divergence = 'bullish' | 'bearish' | null

export interface FiltersRead {
  ma20: number
  ma50: number
  ma200: number
  /** close > MA20 > MA50 > MA200. */
  stacked: boolean
  /** 0..1 dari lima syarat tren. Dipakai untuk peringkat. */
  trendScore: number
  obvDivergence: Divergence
  adDivergence: Divergence
}

/** On-balance volume: volume penuh masuk kalau close naik, keluar kalau turun. */
export function obv(bars: Bar[]): number[] {
  const out: number[] = []
  let total = 0
  for (const [i, bar] of bars.entries()) {
    const prev = bars[i - 1]
    if (prev) {
      if (bar.close > prev.close) total += bar.volume
      else if (bar.close < prev.close) total -= bar.volume
    }
    out.push(total)
  }
  return out
}

/**
 * Accumulation/Distribution: menimbang volume dengan posisi close di dalam rentang
 * harian. Bar tanpa rentang menyumbang nol — bukan dibagi nol.
 */
export function adLine(bars: Bar[]): number[] {
  const out: number[] = []
  let total = 0
  for (const bar of bars) {
    const range = bar.high - bar.low
    if (range > 0) {
      total += ((bar.close - bar.low - (bar.high - bar.close)) / range) * bar.volume
    }
    out.push(total)
  }
  return out
}

const RECENT = 20
const PRIOR_FROM = 60

/**
 * Divergensi: harga mencetak low baru sementara indikator alirannya tidak ikut —
 * tekanan jual mengering di balik harga yang masih turun.
 *
 * Dibaca dengan membandingkan ekstrem jendela terakhir terhadap jendela sebelumnya.
 * Sederhana dan bisa diulang; tidak sehalus membaca pivot satu per satu, tapi
 * tidak bergantung pada parameter yang harus dikutak-katik.
 */
function divergence(bars: Bar[], line: number[]): Divergence {
  if (bars.length < PRIOR_FROM) return null
  const recent = bars.slice(-RECENT)
  const prior = bars.slice(-PRIOR_FROM, -RECENT)
  if (prior.length === 0) return null

  const offsetRecent = bars.length - RECENT
  const offsetPrior = bars.length - PRIOR_FROM

  const iLowRecent = offsetRecent + recent.indexOf(recent.reduce((a, b) => (b.low < a.low ? b : a)))
  const iLowPrior = offsetPrior + prior.indexOf(prior.reduce((a, b) => (b.low < a.low ? b : a)))
  const iHighRecent = offsetRecent + recent.indexOf(recent.reduce((a, b) => (b.high > a.high ? b : a)))
  const iHighPrior = offsetPrior + prior.indexOf(prior.reduce((a, b) => (b.high > a.high ? b : a)))

  if (bars[iLowRecent]!.low < bars[iLowPrior]!.low && line[iLowRecent]! > line[iLowPrior]!) {
    return 'bullish'
  }
  if (bars[iHighRecent]!.high > bars[iHighPrior]!.high && line[iHighRecent]! < line[iHighPrior]!) {
    return 'bearish'
  }
  return null
}

/** Kemiringan MA diukur terhadap nilainya 10 bar lalu. */
const SLOPE_LOOKBACK = 10

export function analyzeFilters(bars: Bar[]): Metric<FiltersRead> {
  if (bars.length < 200 + SLOPE_LOOKBACK) {
    return unavailable(`Butuh ${200 + SLOPE_LOOKBACK} bar untuk MA 200 beserta kemiringannya, baru ada ${bars.length}.`)
  }

  const closes = bars.map((b) => b.close)
  const last = bars.length - 1
  const ma = (p: number) => movingAverage(closes, p)

  const ma20s = ma(20)
  const ma50s = ma(50)
  const ma200s = ma(200)

  const ma20 = ma20s[last]
  const ma50 = ma50s[last]
  const ma200 = ma200s[last]
  if (ma20 == null || ma50 == null || ma200 == null) {
    return unavailable('MA belum lengkap di bar terakhir.')
  }

  const close = closes[last]!
  const slope50 = ma50 - (ma50s[last - SLOPE_LOOKBACK] ?? ma50)
  const slope200 = ma200 - (ma200s[last - SLOPE_LOOKBACK] ?? ma200)

  const syarat = [close > ma20, ma20 > ma50, ma50 > ma200, slope50 > 0, slope200 > 0]
  const trendScore = syarat.filter(Boolean).length / syarat.length
  const stacked = close > ma20 && ma20 > ma50 && ma50 > ma200

  const obvDivergence = divergence(bars, obv(bars))
  const adDivergence = divergence(bars, adLine(bars))

  const evidence = [
    `MA 20 ${Math.round(ma20)}, MA 50 ${Math.round(ma50)}, MA 200 ${Math.round(ma200)}; close ${Math.round(close)}.`,
    `Kemiringan 10 bar: MA 50 ${slope50 >= 0 ? 'naik' : 'turun'}, MA 200 ${slope200 >= 0 ? 'naik' : 'turun'}.`,
  ]
  if (obvDivergence) evidence.push(`Divergensi OBV ${obvDivergence}.`)
  if (adDivergence) evidence.push(`Divergensi A/D ${adDivergence}.`)

  return metric(
    { ma20, ma50, ma200, stacked, trendScore, obvDivergence, adDivergence },
    stacked
      ? `tren mendukung — harga di atas MA 20/50/200 yang tersusun rapi`
      : `tren belum mendukung — ${syarat.filter(Boolean).length} dari ${syarat.length} syarat terpenuhi`,
    trendScore >= 0.8 || trendScore <= 0.2 ? 'tinggi' : 'sedang',
    evidence,
  )
}
