import type { Status } from '../hasil/nilai.ts'
import type { Bar } from '../types.ts'

/**
 * Statistik uji ulang: seberapa sering harga naik setelah scan, dikelompokkan
 * per nilai tiap kolom scan.
 *
 * Satu sampel = satu emiten pada satu tanggal di masa lalu, dianalisis hanya
 * dengan bar sampai tanggal itu. Modul ini murni; pengambilan data dan
 * analisisnya ada di src/replay.ts.
 */

export interface Outcome {
  status: Status
  ret: number
}

export interface Sample {
  code: string
  date: string
  /** Nilai kolom scan pada tanggal itu, berkunci header CSV. */
  values: Record<string, string | number | null>
  /** Return maju sekian bar; null kalau datanya belum sampai. */
  fwd: number | null
  /**
   * Hasil rencana entry/target/cut loss dengan aturan /hasil/, per varian target:
   * `analisa` memakai target analisa apa adanya, varian lain memotongnya. Kosong
   * kalau sampel tidak punya rencana.
   */
  trades: Record<string, Outcome>
}

/**
 * Return close-ke-close `horizon` bar ke depan. Close nol di salah satu ujung
 * adalah data rusak (Yahoo mengirimnya untuk koin yang sempat mati), bukan -100%
 * atau +∞ — keduanya null supaya tidak merusak rata-rata.
 */
export function forwardReturn(bars: Bar[], i: number, horizon: number): number | null {
  const now = bars[i]!.close
  const later = bars[i + horizon]?.close
  return later !== undefined && now > 0 && later > 0 ? later / now - 1 : null
}

/**
 * Indeks bar yang dijadikan tanggal sampel: mundur dari bar terakhir tiap `step`
 * bar, selama sejarahnya minimal `minHistory` bar dan tidak lebih dari
 * `lookback` bar ke belakang. Urut naik.
 */
export function sampleIndices(n: number, o: { step: number; minHistory: number; lookback: number }): number[] {
  const out: number[] = []
  for (let i = n - 1; i >= o.minHistory - 1 && i >= n - 1 - o.lookback; i -= o.step) out.push(i)
  return out.reverse()
}

export interface Bucket {
  label: string
  samples: Sample[]
}

/** Angka di bawah ini dianggap kategori (mis. TREND yang hanya 0; 0,2; …; 1). */
const MAX_DISCRETE = 6
const QUANTILES = 5

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',')

/**
 * Kelompokkan sampel menurut satu kolom. Teks per nilai; angka dengan sedikit
 * nilai unik juga per nilai; angka kontinu per kuantil (Q1 terendah). Nilai
 * kosong masuk kelompok `n/a` — itu sendiri bisa bermakna, mis. tanpa rencana R:R.
 */
export function bucketize(samples: Sample[], column: string): Bucket[] {
  const present = samples.map((s) => s.values[column] ?? null).filter((v) => v !== null)
  const numeric = present.length > 0 && present.every((v) => typeof v === 'number')
  const unique = new Set(present)
  const groups = new Map<string, Sample[]>()
  const add = (label: string, s: Sample) => groups.set(label, [...(groups.get(label) ?? []), s])

  if (numeric && unique.size > MAX_DISCRETE) {
    const sorted = (present as number[]).sort((a, b) => a - b)
    const cuts = Array.from({ length: QUANTILES - 1 }, (_, k) => sorted[Math.floor(((k + 1) * sorted.length) / QUANTILES) - 1]!)
    const labels = [...cuts.map((c, k) => `Q${k + 1} (≤ ${fmt(c)})`), `Q${QUANTILES} (> ${fmt(cuts.at(-1)!)})`]
    const order = ['n/a', ...labels]
    for (const s of samples) {
      const v = s.values[column] ?? null
      if (v === null) add('n/a', s)
      else {
        const k = cuts.findIndex((c) => (v as number) <= c)
        add(labels[k === -1 ? QUANTILES - 1 : k]!, s)
      }
    }
    return order.filter((l) => groups.has(l)).map((label) => ({ label, samples: groups.get(label)! }))
  }

  const key = (v: string | number | null) => (v === null ? 'n/a' : typeof v === 'number' ? fmt(v) : v)
  for (const s of samples) add(key(s.values[column] ?? null), s)
  const sortKey = new Map(samples.map((s) => [key(s.values[column] ?? null), s.values[column] ?? null]))
  return [...groups.keys()]
    .sort((a, b) => {
      if (a === 'n/a' || b === 'n/a') return a === 'n/a' ? -1 : 1
      const va = sortKey.get(a)
      const vb = sortKey.get(b)
      return typeof va === 'number' && typeof vb === 'number' ? va - vb : a.localeCompare(b)
    })
    .map((label) => ({ label, samples: groups.get(label)! }))
}

export interface BucketStats {
  label: string
  n: number
  /** Sampel yang return majunya sudah diketahui. */
  nFwd: number
  /** Pecahan sampel yang harganya naik setelah `horizon` bar. */
  naik: number | null
  rata: number | null
  median: number | null
  /** Sampel dengan rencana yang sudah kena target atau cut loss. */
  nSettled: number
  /** Pecahan yang kena target lebih dulu, di antara yang selesai. */
  kenaTarget: number | null
  /** Rata-rata return rencana yang selesai. */
  rataTrade: number | null
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function summarizeBucket(label: string, samples: Sample[]): BucketStats {
  const fwd = samples.map((s) => s.fwd).filter((v): v is number => v !== null)
  const t = tradeStats(samples, 'analisa')
  return {
    label,
    n: samples.length,
    nFwd: fwd.length,
    naik: fwd.length ? fwd.filter((v) => v > 0).length / fwd.length : null,
    rata: mean(fwd),
    median: median(fwd),
    ...t,
  }
}

export interface TradeStats {
  nSettled: number
  kenaTarget: number | null
  rataTrade: number | null
}

/** Hasil satu varian target, hanya dari rencana yang sudah kena target atau cut loss. */
function tradeStats(samples: Sample[], variant: string): TradeStats {
  const settled = samples.flatMap((s) => {
    const o = s.trades[variant]
    return o && o.status !== 'open' ? [o] : []
  })
  return {
    nSettled: settled.length,
    kenaTarget: settled.length ? settled.filter((o) => o.status === 'target').length / settled.length : null,
    rataTrade: mean(settled.map((o) => o.ret)),
  }
}

/** Target analisa, tapi tidak lebih jauh dari `cap` (pecahan) di atas entry. */
export function capTarget(entry: number, target: number, cap: number): number {
  return Math.min(target, entry * (1 + cap))
}

export interface FilterStats {
  label: string
  /** Sampel yang return majunya sudah diketahui. */
  n: number
  naik: number | null
  median: number | null
  /** Persen naik sebelum dan sesudah `split` — efek yang nyata mestinya muncul di keduanya. */
  naikAwal: number | null
  naikAkhir: number | null
  trades: Record<string, TradeStats>
}

const upShare = (samples: Sample[]) => {
  const f = samples.map((s) => s.fwd).filter((v): v is number => v !== null)
  return f.length ? f.filter((v) => v > 0).length / f.length : null
}

/**
 * Ringkasan satu kondisi (kombinasi kolom). Kondisinya diturunkan dari data yang
 * sama, jadi rawan kebetulan; pemisahan per paruh waktu adalah pemeriksaan
 * murahnya — kondisi yang hanya unggul di satu paruh patut dicurigai.
 */
export function evaluateFilter(label: string, samples: Sample[], split: string, variants: string[]): FilterStats {
  const fwd = samples.map((s) => s.fwd).filter((v): v is number => v !== null)
  return {
    label,
    n: fwd.length,
    naik: upShare(samples),
    median: median(fwd),
    naikAwal: upShare(samples.filter((s) => s.date < split)),
    naikAkhir: upShare(samples.filter((s) => s.date >= split)),
    trades: Object.fromEntries(variants.map((v) => [v, tradeStats(samples, v)])),
  }
}

/** Kelompok yang boleh ikut peringkat: cukup sampel, punya return maju, dan bukan n/a. */
export function isRanked(b: BucketStats, minN: number): boolean {
  return b.nFwd >= minN && b.naik !== null && b.label !== 'n/a'
}

export interface ColumnRank {
  column: string
  /** Selisih persen naik antara kelompok terbaik dan terburuk (yang cukup sampel). */
  spread: number
  buckets: BucketStats[]
}

/**
 * Kolom mana yang paling membedakan: urut dari selisih persen naik terbesar
 * antar-kelompoknya. Kelompok dengan sampel di bawah `minN` diabaikan supaya
 * satu kelompok langka tidak tampak sebagai sinyal. Kelompok `n/a` juga: isinya
 * emiten yang datanya kurang (mis. saham tidur yang harganya diam), dan itu
 * mengukur kualitas data, bukan kolomnya.
 */
export function rankColumns(samples: Sample[], columns: string[], minN: number): ColumnRank[] {
  return columns
    .map((column) => {
      const buckets = bucketize(samples, column).map((b) => summarizeBucket(b.label, b.samples))
      const rates = buckets.filter((b) => isRanked(b, minN)).map((b) => b.naik!)
      const spread = rates.length >= 2 ? Math.max(...rates) - Math.min(...rates) : 0
      return { column, spread, buckets }
    })
    .sort((a, b) => b.spread - a.spread)
}
