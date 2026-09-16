import { movingAverage } from '../indicators.ts'
import { metric, unavailable, type Metric } from './metric.ts'
import type { Bar } from '../types.ts'

export type VolumeClass =
  | 'permintaan-sejati'
  | 'rally-lemah'
  | 'koreksi-sehat'
  | 'tekanan-jual'
  | 'absorpsi'
  | 'netral'

export interface VolumeRead {
  /** Volume hari terakhir dibagi rata-rata 20 hari. */
  rvol: number
  /** Spread hari terakhir dibagi rata-rata spread 20 hari. */
  relativeSpread: number
  classification: VolumeClass
  recent: Array<{ date: string; rvol: number; classification: VolumeClass }>
  /** 0..1, bagian hari yang volumenya sejalan dengan arah harga. Untuk peringkat. */
  confirmationScore: number
}

const PERIOD = 20
const LOOKBACK = 10

const LABEL: Record<VolumeClass, string> = {
  'permintaan-sejati': 'naik ditopang volume — permintaan sejati',
  'rally-lemah': 'naik tapi volume mengering — rally lemah, rawan gagal',
  'koreksi-sehat': 'turun dengan volume rendah — koreksi sehat',
  'tekanan-jual': 'turun dengan volume membesar — tekanan jual nyata',
  absorpsi: 'volume besar tapi harga nyaris tak bergerak — ada yang menyerap',
  netral: 'volume sejalan rata-rata, tidak ada sinyal menonjol',
}

/**
 * Baca volume TERHADAP harga, bukan sendirian.
 *
 * "Volume naik" tidak berarti apa-apa lepas dari hasilnya pada harga. Yang dinilai
 * di sini effort (volume) lawan result (pergerakan harga) — kalau usaha besar tidak
 * menghasilkan gerak, ada pihak yang menyerap di sisi seberang.
 *
 * Semua ambang di bawah ini konvensi, bukan hukum. Diletakkan sebagai konstanta
 * bernama supaya bisa diperdebatkan dan diubah, bukan tersembunyi di dalam if.
 */
const TINGGI = 1.2
const SANGAT_TINGGI = 1.5
const RENDAH = 0.8
const ABSORPSI_VOLUME = 1.8
const ABSORPSI_SPREAD = 0.7

function classify(rvol: number, relativeSpread: number, priceUp: boolean): VolumeClass {
  // Absorpsi diperiksa lebih dulu: ia menjelaskan bar lebih baik daripada arah
  // harganya yang, justru karena diserap, nyaris tidak bergerak.
  if (rvol >= ABSORPSI_VOLUME && relativeSpread <= ABSORPSI_SPREAD) return 'absorpsi'
  if (priceUp && rvol >= TINGGI) return 'permintaan-sejati'
  if (priceUp && rvol <= RENDAH) return 'rally-lemah'
  if (!priceUp && rvol <= RENDAH) return 'koreksi-sehat'
  if (!priceUp && rvol >= SANGAT_TINGGI) return 'tekanan-jual'
  return 'netral'
}

export function analyzeVolume(bars: Bar[]): Metric<VolumeRead> {
  if (bars.length < PERIOD + 1) {
    return unavailable(`Butuh minimal ${PERIOD + 1} bar untuk RVOL, baru ada ${bars.length}.`)
  }

  const volMA = movingAverage(bars.map((b) => b.volume), PERIOD)
  const spreadMA = movingAverage(bars.map((b) => b.high - b.low), PERIOD)

  const read = (i: number) => {
    const bar = bars[i]!
    // Rata-rata pembanding diambil dari bar SEBELUM hari ini. Kalau hari ini ikut
    // masuk rata-ratanya, hari bervolume raksasa mengencerkan penyebutnya sendiri
    // dan RVOL-nya tercatat lebih kecil dari yang sebenarnya.
    const vAvg = volMA[i - 1]
    const sAvg = spreadMA[i - 1]
    if (vAvg == null || vAvg === 0 || sAvg == null || sAvg === 0) return null
    const rvol = bar.volume / vAvg
    const relativeSpread = (bar.high - bar.low) / sAvg
    const priceUp = bar.close >= bars[i - 1]!.close
    return { date: bar.date, rvol, relativeSpread, priceUp, classification: classify(rvol, relativeSpread, priceUp) }
  }

  const last = read(bars.length - 1)
  if (!last) return unavailable('Rata-rata volume 20 hari nol — emiten praktis tidak diperdagangkan.')

  const recent: VolumeRead['recent'] = []
  let confirms = 0
  let counted = 0
  for (let i = Math.max(1, bars.length - LOOKBACK); i < bars.length; i++) {
    const r = read(i)
    if (!r) continue
    recent.push({ date: r.date, rvol: r.rvol, classification: r.classification })
    counted++
    // Konfirmasi: naik butuh volume di atas rata-rata, turun justru sehat kalau
    // volumenya di bawah rata-rata.
    if (r.priceUp ? r.rvol >= 1 : r.rvol <= 1) confirms++
  }

  const confirmationScore = counted > 0 ? confirms / counted : 0
  const absorpsi = recent.filter((r) => r.classification === 'absorpsi')

  const evidence = [
    `${last.date}: RVOL ${last.rvol.toFixed(2)}×, spread ${last.relativeSpread.toFixed(2)}× rata-rata 20 hari.`,
    `${counted} bar terakhir: ${confirms} di antaranya volumenya sejalan dengan arah harga.`,
  ]
  for (const a of absorpsi) {
    evidence.push(`Absorpsi ${a.date} pada RVOL ${a.rvol.toFixed(2)}×.`)
  }

  const confidence = last.rvol >= SANGAT_TINGGI || last.rvol <= RENDAH ? 'sedang' : 'rendah'

  return metric(
    { rvol: last.rvol, relativeSpread: last.relativeSpread, classification: last.classification, recent, confirmationScore },
    `${LABEL[last.classification]} (RVOL ${last.rvol.toFixed(2)}×)`,
    confidence,
    evidence,
  )
}
