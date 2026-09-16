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
}

export const DEFAULTS: Args = {
  codes: [],
  days: 250,
  rows: 24,
  outDir: 'out',
  watchlist: 'watchlist.txt',
  keepSvg: false,
}

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
  const args: Args = { ...DEFAULTS, codes: [] }

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
  watchlist: string
  /** Ambang likuiditas dalam RUPIAH (masukannya miliar). */
  minValue: number
  minRatio: number
  /** Lapisan pengaya IDX menyala. */
  useIdx: boolean
  /** Hari bursa riwayat aliran asing yang ditarik. */
  idxDays: number
}

export const SCAN_DEFAULTS: ScanArgs = {
  codes: [],
  days: 250,
  outDir: 'out',
  watchlist: 'watchlist.txt',
  minValue: 5e9,
  minRatio: 2,
  useIdx: true,
  idxDays: 60,
}

export function parseScanArgs(argv: string[]): ScanArgs {
  const args: ScanArgs = { ...SCAN_DEFAULTS, codes: [] }

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
      case '--watchlist':
        args.watchlist = value('--watchlist', argv[++i])
        break
      case '--min-likuiditas':
        // Dimasukkan dalam miliar karena itu satuan yang dipakai saat bicara
        // likuiditas IDX; disimpan dalam rupiah supaya tidak ada konversi tersembunyi.
        args.minValue = positive('--min-likuiditas', value('--min-likuiditas', argv[++i])) * 1e9
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
      default:
        if (arg.startsWith('-')) throw new Error(`Opsi tidak dikenal: ${arg}`)
        args.codes.push(arg.trim().toUpperCase())
    }
  }

  return args
}
