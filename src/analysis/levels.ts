import { metric, unavailable, type Metric } from './metric.ts'
import type { Bar, VolumeProfile } from '../types.ts'

export interface Level {
  /** Harga level, sudah dibulatkan ke fraksi harga IDX yang sah. */
  price: number
  /** Nilai gabungan 0..1. */
  score: number
  /** Berapa kali harga menguji level ini. */
  touches: number
  /** Bagian volume profil yang menumpuk di level ini, 0..1. */
  volumeShare: number
  lastTouchDate: string
  barsSinceTouch: number
  isRound: boolean
}

export interface LevelsRead {
  supports: Level[]
  resistances: Level[]
}

/**
 * Tabel fraksi harga IDX. Level yang tidak jatuh di fraksi yang sah tidak bisa
 * dipasang sebagai order, jadi tiap level dibulatkan ke sini.
 */
export function idxTickSize(price: number): number {
  if (price < 200) return 1
  if (price < 500) return 2
  if (price < 2000) return 5
  if (price < 5000) return 10
  return 25
}

export function roundToTick(price: number): number {
  const tick = idxTickSize(price)
  return Math.round(price / tick) * tick
}

/**
 * Kebaruan meluruh dengan paruh waktu 60 bar: level yang diuji bulan lalu masih
 * berarti, level dari dua tahun lalu nyaris tidak. Tidak pernah nol — level tua
 * yang sangat sering diuji tetap layak muncul.
 */
export const RECENCY_HALF_LIFE = 60
export function recencyWeight(barsSince: number): number {
  return Math.pow(0.5, barsSince / RECENCY_HALF_LIFE)
}

/** Angka bulat yang lazim jadi penghalang psikologis pada besaran harga ini. */
function roundStep(price: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, price))))
  return magnitude / 2
}

function isRoundNumber(price: number, tolerance: number): boolean {
  const step = roundStep(price)
  return Math.abs(price - Math.round(price / step) * step) <= tolerance
}

/**
 * Lebar pita tempat dua harga dianggap level yang sama — dan, sama pentingnya,
 * tempat harga dianggap SEDANG BERDIRI di sebuah level.
 */
export function clusterTolerance(close: number, atrValue: number): number {
  return Math.max(close * 0.015, atrValue * 0.5)
}

const BOBOT = { touches: 0.35, volume: 0.35, recency: 0.2, round: 0.1 }
/** Sentuhan sebanyak ini sudah dianggap level yang matang. */
const TOUCH_JENUH = 5

/**
 * Support dan resistance DINILAI, bukan sekadar dihitung.
 *
 * Tiga level tiap arah itu cukup; yang menentukan mutunya. Level yang diuji lima
 * kali dengan volume menumpuk di sekitarnya menahan jauh lebih baik daripada satu
 * puncak tipis dari setahun lalu — padahal keduanya sama-sama "satu level" kalau
 * cuma dihitung.
 */
export function findLevels(bars: Bar[], profile: VolumeProfile, atrValue: number): Metric<LevelsRead> {
  if (bars.length < 20) {
    return unavailable(`Butuh minimal 20 bar untuk menilai level, baru ada ${bars.length}.`)
  }

  const close = bars[bars.length - 1]!.close
  const tolerance = clusterTolerance(close, atrValue)

  // Kandidat: tiap swing, plus POC profil volume.
  const candidates: number[] = []
  const lookback = 3
  for (let i = lookback; i < bars.length - lookback; i++) {
    const bar = bars[i]!
    const window = bars.slice(i - lookback, i + lookback + 1)
    if (window.every((w) => bar.high >= w.high)) candidates.push(bar.high)
    if (window.every((w) => bar.low <= w.low)) candidates.push(bar.low)
  }
  const poc = profile.bins[profile.pocIndex]
  if (poc) candidates.push((poc.low + poc.high) / 2)

  if (candidates.length === 0) {
    return unavailable('Tidak ada swing yang bisa dijadikan kandidat level.')
  }

  // Gabungkan kandidat yang berdekatan jadi satu level.
  candidates.sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const c of candidates) {
    const current = clusters[clusters.length - 1]
    if (current && c - current[current.length - 1]! <= tolerance) current.push(c)
    else clusters.push([c])
  }

  const levels: Level[] = clusters.map((cluster) => {
    const price = roundToTick(cluster.reduce((a, b) => a + b, 0) / cluster.length)

    let touches = 0
    let lastTouchIndex = -1
    for (const [i, bar] of bars.entries()) {
      const touched = bar.low - tolerance <= price && price <= bar.high + tolerance
      if (!touched) continue
      touches++
      lastTouchIndex = i
    }

    // Volume yang menumpuk dalam toleransi level ini.
    let volumeShare = 0
    for (const bin of profile.bins) {
      const overlap = Math.min(bin.high, price + tolerance) - Math.max(bin.low, price - tolerance)
      if (overlap > 0) volumeShare += bin.share
    }

    const barsSinceTouch = lastTouchIndex < 0 ? bars.length : bars.length - 1 - lastTouchIndex

    return {
      price,
      score: 0,
      touches,
      volumeShare,
      lastTouchDate: lastTouchIndex >= 0 ? bars[lastTouchIndex]!.date : bars[0]!.date,
      barsSinceTouch,
      isRound: isRoundNumber(price, tolerance),
    }
  })

  const maxVolumeShare = Math.max(...levels.map((l) => l.volumeShare), 1e-9)
  for (const l of levels) {
    l.score =
      BOBOT.touches * Math.min(1, l.touches / TOUCH_JENUH) +
      BOBOT.volume * (l.volumeShare / maxVolumeShare) +
      BOBOT.recency * recencyWeight(l.barsSinceTouch) +
      BOBOT.round * (l.isRound ? 1 : 0)
  }

  // Level yang HARGANYA SEDANG DITEMPATI bukan support maupun resistance.
  //
  // Memisahkan hanya dengan `price < close` / `price > close` menjadikan level yang
  // sedang dipijak harga sebagai "resistance" cuma karena pembulatannya jatuh
  // beberapa rupiah di atas penutupan. Akibatnya fatal buat R:R: targetnya berjarak
  // ~1% sementara stopnya di level sungguhan 7% di bawah, jadi rasionya ditentukan
  // oleh sisi mana angka bulat itu mendarat — bukan oleh pasar. Diukur pada 46
  // emiten: 14 dari 37 yang tersaring keluar punya target <2,5% dari harga, dan
  // yang lolos justru kebalikannya (median risiko 2,6%).
  //
  // Level dihitung sebagai support hanya kalau seluruh pitanya di bawah harga, dan
  // resistance hanya kalau seluruh pitanya di atas.
  const byScore = (a: Level, b: Level) => b.score - a.score
  const supports = levels.filter((l) => l.price < close - tolerance).sort(byScore).slice(0, 3)
  const resistances = levels.filter((l) => l.price > close + tolerance).sort(byScore).slice(0, 3)

  const describe = (l: Level, kind: string) =>
    `${kind} ${l.price}: ${l.touches} sentuhan, terakhir ${l.lastTouchDate} ` +
    `(${l.barsSinceTouch} bar lalu), ${(l.volumeShare * 100).toFixed(1)}% volume profil` +
    `${l.isRound ? ', angka bulat' : ''} — skor ${l.score.toFixed(2)}.`

  const evidence = [
    ...supports.map((l) => describe(l, 'Support')),
    ...resistances.map((l) => describe(l, 'Resistance')),
  ]

  const best = [...supports, ...resistances].sort(byScore)[0]
  const confidence = !best ? 'rendah' : best.score >= 0.7 ? 'tinggi' : best.score >= 0.45 ? 'sedang' : 'rendah'

  return metric(
    { supports, resistances },
    `${supports.length} support dan ${resistances.length} resistance layak pakai di sekitar ${close}`,
    confidence,
    evidence,
  )
}
