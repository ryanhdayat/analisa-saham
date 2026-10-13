import { expect, test, describe } from 'bun:test'
import {
  filterUniverse,
  parseUniverseArgs,
  formatWatchlist,
  isStablecoin,
  parseScreenerPage,
  type UniverseRow,
} from './crypto-universe.ts'
import { parseWatchlist } from './cli-args.ts'

/** Bentuk balasan screener Yahoo, dipangkas seperlunya. */
function page(quotes: Array<Record<string, unknown>>) {
  return { finance: { result: [{ total: 8224, count: quotes.length, quotes }], error: null } }
}

const quote = (symbol: string, volume: number, price = 100, over: Record<string, unknown> = {}) => ({
  symbol,
  shortName: `${symbol.replace('-USD', '')} USD`,
  regularMarketVolume: volume,
  regularMarketPrice: price,
  marketCap: volume * 10,
  ...over,
})

const row = (symbol: string, volume: number, price = 100): UniverseRow => ({
  symbol,
  name: symbol,
  volume,
  price,
  marketCap: null,
})

describe('parseScreenerPage', () => {
  test('mengambil simbol, nama, volume, dan harga', () => {
    const [r] = parseScreenerPage(page([quote('BTC-USD', 36e9, 83410)]))
    expect(r!.symbol).toBe('BTC-USD')
    expect(r!.name).toBe('BTC USD')
    expect(r!.volume).toBe(36e9)
    expect(r!.price).toBe(83410)
  })

  test('balasan tanpa quotes menghasilkan daftar kosong, bukan melempar', () => {
    expect(parseScreenerPage(page([]))).toEqual([])
    expect(parseScreenerPage({ finance: { result: [] } })).toEqual([])
    expect(parseScreenerPage({})).toEqual([])
  })

  test('baris tanpa simbol dibuang', () => {
    const out = parseScreenerPage(page([{ shortName: 'tanpa simbol' }, quote('ETH-USD', 1e9)]))
    expect(out.map((r) => r.symbol)).toEqual(['ETH-USD'])
  })

  test('volume yang hilang dihitung nol, bukan dianggap tak terhingga', () => {
    // Nol membuatnya tersaring oleh ambang; undefined bisa lolos diam-diam.
    const [r] = parseScreenerPage(page([quote('X-USD', 0, 1, { regularMarketVolume: undefined })]))
    expect(r!.volume).toBe(0)
  })
})

describe('isStablecoin', () => {
  test('peg dolar yang sudah dikenal dibuang berdasarkan simbolnya', () => {
    expect(isStablecoin(row('USDT-USD', 1e11, 1.0))).toBe(true)
    expect(isStablecoin(row('USDC-USD', 1e10, 1.0))).toBe(true)
    expect(isStablecoin(row('DAI-USD', 1e8, 1.0))).toBe(true)
  })

  test('peg yang belum dikenal tertangkap dari harganya', () => {
    expect(isStablecoin(row('ZZZUSD-USD', 1e7, 1.002))).toBe(true)
    expect(isStablecoin(row('ZZZUSD-USD', 1e7, 0.997))).toBe(true)
  })

  test('pita harganya sempit supaya koin sungguhan tidak ikut terbuang', () => {
    // 0,99 itu 1% dari satu dolar — di luar pita, jadi tetap dipindai.
    expect(isStablecoin(row('REAL-USD', 1e7, 0.99))).toBe(false)
    expect(isStablecoin(row('BTC-USD', 36e9, 83410))).toBe(false)
  })

  test('tanpa harga, hanya daftar simbol yang menentukan', () => {
    expect(isStablecoin({ ...row('AAA-USD', 1e7), price: null })).toBe(false)
  })
})

describe('filterUniverse', () => {
  const rows = [
    row('BTC-USD', 36e9, 83410),
    row('USDT-USD', 100e9, 1.0),
    row('ETH-USD', 15e9, 2686),
    row('TINY-USD', 500_000, 0.4),
    row('SOL-USD', 4e9, 118),
  ]

  test('membuang yang di bawah ambang volume', () => {
    const out = filterUniverse(rows, { minVolume: 1e9 })
    expect(out.map((r) => r.symbol)).not.toContain('TINY-USD')
  })

  test('stablecoin dibuang secara bawaan', () => {
    expect(filterUniverse(rows, { minVolume: 1e6 }).map((r) => r.symbol)).not.toContain('USDT-USD')
  })

  test('stablecoin bisa dipertahankan kalau diminta', () => {
    const out = filterUniverse(rows, { minVolume: 1e6, keepStable: true })
    expect(out.map((r) => r.symbol)).toContain('USDT-USD')
  })

  test('diurutkan dari volume terbesar', () => {
    // TINY-USD (500 rb) ada di bawah ambang, jadi tersaring sebelum diurutkan.
    expect(filterUniverse(rows, { minVolume: 1e6 }).map((r) => r.symbol)).toEqual([
      'BTC-USD',
      'ETH-USD',
      'SOL-USD',
    ])
    // Dengan ambang nol, urutannya terlihat utuh.
    expect(filterUniverse(rows, { minVolume: 0 }).map((r) => r.symbol)).toEqual([
      'BTC-USD',
      'ETH-USD',
      'SOL-USD',
      'TINY-USD',
    ])
  })

  test('duplikat dibuang, yang pertama dipertahankan', () => {
    const out = filterUniverse([row('BTC-USD', 36e9), row('BTC-USD', 36e9)], { minVolume: 0 })
    expect(out).toHaveLength(1)
  })

  test('pasangan non-USD tidak diikutkan', () => {
    // Deskriptor crypto tidak menambah sufiks apa pun; simbol harus sudah lengkap.
    const out = filterUniverse([row('BTC-EUR', 9e9), row('BTC-USD', 36e9)], { minVolume: 0 })
    expect(out.map((r) => r.symbol)).toEqual(['BTC-USD'])
  })

  test('batas jumlah diterapkan setelah pengurutan, jadi yang tersisa yang terlikuid', () => {
    const out = filterUniverse(rows, { minVolume: 0, max: 2 })
    expect(out.map((r) => r.symbol)).toEqual(['BTC-USD', 'ETH-USD'])
  })
})

describe('formatWatchlist', () => {
  const meta = { generatedAt: '2026-10-01', minVolume: 1e6 }
  const out = formatWatchlist([row('BTC-USD', 36e9), row('ETH-USD', 15e9)], meta)

  test('satu simbol per baris', () => {
    expect(out).toContain('BTC-USD\n')
    expect(out).toContain('ETH-USD')
  })

  test('mencatat kapan dibuat dan ambang apa yang dipakai', () => {
    expect(out).toContain('2026-10-01')
    expect(out).toContain('$1')
  })

  test('membawa serta perintah scan yang cocok dengan ambangnya', () => {
    // Ambang $1 juta tidak lolos gerbang bawaan $10 juta; petunjuknya harus ikut
    // di berkasnya, bukan cuma hidup di percakapan.
    expect(out).toContain('--min-likuiditas 1')
  })

  test('bisa dibaca kembali oleh parser watchlist yang sudah ada', () => {
    // Ini yang benar-benar penting: berkasnya harus bisa dipakai scanner.
    expect(parseWatchlist(out)).toEqual(['BTC-USD', 'ETH-USD'])
  })

  test('daftar kosong tetap menghasilkan berkas yang sah', () => {
    expect(parseWatchlist(formatWatchlist([], meta))).toEqual([])
  })
})

describe('parseUniverseArgs', () => {
  test('bawaannya ambang 1 juta USD ke berkas watchlist crypto', () => {
    const a = parseUniverseArgs([])
    expect(a.minVolume).toBe(1e6)
    expect(a.out).toBe('crypto-watchlist.txt')
    expect(a.keepStable).toBe(false)
    expect(a.dryRun).toBe(false)
    expect(a.max).toBeUndefined()
  })

  test('--min-volume dibaca dalam juta USD, satuan yang sama dengan --min-likuiditas', () => {
    expect(parseUniverseArgs(['--min-volume', '10']).minVolume).toBe(10e6)
    expect(parseUniverseArgs(['--min-volume', '0.5']).minVolume).toBe(0.5e6)
  })

  test('--out, --max, --dengan-stabil, --dry-run', () => {
    const a = parseUniverseArgs(['--out', 'coba.txt', '--max', '50', '--dengan-stabil', '--dry-run'])
    expect(a.out).toBe('coba.txt')
    expect(a.max).toBe(50)
    expect(a.keepStable).toBe(true)
    expect(a.dryRun).toBe(true)
  })

  test('nilai tidak masuk akal ditolak', () => {
    expect(() => parseUniverseArgs(['--min-volume', '0'])).toThrow(/--min-volume/)
    expect(() => parseUniverseArgs(['--min-volume', '-1'])).toThrow(/--min-volume/)
    expect(() => parseUniverseArgs(['--min-volume'])).toThrow(/butuh nilai/)
  })

  test('opsi tak dikenal ditolak, bukan diabaikan diam-diam', () => {
    expect(() => parseUniverseArgs(['--ngawur'])).toThrow(/--ngawur/)
  })
})
