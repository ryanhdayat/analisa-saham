import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { columnsFor } from './columns.ts'
import { IDX, type Market } from '../market.ts'
import type { ScanRow } from '../analysis/report.ts'
import type { Bar } from '../types.ts'

/**
 * Halaman screener HTML: tabel semua emiten yang bisa diurutkan dan disaring,
 * dengan laci per emiten (grafik candle, level, rencana, bukti tiap metrik).
 *
 * Datanya diambil dari baris yang SAMA dengan CSV/Excel — kolomnya lewat
 * `columnsFor` — jadi halaman ini tidak pernah berbeda isi dengan laporan lain.
 *
 * Tabelnya ditanam utuh di index.html supaya tampilan pertama langsung lengkap.
 * Detail dan bar per emiten dipecah per CHUNK emiten ke data/*.json dan baru
 * dimuat saat kodenya diklik; menanam semuanya membuat halaman belasan MB.
 */

/** Bar yang digambar di grafik. */
export const CHART_BARS = 180
/** Emiten per berkas data. */
export const CHUNK = 60

export interface ScreenerOptions {
  /** Bar terakhir masih intraday — tampilkan spanduk DRAFT. */
  draft?: boolean
  /** Ambang likuiditas dalam mata uang pasar penuh. */
  minValue: number
  minRatio: number
  /** Waktu pembuatan, untuk spanduk draft. Bawaannya sekarang. */
  now?: Date
}

export interface ScreenerSite {
  html: string
  /** Jalur relatif (mis. `data/detail-0.json`) → isi berkas. */
  files: Map<string, string>
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d

/** Satu baris tabel, berkunci header CSV — satu sumber kebenaran dengan laporan lain. */
function tableRow(row: ScanRow, market: Market): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const c of columnsFor(market)) {
    const v = c.value(row)
    out[c.header] = typeof v === 'number' ? (Number.isFinite(v) ? round(v, 4) : null) : v
  }
  // Header nilai harian membawa mata uang (NILAI_HARIAN_RP / _USD). Halaman
  // memakai kunci netral, plus teks yang diformat pasarnya sendiri.
  const valueKey = `NILAI_HARIAN_${market.currencyCode}`
  const value = out[valueKey] as number | null
  delete out[valueKey]
  out.NILAI_HARIAN = value
  out.NILAI_HARIAN_TEKS = value == null ? null : market.moneyCompact(value)
  return out
}

function detail(row: ScanRow) {
  const lv = row.metrics.levels.value ?? { supports: [], resistances: [] }
  const vpa = row.metrics.vpa.value ?? { events: [] }
  return {
    metrics: Object.entries(row.metrics).map(([key, m]) => ({
      key, ok: m.available, conf: m.confidence, verdict: m.verdict, evidence: m.evidence,
    })),
    sup: lv.supports.map((l) => ({ p: l.price, s: round(l.score, 2), t: l.touches })),
    res: lv.resistances.map((l) => ({ p: l.price, s: round(l.score, 2), t: l.touches })),
    vpa: vpa.events.map((e) => ({ d: e.date, g: e.signal, n: e.note })),
    failures: row.gates.failures,
    rank: row.rank,
  }
}

/** Rata-rata bergerak sederhana; null sampai jendelanya penuh. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  values.forEach((v, i) => {
    sum += v
    if (i >= n) sum -= values[i - n]!
    out.push(i >= n - 1 ? round(sum / n, 2) : null)
  })
  return out
}

/**
 * Bar grafik. MA dihitung dari riwayat PENUH lalu dipotong, supaya MA200 sudah
 * terisi di bar pertama yang digambar — bukan baru muncul di ujung kanan.
 */
function chartBars(bars: Bar[], market: Market) {
  const closes = bars.map((b) => b.close)
  const [m20, m50, m200] = [20, 50, 200].map((n) => sma(closes, n).slice(-CHART_BARS))
  const tail = bars.slice(-CHART_BARS)
  const px = (k: 'open' | 'high' | 'low' | 'close') => tail.map((b) => round(b[k], 2))
  return {
    d: tail.map((b) => b.date), o: px('open'), h: px('high'), l: px('low'), c: px('close'),
    v: tail.map((b) => Math.round(market.toDisplayVolume(b.volume))),
    m20, m50, m200,
  }
}

const json = (x: unknown) => JSON.stringify(x)

/**
 * JSON yang aman ditanam di dalam <script>: `</script>` di sebuah nama emiten
 * atau string bukti tidak boleh bisa menutup tag lebih awal.
 */
export const inlineJson = (x: unknown) => json(x).replace(/</g, '\\u003c')

export function jakartaStamp(now: Date): string {
  const t = new Date(now.getTime() + 7 * 3600_000).toISOString()
  return `${t.slice(0, 10)} ${t.slice(11, 16)} WIB`
}

/**
 * Bangun halaman tanpa menyentuh disk.
 *
 * `rows` sudah dalam urutan laporan (lolos menurut skor, lalu tersaring);
 * urutan itu juga yang menentukan chunk, sama seperti CSV.
 */
export function buildScreener(
  rows: ScanRow[],
  barsByCode: Map<string, Bar[]>,
  template: string,
  market: Market = IDX,
  options: ScreenerOptions,
): ScreenerSite {
  const codes = rows.map((r) => r.code)
  const chunkOf: Record<string, number> = {}
  codes.forEach((c, i) => (chunkOf[c] = Math.floor(i / CHUNK)))

  const files = new Map<string, string>()
  const nChunks = Math.ceil(rows.length / CHUNK)
  for (let i = 0; i < nChunks; i++) {
    const part = rows.slice(i * CHUNK, (i + 1) * CHUNK)
    const details: Record<string, unknown> = {}
    const bars: Record<string, unknown> = {}
    for (const r of part) {
      details[r.code] = detail(r)
      const b = barsByCode.get(r.code)
      if (b && b.length > 0) bars[r.code] = chartBars(b, market)
    }
    files.set(`data/detail-${i}.json`, json(details))
    files.set(`data/bars-${i}.json`, json(bars))
  }

  const used = [...new Set(rows.flatMap((r) => r.rank.used))]
  const meta = {
    tanggal: rows[0]?.date ?? (options.now ?? new Date()).toISOString().slice(0, 10),
    draft: options.draft ?? false,
    dibuat: jakartaStamp(options.now ?? new Date()),
    degraded: rows.some((r) => r.rank.degraded),
    used: used.join(', ') || 'n/a',
    exchange: market.exchangeLabel,
    volumeUnit: market.volumeUnit,
    minValue: market.moneyCompact(options.minValue),
    minRatio: options.minRatio,
    minRatioText: String(round(options.minRatio, 2)).replace('.', ','),
    chunk: chunkOf,
  }

  const title = market.id === 'idx' ? 'Screener Watchlist IDX' : `Screener Watchlist ${market.exchangeLabel}`
  // Fungsi pengganti, bukan string: `$&` atau `$'` di data tidak boleh ditafsir
  // sebagai pola pengganti String.replace.
  const html = template
    .replace('/*__TITLE__*/', () => title)
    .replace('/*__ROWS__*/[]', () => inlineJson(rows.map((r) => tableRow(r, market))))
    .replace('/*__META__*/{}', () => inlineJson(meta))
  return { html, files }
}

export async function loadTemplate(): Promise<string> {
  return readFile(new URL('./screener-template.html', import.meta.url), 'utf8')
}

/** Tulis halaman ke `dir` (index.html + data/). Mengembalikan jalur index.html. */
export async function writeScreener(
  dir: string,
  rows: ScanRow[],
  barsByCode: Map<string, Bar[]>,
  market: Market,
  options: ScreenerOptions,
): Promise<string> {
  const site = buildScreener(rows, barsByCode, await loadTemplate(), market, options)
  await mkdir(join(dir, 'data'), { recursive: true })
  for (const [path, content] of site.files) await writeFile(join(dir, path), content)
  const index = join(dir, 'index.html')
  await writeFile(index, site.html)
  return index
}

/**
 * Bar terakhir masih intraday? Hanya berlaku untuk bursa yang tutup (IDX):
 * hari kerja, bar bertanggal hari ini, sebelum 16:15 WIB.
 */
export function isIntraday(lastBarDate: string, market: Market, now: Date = new Date()): boolean {
  if (market.id !== 'idx') return false
  const wib = new Date(now.getTime() + 7 * 3600_000)
  const day = wib.getUTCDay()
  const minutes = wib.getUTCHours() * 60 + wib.getUTCMinutes()
  return lastBarDate === wib.toISOString().slice(0, 10) && day >= 1 && day <= 5 && minutes < 16 * 60 + 15
}
