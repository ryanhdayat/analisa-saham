import type { ScanRow } from '../analysis/report.ts'
import type { Bar } from '../types.ts'

/**
 * Penilaian pilihan scan: apakah emiten yang lolos gerbang benar-benar naik.
 *
 * Satu pilihan dibuka pada close hari scan dan dibiarkan terbuka sampai harga
 * menyentuh target (benar) atau cut loss (salah). Selama terbuka, nilainya adalah
 * close terakhir. Semuanya dihitung ulang dari bar setiap kali — tidak ada status
 * yang disimpan, jadi run yang terlewat atau diulang tidak pernah menggeser hasil.
 */

/** Satu emiten yang lolos gerbang pada satu scan. Harga dalam mata uang pasar. */
export interface Pilihan {
  code: string
  name: string
  /** Tanggal bar terakhir scan itu; entry adalah close-nya. */
  date: string
  entry: number
  /** Stop dari analisa risk/reward, sebelum dijepit. */
  stop: number
  target: number
}

/**
 * Pilihan dari satu run scan: baris yang lolos gerbang dan punya rencana.
 *
 * Harganya diambil dari baris, bukan dari CSV — CSV membulatkan ENTRY/STOP/TARGET
 * ke bilangan bulat, dan untuk koin seharga $0,0003 itu berarti nol.
 */
export function pilihanFromRows(rows: ScanRow[]): Pilihan[] {
  return rows.flatMap((r) => {
    const rr = r.metrics.riskReward
    if (!r.gates.passed || !rr.available || !rr.value) return []
    return [{ code: r.code, name: r.name, date: r.date, entry: rr.value.entry, stop: rr.value.stop, target: rr.value.target }]
  })
}

/** Bagian emiten gagal diambil yang masih dianggap run lengkap. */
export const MAKS_GAGAL = 0.05

/**
 * Boleh menulis catatan pilihan run ini?
 *
 * Catatan pilihan adalah rekam jejak itu sendiri dan ditimpa per tanggal, jadi
 * yang ditulis harus run yang utuh: watchlist penuh (bukan beberapa kode), bar
 * final (bukan DRAFT), dan hampir semua emiten berhasil diambil. Saat Yahoo
 * membatasi permintaan (HTTP 429), semua atau sebagian besar emiten gagal; tanpa
 * pemeriksaan ini catatan hari itu tertimpa daftar kosong atau bolong.
 */
export function bolehCatat(run: { watchlist: boolean; draft: boolean; total: number; failed: number }): boolean {
  return run.watchlist && !run.draft && run.total > 0 && run.failed / run.total <= MAKS_GAGAL
}

export type Status = 'target' | 'cut' | 'open'

export interface Hasil extends Pilihan {
  /** Stop analisa yang dijepit ke rentang CUT_MIN..CUT_MAX di bawah entry. */
  cut: number
  status: Status
  /** Tanggal bar yang menyelesaikan pilihan; null selama terbuka. */
  settled: string | null
  /** Harga keluar untuk pilihan yang selesai. */
  exit: number | null
  /** Bar terakhir yang dinilai; null kalau belum ada bar setelah scan. */
  last: { date: string; close: number } | null
  /** Return terhadap entry, pecahan: harga keluar, atau close terakhir selama terbuka. */
  ret: number
  /** Jarak tempuh menuju target, pecahan: 1 = sampai target, negatif = di bawah entry. */
  progress: number
  /** Bar perdagangan sejak scan sampai selesai (atau sampai bar terakhir). */
  days: number
}

/** Cut loss paling dangkal dan paling dalam, sebagai pecahan di bawah entry. */
export const CUT_MIN = 0.05
export const CUT_MAX = 0.1

/**
 * Stop analisa, dijepit ke 5–10% di bawah entry.
 *
 * Stop analisa diletakkan di bawah support dan bisa belasan persen jauhnya — terlalu
 * longgar untuk cut loss. Yang terlalu dekat dilonggarkan supaya derak harian biasa
 * tidak langsung menyapunya.
 */
export function cutLoss(entry: number, stop: number): number {
  return Math.min(entry * (1 - CUT_MIN), Math.max(entry * (1 - CUT_MAX), stop))
}

/**
 * Nilai satu pilihan atas bar harian emitennya.
 *
 * Hanya bar SETELAH tanggal scan yang dihitung: entry adalah close hari itu, jadi
 * high/low hari itu terjadi sebelum posisi ada. Bar harian tidak memberi tahu mana
 * yang tersentuh lebih dulu, jadi hari yang menyentuh keduanya dihitung cut loss.
 * Gap turun melewati cut loss keluar di harga buka — itu harga yang benar-benar
 * didapat. Gap naik melewati target tetap dihitung di target.
 */
export function judge(p: Pilihan, bars: Bar[]): Hasil {
  const cut = cutLoss(p.entry, p.stop)
  const after = bars.filter((b) => b.date > p.date)
  const base = { ...p, cut }
  const progressOf = (price: number) => (price - p.entry) / (p.target - p.entry)

  for (const [i, b] of after.entries()) {
    if (b.low <= cut || b.high >= p.target) {
      const status: Status = b.low <= cut ? 'cut' : 'target'
      const exit = status === 'cut' ? Math.min(b.open, cut) : p.target
      return {
        ...base,
        status,
        settled: b.date,
        exit,
        last: { date: b.date, close: b.close },
        ret: exit / p.entry - 1,
        progress: progressOf(exit),
        days: i + 1,
      }
    }
  }

  const lastBar = after.at(-1)
  const price = lastBar?.close ?? p.entry
  return {
    ...base,
    status: 'open',
    settled: null,
    exit: null,
    last: lastBar ? { date: lastBar.date, close: lastBar.close } : null,
    ret: price / p.entry - 1,
    progress: progressOf(price),
    days: after.length,
  }
}

/**
 * Semua pilihan dari kumpulan scan, satu pilihan terbuka per emiten.
 *
 * Emiten yang lolos lagi selagi pilihannya masih terbuka tidak membuka pilihan
 * baru — kalau tidak, emiten yang lolos sepuluh hari berturut-turut terhitung
 * sepuluh kali benar (atau salah) untuk satu gerakan yang sama. Pilihan yang
 * selesai pada hari D memberi jalan bagi scan bertanggal D atau sesudahnya
 * (entry-nya close hari D, setelah pilihan lama selesai di dalam hari itu).
 */
export function buildPicks(scans: Pilihan[], barsByCode: Map<string, Bar[]>): Hasil[] {
  const byCode = new Map<string, Pilihan[]>()
  for (const p of scans) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p])

  const out: Hasil[] = []
  for (const [code, list] of byCode) {
    const bars = barsByCode.get(code) ?? []
    let current: Hasil | null = null
    for (const p of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      if (current && (current.settled === null || current.settled > p.date)) continue
      current = judge(p, bars)
      out.push(current)
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code))
}

/** Rentang `range` Yahoo beserta cakupannya dalam hari kalender. */
const YAHOO_RANGES: [string, number][] = [
  ['5d', 5], ['1mo', 30], ['3mo', 90], ['6mo', 180], ['1y', 365], ['2y', 730], ['5y', 1825], ['10y', 3650],
]

/**
 * Rentang Yahoo terkecil yang mencakup pilihan tertua.
 *
 * Bantalan seminggu menutup selisih antara "bulan" Yahoo dan 30 hari, plus
 * akhir pekan dan libur di awal rentang.
 */
export function yahooRangeSince(earliest: string, now: Date): string {
  const days = (now.getTime() - Date.parse(earliest)) / 86_400_000 + 7
  return YAHOO_RANGES.find(([, cover]) => cover >= days)?.[0] ?? 'max'
}

export interface Ringkasan {
  total: number
  target: number
  cut: number
  open: number
  /**
   * Pilihan yang sudah punya setidaknya satu bar setelah scan. Pilihan semalam
   * belum sempat naik atau turun; menghitungnya membuat persentase benar anjlok
   * setiap kali scan baru masuk.
   */
  dinilai: number
  /** Pilihan dinilai yang harganya naik: kena target, atau terbuka di atas entry. */
  benar: number
  /** Rata-rata return pilihan yang sudah dinilai, pecahan. */
  avgReturn: number
}

export function summarize(picks: Hasil[]): Ringkasan {
  const count = (f: (h: Hasil) => boolean) => picks.filter(f).length
  const dinilai = picks.filter((h) => h.days > 0)
  return {
    total: picks.length,
    target: count((h) => h.status === 'target'),
    cut: count((h) => h.status === 'cut'),
    open: count((h) => h.status === 'open'),
    dinilai: dinilai.length,
    benar: dinilai.filter((h) => h.ret > 0).length,
    avgReturn: dinilai.length === 0 ? 0 : dinilai.reduce((s, h) => s + h.ret, 0) / dinilai.length,
  }
}
