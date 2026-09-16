import type { Bar } from '../types.ts'

/**
 * True range: rentang harian, tapi diperlebar kalau ada gap terhadap penutupan
 * kemarin. Gap itu pergerakan sungguhan yang harus ditanggung stop, jadi tidak
 * boleh diabaikan.
 */
export function trueRange(bar: Bar, prev: Bar | undefined): number {
  if (!prev) return bar.high - bar.low
  return Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(prev.close - bar.low))
}

/**
 * ATR ala Wilder: nilai pertama rata-rata sederhana `period` true range pertama,
 * sesudahnya dihaluskan `(prev × (period-1) + tr) / period`.
 *
 * Sengaja Wilder, bukan SMA, supaya angkanya sebanding dengan ATR di platform lain —
 * SMA bereaksi lebih cepat dan menghasilkan stop yang lebih sempit dari yang diharapkan.
 */
export function atr(bars: Bar[], period: number): Array<number | null> {
  const out: Array<number | null> = bars.map(() => null)
  if (bars.length < period) return out

  const tr = bars.map((b, i) => trueRange(b, bars[i - 1]))

  let value = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = value
  for (let i = period; i < bars.length; i++) {
    value = (value * (period - 1) + tr[i]!) / period
    out[i] = value
  }
  return out
}
