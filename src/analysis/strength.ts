import { metric, unavailable, type Metric } from './metric.ts'
import type { Bar } from '../types.ts'

export interface StrengthRead {
  /** Selisih return emiten dan IHSG, persen poin. */
  rs20: number
  rs60: number
  vsSector20: number | null
  vsSector60: number | null
  /** IHSG turun tapi emiten bertahan atau naik. */
  hiddenDemand: boolean
  /** 0..1 untuk peringkat. */
  rsScore: number
}

/**
 * Sejajarkan dua deret pada tanggal yang sama-sama ada.
 *
 * Emiten yang disuspensi sehari punya hari bursa yang tidak dimiliki deret indeks
 * dan sebaliknya. Membandingkan return berdasarkan posisi indeks array — bukan
 * tanggal — diam-diam menggeser jendela dan menghasilkan angka yang salah.
 */
function align(a: Bar[], b: Bar[]): { a: number[]; b: number[] } {
  const mapB = new Map(b.map((bar) => [bar.date, bar.close]))
  const closesA: number[] = []
  const closesB: number[] = []
  for (const bar of a) {
    const other = mapB.get(bar.date)
    if (other === undefined) continue
    closesA.push(bar.close)
    closesB.push(other)
  }
  return { a: closesA, b: closesB }
}

function returnPct(closes: number[], days: number): number | null {
  if (closes.length <= days) return null
  const from = closes[closes.length - 1 - days]!
  const to = closes[closes.length - 1]!
  if (from === 0) return null
  return ((to - from) / from) * 100
}

/** RS ±20 poin persen dipetakan ke 0..1; di luar itu dipotong. */
const RS_SKALA = 20

export function analyzeStrength(
  bars: Bar[],
  indexBars: Bar[],
  sectorBars?: Bar[],
): Metric<StrengthRead> {
  const paired = align(bars, indexBars)
  if (paired.a.length < 61) {
    return unavailable(
      `Butuh 61 hari bursa yang beririsan dengan IHSG, baru ada ${paired.a.length}.`,
    )
  }

  const rs = (days: number): number | null => {
    const stock = returnPct(paired.a, days)
    const index = returnPct(paired.b, days)
    return stock == null || index == null ? null : stock - index
  }

  const rs20 = rs(20)
  const rs60 = rs(60)
  if (rs20 == null || rs60 == null) return unavailable('Return 20/60 hari tidak bisa dihitung.')

  let vsSector20: number | null = null
  let vsSector60: number | null = null
  if (sectorBars && sectorBars.length > 0) {
    const s = align(bars, sectorBars)
    if (s.a.length > 60) {
      const stock20 = returnPct(s.a, 20)
      const sector20 = returnPct(s.b, 20)
      const stock60 = returnPct(s.a, 60)
      const sector60 = returnPct(s.b, 60)
      vsSector20 = stock20 != null && sector20 != null ? stock20 - sector20 : null
      vsSector60 = stock60 != null && sector60 != null ? stock60 - sector60 : null
    }
  }

  const stock20 = returnPct(paired.a, 20)!
  const index20 = returnPct(paired.b, 20)!
  const hiddenDemand = index20 < 0 && stock20 >= 0

  const rsScore = Math.min(1, Math.max(0, (rs60 + RS_SKALA) / (2 * RS_SKALA)))

  const evidence = [
    `20 hari: emiten ${stock20.toFixed(1)}% vs IHSG ${index20.toFixed(1)}% → RS ${rs20.toFixed(1)} poin.`,
    `60 hari: RS ${rs60.toFixed(1)} poin terhadap IHSG.`,
    vsSector60 === null
      ? 'Terhadap indeks sektor: tidak tersedia (butuh data IDX).'
      : `60 hari terhadap sektor: ${vsSector60.toFixed(1)} poin.`,
  ]

  const verdict = hiddenDemand
    ? `bertahan saat IHSG melemah — permintaan tersembunyi (RS 60 hari ${rs60.toFixed(1)} poin)`
    : `RS 60 hari ${rs60.toFixed(1)} poin terhadap IHSG`

  return metric(
    { rs20, rs60, vsSector20, vsSector60, hiddenDemand, rsScore },
    verdict,
    Math.abs(rs60) >= 10 ? 'sedang' : 'rendah',
    evidence,
  )
}
