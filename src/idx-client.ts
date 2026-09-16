// DISALIN dari 01-app1/src/idx-client.ts pada 2026-09-16.
//
// Disalin, bukan diimpor lintas proyek: keduanya proyek terpisah, dan impor lintas
// direktori membuat kebenaran proyek ini bergantung pada suntingan di sebelah.
// Biayanya duplikasi; gantinya berkas ini hanya berubah kalau kita yang mengubahnya.
//
// Satu-satunya penyesuaian: CACHE_DIR menunjuk ke raw/idx milik proyek ini.
/// <reference lib="dom" />
// ^ hanya untuk type-check kode di dalam page.evaluate() (berjalan di browser,
//   bukan di Bun). Tidak mengubah runtime.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type {
  IndexBar,
  RawCompanyProfile,
  RawIndexSummary,
  RawIndexListItem,
  RawStockSummary,
  SectorInfo,
  StockSummaryResponse,
} from './idx-types.ts'

const BASE = 'https://www.idx.co.id'
const CACHE_DIR = join(process.cwd(), 'raw', 'idx')

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * IDX berada di belakang Cloudflare. Sejak pertengahan 2026, request "telanjang"
 * (fetch bawaan Bun/Node, curl) diblokir 403 di lapisan fingerprint TLS/HTTP2 —
 * bukan sekadar cookie atau User-Agent. Halaman yang balik adalah blokir statis
 * Cloudflare ("Sorry, you have been blocked"), bukan JS challenge.
 *
 * Satu-satunya cara yang tembus tanpa layanan pihak ketiga: pakai browser asli.
 * Kita jalankan Google Chrome yang sudah terpasang lewat playwright-core
 * (channel: 'chrome' — tidak ada unduhan Chromium ~300 MB), buka `${BASE}/id`
 * sekali supaya Cloudflare menandai sesi, lalu tembak endpoint JSON dari dalam
 * halaman itu (same-origin, cookie + fingerprint browser ikut otomatis).
 *
 * Kalau suatu saat ini pun diblokir, lihat CLAUDE.md bagian "Kalau WAF menggigit".
 * Set IDX_HEADFUL=1 untuk menjalankan Chrome dengan jendela terlihat (kadang
 * lolos saat mode headless kena challenge).
 */
export class IdxClient {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private sessionReady = false

  constructor(private readonly opts: { useCache?: boolean } = {}) {}

  private async ensureSession(): Promise<void> {
    if (this.sessionReady) return

    let chromium: typeof import('playwright-core').chromium
    try {
      ;({ chromium } = await import('playwright-core'))
    } catch {
      throw new Error(
        "playwright-core tidak terpasang. Jalankan `bun add playwright-core`.",
      )
    }

    try {
      this.browser = await chromium.launch({
        channel: 'chrome',
        headless: process.env.IDX_HEADFUL !== '1',
      })
    } catch (err) {
      throw new Error(
        'Gagal meluncurkan Google Chrome (channel: "chrome"). Pastikan Google Chrome ' +
          `terpasang di path standar. Detail: ${String(err)}`,
      )
    }

    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
      viewport: { width: 1366, height: 900 },
    })
    this.page = await this.context.newPage()

    await this.warmUp()
    this.sessionReady = true
  }

  /** Buka halaman utama IDX dan tunggu Cloudflare selesai (kalau ada challenge). */
  private async warmUp(): Promise<void> {
    const page = this.page
    if (!page) throw new Error('page belum siap')

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await page.goto(`${BASE}/id`, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        })
        const status = res?.status() ?? 0

        // Cloudflare interstitial ("Just a moment...") menyelesaikan sendiri;
        // beri waktu lalu cek lagi.
        if (status === 403 || (await this.looksLikeChallenge())) {
          await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
          await sleep(2_000)
        }

        if (!(await this.looksLikeChallenge())) return
      } catch (err) {
        if (attempt === 3) throw err
        console.warn(`[idx] warm-up gagal (${attempt}/3): ${String(err)}`)
      }
      await sleep(1_000 * attempt)
    }

    throw new Error(
      `Cloudflare masih menahan ${BASE}/id setelah 3 percobaan. Coba lagi dengan ` +
        'IDX_HEADFUL=1, atau lihat CLAUDE.md "Kalau WAF menggigit".',
    )
  }

  private async looksLikeChallenge(): Promise<boolean> {
    const page = this.page
    if (!page) return true
    const title = (await page.title().catch(() => '')) || ''
    if (/just a moment|attention required|you have been blocked/i.test(title)) return true
    const bodyText = await page
      .evaluate(() => document.body?.innerText?.slice(0, 400) ?? '')
      .catch(() => '')
    return /you have been blocked|enable cookies and reload|cf-error-details/i.test(bodyText)
  }

  private async getJson<T>(url: string): Promise<T> {
    await this.ensureSession()
    const page = this.page
    if (!page) throw new Error('page belum siap')

    let lastSnippet = ''
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { status, body } = await page.evaluate(async (u: string) => {
        try {
          const r = await fetch(u, {
            headers: {
              Accept: 'application/json, text/plain, */*',
              'X-Requested-With': 'XMLHttpRequest',
            },
            credentials: 'include',
          })
          return { status: r.status, body: await r.text() }
        } catch (e) {
          return { status: 0, body: `fetch error: ${String(e)}` }
        }
      }, url)

      const trimmed = body.trimStart()
      if (status === 200 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        return JSON.parse(body) as T
      }

      lastSnippet = trimmed.slice(0, 160)
      if (attempt < 4) {
        const delay = Math.min(1_000 * 2 ** (attempt - 1), 15_000)
        console.warn(
          `[idx] respons tak terpakai dari ${url} (HTTP ${status}), retry ${delay / 1_000}s`,
        )
        await sleep(delay)
        // Segarkan sesi kalau kena WAF lagi.
        if (status === 403 || status === 429 || status === 0) {
          await this.warmUp().catch(() => {})
        }
      }
    }

    throw new Error(
      `Respons bukan JSON dari ${url} (kemungkinan besar kena WAF). ` +
        `Potongan awal: ${lastSnippet}`,
    )
  }

  /** Tutup browser. Aman dipanggil berkali-kali. */
  async close(): Promise<void> {
    this.sessionReady = false
    this.page = null
    try {
      await this.context?.close()
    } catch {}
    try {
      await this.browser?.close()
    } catch {}
    this.context = null
    this.browser = null
  }

  /**
   * Ringkasan saham harian. `date` format YYYYMMDD.
   * Mengembalikan array kosong kalau tanggal tersebut bukan hari bursa.
   */
  async getStockSummary(date: string): Promise<RawStockSummary[]> {
    const cachePath = join(CACHE_DIR, `stock-summary-${date}.json`)

    if (this.opts.useCache !== false) {
      const cached = Bun.file(cachePath)
      if (await cached.exists()) {
        return (await cached.json()) as RawStockSummary[]
      }
    }

    const url = `${BASE}/primary/TradingSummary/GetStockSummary?length=9999&start=0&date=${date}`
    const payload = await this.getJson<StockSummaryResponse>(url)
    const rows = Array.isArray(payload?.data) ? payload.data : []

    if (rows.length > 0) {
      await mkdir(CACHE_DIR, { recursive: true })
      await Bun.write(cachePath, JSON.stringify(rows))
    }
    return rows
  }

  /** Daftar indeks beserta nilai terkini. Dipakai untuk mengambil level IHSG (COMPOSITE). */
  async getIndexList(): Promise<RawIndexListItem[]> {
    const payload = await this.getJson<RawIndexListItem[]>(`${BASE}/primary/home/GetIndexList`)
    return Array.isArray(payload) ? payload : []
  }

  /**
   * Ringkasan seluruh indeks pada satu tanggal — 45 indeks (IHSG + 11 sektor + lainnya)
   * dalam SATU panggilan, lengkap dengan OHLC, Volume, dan Value.
   *
   * Hari non-bursa mengembalikan array kosong; itu dipakai `getIndexBars` untuk mundur
   * ke hari bursa sebelumnya tanpa perlu kalender libur.
   */
  async getIndexSummary(date: string): Promise<RawIndexSummary[]> {
    const cached = await this.readCachedIndexSummary(date)
    if (cached) return cached

    const cachePath = join(CACHE_DIR, `index-summary-${date}.json`)
    const url = `${BASE}/primary/TradingSummary/GetIndexSummary?length=100&start=0&date=${date}`
    const payload = await this.getJson<{ data?: RawIndexSummary[] }>(url)
    const rows = Array.isArray(payload?.data) ? payload.data : []

    if (rows.length > 0) {
      await mkdir(CACHE_DIR, { recursive: true })
      await Bun.write(cachePath, JSON.stringify(rows))
    }
    return rows
  }

  private async readCachedIndexSummary(date: string): Promise<RawIndexSummary[] | null> {
    if (this.opts.useCache === false) return null
    const cached = Bun.file(join(CACHE_DIR, `index-summary-${date}.json`))
    return (await cached.exists()) ? ((await cached.json()) as RawIndexSummary[]) : null
  }

  /**
   * Bar harian per indeks untuk `days` hari bursa terakhir sampai `endDate`.
   * Satu permintaan per tanggal mencakup semua indeks, jadi 60 hari = 60 permintaan.
   * Lambat sekali di jalan pertama, instan sesudahnya karena tiap tanggal di-cache.
   *
   * Dua hal yang dipelajari dari kena HTTP 429 pada percobaan 60 hari pertama:
   *
   * 1. Permintaan berurutan tanpa jeda memicu rate limit Cloudflare sekitar permintaan
   *    ke-35. Karena itu ada jeda + jitter ANTAR PERMINTAAN JARINGAN (cache hit tidak
   *    kena jeda, jadi jalan kedua tetap instan).
   * 2. Satu tanggal yang gagal tidak boleh menjatuhkan seluruh laporan. Kalau sebuah
   *    tanggal gagal setelah semua retry, kumpulkan yang sudah ada dan berhenti —
   *    grafik 35 hari masih berguna, laporan tabelnya sudah tercetak.
   */
  async getIndexBars(endDate: string, days: number): Promise<Map<string, IndexBar[]>> {
    const out = new Map<string, IndexBar[]>()
    const cursor = new Date(
      `${endDate.slice(0, 4)}-${endDate.slice(4, 6)}-${endDate.slice(6, 8)}T12:00:00+07:00`,
    )

    let collected = 0
    let fetched = 0
    // Batas mundur: akhir pekan dan libur bursa berarti hari kalender > hari bursa.
    for (let i = 0; i < days * 2 + 15 && collected < days; i++) {
      const date = toIdxDate(cursor)
      const weekend = isWeekendJakarta(cursor)
      cursor.setDate(cursor.getDate() - 1)

      // Bursa tutup Sabtu/Minggu — melewatinya membuang ~40% permintaan yang pasti
      // kosong, sekaligus menjauhkan diri dari rate limit.
      if (weekend) continue

      let rows = await this.readCachedIndexSummary(date)
      if (!rows) {
        // Jeda hanya untuk permintaan jaringan sungguhan, bukan cache hit.
        if (fetched > 0) await sleep(600 + Math.random() * 800)
        try {
          rows = await this.getIndexSummary(date)
        } catch (err) {
          console.warn(
            `[idx] berhenti mengumpulkan bar di ${date} setelah ${collected} hari: ${String(err)}`,
          )
          break
        }
        fetched++
      }
      if (rows.length === 0) continue

      for (const r of rows) {
        const bar: IndexBar = {
          date,
          indexCode: r.IndexCode,
          previous: r.Previous,
          high: r.Highest,
          low: r.Lowest,
          close: r.Close,
          volume: r.Volume,
          value: r.Value,
        }
        const list = out.get(r.IndexCode)
        if (list) list.push(bar)
        else out.set(r.IndexCode, [bar])
      }
      collected++
    }

    // Dikumpulkan mundur; balik supaya urut kronologis.
    for (const list of out.values()) list.reverse()
    return out
  }

  /**
   * Klasifikasi sektor per emiten. Di-cache tanpa penanggalan karena klasifikasi jarang
   * berubah; `--no-cache` menyegarkan.
   */
  async getCompanyProfiles(): Promise<RawCompanyProfile[]> {
    const cachePath = join(CACHE_DIR, 'company-profiles.json')

    if (this.opts.useCache !== false) {
      const cached = Bun.file(cachePath)
      if (await cached.exists()) {
        return (await cached.json()) as RawCompanyProfile[]
      }
    }

    const url =
      `${BASE}/primary/ListedCompany/GetCompanyProfiles` +
      '?start=0&length=9999&code=&sector=&board=&language=en-us'
    const payload = await this.getJson<{ data?: RawCompanyProfile[] }>(url)
    const rows = Array.isArray(payload?.data) ? payload.data : []

    if (rows.length > 0) {
      await mkdir(CACHE_DIR, { recursive: true })
      await Bun.write(cachePath, JSON.stringify(rows))
    }
    return rows
  }
}

/** `RawCompanyProfile[]` -> peta kode emiten ke sektor, siap dipakai computeContributions. */
export function toSectorMap(profiles: RawCompanyProfile[]): Map<string, SectorInfo> {
  return new Map(
    profiles
      .filter((p) => p.KodeEmiten && p.Sektor)
      .map((p) => [p.KodeEmiten, { sector: p.Sektor, subSector: p.SubSektor || p.Sektor }]),
  )
}

/**
 * Mundur ke hari bursa terakhir yang punya data, maksimal `maxBack` hari kalender.
 *
 * Dua hal yang membuat ini tidak sesederhana "ambil, kalau kosong mundur":
 *
 * 1. **Hari non-bursa tidak selalu membalas 200 dengan data kosong.** Untuk tanggal
 *    akhir pekan, `GetStockSummary` bisa membalas **HTTP 503** dari Varnish. Dulu itu
 *    melempar dan mematikan seluruh laporan padahal cukup mundur sehari. Sekarang
 *    kegagalan per tanggal ditelan dan pencarian lanjut; baru menyerah kalau semua
 *    kandidat gagal — jadi IDX yang benar-benar tumbang tetap menghasilkan pesan jelas.
 * 2. **Akhir pekan dilewati tanpa permintaan.** Bursa tidak pernah buka Sabtu/Minggu,
 *    dan `GetStockSummary` itu ~650 KB per panggilan. Melewatinya menghemat dua
 *    permintaan berat yang pasti sia-sia setiap kali dijalankan di akhir pekan.
 *
 * Libur bursa tetap butuh permintaan — tidak ada kalender liburnya di sini, dan
 * respons kosong/gagal sudah cukup sebagai penanda.
 */
export async function resolveTradingDate(
  client: IdxClient,
  start: Date,
  maxBack = 10,
): Promise<{ date: string; rows: RawStockSummary[] }> {
  const cursor = new Date(start)
  const tried: string[] = []

  for (let i = 0; i < maxBack; i++) {
    const date = toIdxDate(cursor)
    const weekend = isWeekendJakarta(cursor)
    cursor.setDate(cursor.getDate() - 1)

    if (weekend) continue

    try {
      const rows = await client.getStockSummary(date)
      if (rows.length > 0) return { date, rows }
      tried.push(`${date}: kosong`)
    } catch (err) {
      tried.push(`${date}: ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`)
      console.warn(`[idx] ${date} tidak terpakai, mundur sehari`)
      await sleep(500)
    }
  }

  throw new Error(
    `Tidak menemukan data bursa dalam ${maxBack} hari terakhir dari ${toIdxDate(start)}.\n` +
      tried.map((t) => `  - ${t}`).join('\n'),
  )
}

const JKT_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', weekday: 'short' })

/** True kalau tanggal itu Sabtu/Minggu menurut waktu Jakarta. Bursa tutup. */
export function isWeekendJakarta(d: Date): boolean {
  const day = JKT_WEEKDAY.format(d)
  return day === 'Sat' || day === 'Sun'
}

/** Date -> "YYYYMMDD" memakai waktu Asia/Jakarta. */
export function toIdxDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return parts.replaceAll('-', '')
}
