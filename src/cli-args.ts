import { IDX, marketById, type Market } from './market.ts'
export interface Args {
  /** Kode emiten dari argumen posisional. Kosong berarti pakai watchlist. */
  codes: string[]
  /** Panjang jendela tampil dalam bar. */
  days: number
  /** Jumlah baris profil volume. */
  rows: number
  outDir: string
  watchlist: string
  /** Simpan juga SVG-nya, berguna untuk memeriksa tata letak. */
  keepSvg: boolean
  /** Pasar yang digambar. Menentukan bawaan watchlist dan direktori keluaran. */
  market: Market
}

export function defaultsFor(market: Market): Args {
  return {
    codes: [],
    days: 250,
    rows: 24,
    outDir: market.outDir,
    watchlist: market.watchlist,
    keepSvg: false,
    market,
  }
}

export const DEFAULTS: Args = defaultsFor(IDX)

/**
 * Satu kode emiten per baris. `#` memulai komentar, di awal baris maupun di ujungnya.
 * Duplikat dibuang supaya emiten yang tidak sengaja ditulis dua kali tidak diunduh
 * dan digambar dua kali.
 */
export function parseWatchlist(text: string): string[] {
  const seen = new Set<string>()
  const codes: string[] = []
  for (const line of text.split('\n')) {
    const code = line.split('#')[0]!.trim().toUpperCase()
    if (!code || seen.has(code)) continue
    seen.add(code)
    codes.push(code)
  }
  return codes
}

export function parseArgs(argv: string[]): Args {
  const market = findMarket(argv)
  const args: Args = { ...defaultsFor(market), codes: [] }

  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Opsi ${flag} butuh nilai.`)
    }
    return next
  }

  const positive = (flag: string, raw: string): number => {
    const n = Number(raw)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(`Opsi ${flag} butuh bilangan bulat positif, dapat "${raw}".`)
    }
    return n
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--days':
        args.days = positive('--days', value('--days', argv[++i]))
        break
      case '--rows':
        args.rows = positive('--rows', value('--rows', argv[++i]))
        break
      case '--out':
        args.outDir = value('--out', argv[++i])
        break
      case '--watchlist':
        args.watchlist = value('--watchlist', argv[++i])
        break
      case '--svg':
        args.keepSvg = true
        break
      case '--market':
        // Sudah dibaca findMarket(); di sini hanya nilainya yang dilewati.
        i++
        break
      default:
        // Opsi tak dikenal harus berisik. Kalau diam-diam diperlakukan sebagai kode
        // emiten, salah ketik `--dyas 120` berubah jadi permintaan emiten "--DYAS"
        // yang gagal di Yahoo dengan pesan yang membingungkan.
        if (arg.startsWith('-')) throw new Error(`Opsi tidak dikenal: ${arg}`)
        args.codes.push(arg.trim().toUpperCase())
    }
  }

  return args
}

export interface ScanArgs {
  codes: string[]
  days: number
  outDir: string
  /** Laporan CSV/Excel terpisah dari outDir supaya tidak tenggelam di antara PNG/JSON per emiten. */
  reportDir: string
  watchlist: string
  /** Ambang likuiditas dalam mata uang pasar (masukannya lihat `market.minValueUnit`). */
  minValue: number
  minRatio: number
  /** Lapisan pengaya IDX menyala. */
  useIdx: boolean
  /** Hari bursa riwayat aliran asing yang ditarik. */
  idxDays: number
  /** Pasar yang dipindai. Menentukan bawaan seluruh medan di atas. */
  market: Market
  /** Tulis halaman screener HTML di samping CSV/Excel. */
  html: boolean
  /**
   * Tandai halaman sebagai DRAFT intraday. null = tentukan sendiri dari jam bursa
   * (hanya IDX: hari kerja, bar hari ini, sebelum 16:15 WIB).
   */
  draft: boolean | null
}

/** Bawaan yang diturunkan dari pasar — bukan angka lepas yang harus dijaga selaras. */
export function scanDefaultsFor(market: Market): ScanArgs {
  return {
    codes: [],
    days: 250,
    outDir: market.outDir,
    reportDir: market.reportDir,
    watchlist: market.watchlist,
    minValue: market.minValue,
    minRatio: 2,
    useIdx: market.hasIdxLayer,
    idxDays: 60,
    market,
    html: true,
    draft: null,
  }
}

export const SCAN_DEFAULTS: ScanArgs = scanDefaultsFor(IDX)

/**
 * Pasar dibaca lebih dulu, sebelum flag lain diproses.
 *
 * Seluruh bawaan lain diturunkan darinya, jadi posisi `--market` di baris
 * perintah tidak boleh berpengaruh — `--watchlist x --market crypto` harus sama
 * artinya dengan urutan sebaliknya.
 */
function findMarket(argv: string[]): Market {
  const i = argv.indexOf('--market')
  if (i === -1) return IDX
  const raw = argv[i + 1]
  if (raw === undefined || raw.startsWith('--')) throw new Error('Opsi --market butuh nilai.')
  return marketById(raw)
}

export function parseScanArgs(argv: string[]): ScanArgs {
  const market = findMarket(argv)
  const args: ScanArgs = { ...scanDefaultsFor(market), codes: [] }

  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('--')) throw new Error(`Opsi ${flag} butuh nilai.`)
    return next
  }
  const positiveInt = (flag: string, raw: string): number => {
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Opsi ${flag} butuh bilangan bulat positif, dapat "${raw}".`)
    }
    return n
  }
  const positive = (flag: string, raw: string): number => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Opsi ${flag} butuh angka positif, dapat "${raw}".`)
    }
    return n
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--days':
        args.days = positiveInt('--days', value('--days', argv[++i]))
        break
      case '--out':
        args.outDir = value('--out', argv[++i])
        break
      case '--report-dir':
        args.reportDir = value('--report-dir', argv[++i])
        break
      case '--market':
        // Sudah dibaca findMarket(); di sini hanya nilainya yang dilewati.
        i++
        break
      case '--watchlist':
        args.watchlist = value('--watchlist', argv[++i])
        break
      case '--min-likuiditas':
        // Satuan masukannya ikut pasar: miliar rupiah untuk IDX, juta dolar untuk
        // crypto — satuan yang wajar diucapkan di masing-masing. Disimpan dalam
        // mata uang penuh supaya tidak ada konversi tersembunyi di hilir.
        args.minValue =
          positive('--min-likuiditas', value('--min-likuiditas', argv[++i])) * market.minValueScale
        break
      case '--min-rr':
        args.minRatio = positive('--min-rr', value('--min-rr', argv[++i]))
        break
      case '--hari-idx':
        args.idxDays = positiveInt('--hari-idx', value('--hari-idx', argv[++i]))
        break
      case '--tanpa-idx':
        args.useIdx = false
        break
      case '--tanpa-html':
        args.html = false
        break
      case '--draft':
        args.draft = true
        break
      case '--final':
        args.draft = false
        break
      default:
        if (arg.startsWith('-')) throw new Error(`Opsi tidak dikenal: ${arg}`)
        args.codes.push(arg.trim().toUpperCase())
    }
  }

  return args
}
