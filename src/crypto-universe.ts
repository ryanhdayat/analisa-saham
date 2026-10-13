import { copyFile, writeFile } from 'node:fs/promises'
import { CRYPTO } from './market.ts'

/**
 * Membangun daftar pantau crypto dari screener Yahoo.
 *
 * Dipisah seperti `yahoo.ts`: bagian yang menghitung itu MURNI dan bisa dites
 * tanpa jaringan, bagian yang mengambil data cuma pembungkus tipis di atasnya.
 */

const ENDPOINT =
  'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=all_cryptocurrencies_us'
const USER_AGENT = 'Mozilla/5.0'
const PAGE_SIZE = 250

export interface UniverseRow {
  symbol: string
  name: string
  /** Harga terakhir. Null kalau Yahoo tidak mengirimnya. */
  price: number | null
  /** Volume harian, SUDAH dalam USD — lihat catatan di `market.ts`. */
  volume: number
  marketCap: number | null
}

/** Satu halaman balasan screener → baris yang rapat. Murni. */
export function parseScreenerPage(json: unknown): UniverseRow[] {
  const quotes = (json as any)?.finance?.result?.[0]?.quotes
  if (!Array.isArray(quotes)) return []

  const rows: UniverseRow[] = []
  for (const q of quotes) {
    const symbol: unknown = q?.symbol
    if (typeof symbol !== 'string' || symbol.length === 0) continue
    rows.push({
      symbol,
      name: typeof q.shortName === 'string' ? q.shortName : symbol,
      price: typeof q.regularMarketPrice === 'number' ? q.regularMarketPrice : null,
      // Volume hilang dihitung NOL, bukan dibiarkan undefined: nol pasti tersaring
      // oleh ambang, sementara undefined bisa lolos diam-diam.
      volume: typeof q.regularMarketVolume === 'number' ? q.regularMarketVolume : 0,
      marketCap: typeof q.marketCap === 'number' ? q.marketCap : null,
    })
  }
  return rows
}

/** Peg dolar yang sudah dikenal, dibuang berdasarkan simbol. */
const PEG_DIKENAL = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDE', 'FDUSD', 'PYUSD',
  'USDD', 'FRAX', 'USDP', 'GUSD', 'LUSD', 'USDS', 'RLUSD', 'SUSD',
])

/** Separuh persen dari satu dolar. */
const PITA_PEG = 0.005

/**
 * Memindai stablecoin untuk tren, R:R, dan fase Wyckoff menghasilkan derau murni —
 * harganya memang dirancang tidak bergerak.
 *
 * Dua lapis: daftar simbol untuk yang sudah dikenal, lalu pita harga sempit untuk
 * peg yang belum masuk daftar. Pitanya sengaja SEMPIT — koin sungguhan yang
 * kebetulan berharga $0,99 harus tetap dipindai, dan satu baris derau jauh lebih
 * murah daripada satu koin nyata yang hilang diam-diam.
 */
export function isStablecoin(row: UniverseRow): boolean {
  const base = row.symbol.replace(/-USD$/, '').toUpperCase()
  if (PEG_DIKENAL.has(base)) return true
  if (row.price == null) return false
  return Math.abs(row.price - 1) <= PITA_PEG
}

export interface FilterOptions {
  /** Ambang volume harian dalam USD penuh. */
  minVolume?: number
  /** Pertahankan stablecoin. Bawaannya dibuang. */
  keepStable?: boolean
  /** Batas jumlah simbol, diterapkan SETELAH pengurutan. */
  max?: number
}

export function filterUniverse(rows: UniverseRow[], options: FilterOptions = {}): UniverseRow[] {
  const { minVolume = 0, keepStable = false, max } = options

  const seen = new Set<string>()
  const kept: UniverseRow[] = []
  for (const row of rows) {
    // Deskriptor crypto tidak menambah sufiks apa pun, jadi simbolnya harus sudah
    // lengkap dengan kuotasinya.
    if (!row.symbol.endsWith('-USD')) continue
    if (seen.has(row.symbol)) continue
    if (row.volume < minVolume) continue
    if (!keepStable && isStablecoin(row)) continue
    seen.add(row.symbol)
    kept.push(row)
  }

  kept.sort((a, b) => b.volume - a.volume)
  // Batasnya diterapkan setelah diurutkan supaya yang tersisa yang paling likuid,
  // bukan yang kebetulan lebih dulu dikirim Yahoo.
  return max == null ? kept : kept.slice(0, max)
}

export interface WatchlistMeta {
  generatedAt: string
  /** Ambang volume dalam USD penuh. */
  minVolume: number
}

const juta = (v: number): string => {
  const n = v / 1e6
  return Number.isInteger(n) ? `$${n} juta` : `$${n.toFixed(2)} juta`
}

/** Baris berkas daftar pantau, lengkap dengan asal-usulnya. Murni. */
export function formatWatchlist(rows: UniverseRow[], meta: WatchlistMeta): string {
  // Ambang scan ikut dicetak di berkasnya: daftar dengan ambang $1 juta TIDAK
  // lolos gerbang bawaan $10 juta, dan petunjuk itu harus ikut bersama daftarnya
  // — bukan hidup di percakapan yang sudah lewat.
  const minLikuiditas = meta.minVolume / CRYPTO.minValueScale
  return (
    [
      '# Daftar pantau crypto — DIBUAT OTOMATIS, suntingan tangan akan tertimpa.',
      `# Dibuat: ${meta.generatedAt} dari screener Yahoo (all_cryptocurrencies_us).`,
      `# Saringan: volume harian >= ${juta(meta.minVolume)}, stablecoin dibuang.`,
      `# Jumlah: ${rows.length} pasangan, diurutkan dari volume terbesar.`,
      '#',
      '# Perbarui: bun run src/crypto-universe.ts',
      `# Pindai  : bun run src/scan.ts --market crypto --min-likuiditas ${minLikuiditas}`,
      `#           (ambang bawaannya 10; pakai ${minLikuiditas} supaya cocok dengan daftar ini)`,
      '',
      ...rows.map((r) => r.symbol),
    ].join('\n') + '\n'
  )
}

export interface FetchOptions extends FilterOptions {
  /** Batas halaman yang ditarik. Pengaman, bukan saringan. */
  maxPages?: number
}

/** Menyusuri screener halaman demi halaman sampai Yahoo berhenti mengirim baris. */
export async function fetchUniverse(options: FetchOptions = {}): Promise<UniverseRow[]> {
  const { maxPages = 40 } = options
  const all: UniverseRow[] = []

  for (let page = 0; page < maxPages; page++) {
    const url = `${ENDPOINT}&count=${PAGE_SIZE}&start=${page * PAGE_SIZE}`
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!response.ok) {
      // Halaman gagal tidak membatalkan seluruhnya: yang sudah terkumpul tetap
      // berguna, dan berhenti lebih awal lebih jujur daripada diam-diam kurang.
      console.error(`[screener] halaman ${page} balas HTTP ${response.status}; berhenti di sini.`)
      break
    }
    const rows = parseScreenerPage(await response.json())
    if (rows.length === 0) break
    all.push(...rows)
    process.stderr.write(`\r[screener] ${all.length} baris...`)
  }
  process.stderr.write('\n')
  return all
}

const USAGE = `Pakai: bun run src/crypto-universe.ts [opsi]

  --min-volume JUTA   Ambang volume harian dalam juta USD (bawaan 1).
  --out BERKAS        Berkas keluaran (bawaan ${CRYPTO.watchlist}).
  --max N             Batas jumlah simbol (bawaan tanpa batas).
  --dengan-stabil     Ikutkan stablecoin (bawaan: dibuang).
  --dry-run           Cetak ringkasan, jangan tulis berkas.`

export interface UniverseArgs {
  minVolume: number
  out: string
  max?: number
  keepStable: boolean
  dryRun: boolean
}

export function parseUniverseArgs(argv: string[]): UniverseArgs {
  const args: UniverseArgs = {
    minVolume: 1 * CRYPTO.minValueScale,
    out: CRYPTO.watchlist,
    keepStable: false,
    dryRun: false,
  }
  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('--')) throw new Error(`Opsi ${flag} butuh nilai.`)
    return next
  }
  const positive = (flag: string, raw: string): number => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Opsi ${flag} butuh angka positif, dapat "${raw}".`)
    return n
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--min-volume':
        // Satuannya juta USD, sama dengan --min-likuiditas di pasar crypto.
        args.minVolume = positive('--min-volume', value('--min-volume', argv[++i])) * CRYPTO.minValueScale
        break
      case '--out':
        args.out = value('--out', argv[++i])
        break
      case '--max':
        args.max = positive('--max', value('--max', argv[++i]))
        break
      case '--dengan-stabil':
        args.keepStable = true
        break
      case '--dry-run':
        args.dryRun = true
        break
      default:
        throw new Error(`Opsi tidak dikenal: ${arg}`)
    }
  }
  return args
}

export async function main(argv: string[]): Promise<number> {
  let args: UniverseArgs
  try {
    args = parseUniverseArgs(argv)
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return 1
  }

  const raw = await fetchUniverse({ maxPages: 40 })
  if (raw.length === 0) {
    console.error('Screener tidak mengembalikan satu baris pun.')
    return 1
  }

  const rows = filterUniverse(raw, {
    minVolume: args.minVolume,
    keepStable: args.keepStable,
    max: args.max,
  })

  console.log(`Ditarik  : ${raw.length} baris mentah`)
  console.log(`Tersaring: ${rows.length} pasangan di atas ${juta(args.minVolume)} per hari`)
  if (rows.length > 0) {
    const n = Math.min(5, rows.length)
    console.log(`Teratas  : ${rows.slice(0, n).map((r) => r.symbol).join(', ')}`)
  }

  if (args.dryRun) {
    console.log('\n--dry-run: tidak ada berkas yang ditulis.')
    return 0
  }

  // Berkas lama disalin dulu. Daftar yang disusun tangan tidak boleh hilang hanya
  // karena perintah ini dijalankan sekali.
  try {
    await copyFile(args.out, `${args.out}.bak`)
    console.log(`Cadangan : ${args.out}.bak`)
  } catch {
    // Belum ada berkasnya — tidak ada yang perlu dicadangkan.
  }

  const text = formatWatchlist(rows, {
    generatedAt: new Date().toISOString().slice(0, 10),
    minVolume: args.minVolume,
  })
  await writeFile(args.out, text)
  console.log(`Ditulis  : ${args.out}`)
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
