import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Bar } from './types.ts'

import { IDX, SHARES_PER_LOT, type Market } from './market.ts'

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart'

/**
 * Yahoo menolak permintaan tanpa user-agent browser. Nilainya tidak penting selama
 * bukan default fetch.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

/** IDX memperdagangkan 100 lembar per lot. */

export interface ChartData {
  /** Nama panjang emiten untuk legenda, mis. "Bank Central Asia Tbk.". */
  name: string
  symbol: string
  bars: Bar[]
}

/**
 * Yahoo mengirim volume dalam LEMBAR; TradingView menampilkannya dalam LOT.
 * Tanpa konversi ini angka di panel volume meleset 100x dari yang dilihat di
 * TradingView — sudah diverifikasi pada BBCA 2026-09-16 (72.157.400 lembar
 * tampil sebagai "721.57K" di sana).
 */
export function toLots(shares: number): number {
  return Math.round(shares / SHARES_PER_LOT)
}

/**
 * Kode watchlist → simbol Yahoo, menurut aturan pasarnya.
 *
 * Aturannya tinggal di deskriptor pasar (`market.ts`), bukan di sini: `BBCA` →
 * `BBCA.JK` untuk IDX, sementara `BTC-USD` dibiarkan utuh untuk crypto.
 *
 * Pasar bawaannya IDX supaya pemanggil yang sudah ada tidak berubah artinya.
 */
export function toSymbol(code: string, market: Market = IDX): string {
  return market.toSymbol(code)
}

/**
 * Ubah balasan `v8/finance/chart` jadi deret bar yang rapat.
 *
 * Murni, supaya bisa dites tanpa jaringan. Bar dengan medan null DIBUANG, bukan
 * dinolkan: hari tanpa perdagangan (suspensi, atau libur yang tetap masuk deret
 * waktu Yahoo) akan jadi candle palsu di harga nol kalau dipaksa digambar, dan
 * itu merusak skala sumbu harga. Dari 249 bar setahun BBCA, 5 di antaranya null.
 */
export function parseChartResponse(json: unknown): ChartData {
  const chart = (json as any)?.chart
  if (chart?.error) {
    const message = chart.error.description ?? chart.error.code ?? 'kesalahan tidak dikenal'
    throw new Error(`Yahoo menolak permintaan: ${message}`)
  }

  const result = chart?.result?.[0]
  if (!result) throw new Error('Balasan Yahoo tidak berisi hasil apa pun.')

  const symbol: string = result.meta?.symbol ?? 'TIDAK DIKENAL'
  const name: string = result.meta?.longName ?? result.meta?.shortName ?? symbol
  const zone: string = result.meta?.exchangeTimezoneName ?? 'Asia/Jakarta'
  const timestamps: number[] = result.timestamp ?? []
  const q = result.indicators?.quote?.[0] ?? {}

  const bars: Bar[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const open = q.open?.[i]
    const high = q.high?.[i]
    const low = q.low?.[i]
    const close = q.close?.[i]
    const volume = q.volume?.[i]
    const stamp = timestamps[i]
    if (
      stamp == null ||
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      volume == null
    ) {
      continue
    }
    bars.push({ date: exchangeDate(stamp, zone), open, high, low, close, volume })
  }

  if (bars.length === 0) {
    throw new Error(`Tidak ada bar yang sah untuk ${symbol}.`)
  }

  return { name, symbol, bars }
}

/**
 * Timestamp Yahoo adalah detik epoch pembukaan sesi. Diformat di zona bursa, bukan
 * zona mesin — kalau tidak, menjalankan ini dari luar WIB bisa menggeser tanggal
 * satu hari.
 */
function exchangeDate(epochSeconds: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSeconds * 1000))
  return parts
}

export interface FetchOptions {
  /** Rentang riwayat Yahoo, mis. `2y`. */
  range: string
  /** Direktori cache balasan mentah. Kosongkan untuk tidak menyimpan. */
  rawDir?: string
  /** Pasar yang menentukan pemetaan simbol. Bawaannya IDX. */
  market?: Market
}

/** Ambil bar harian satu emiten, dan simpan balasan mentahnya untuk jejak audit. */
export async function fetchBars(code: string, options: FetchOptions): Promise<ChartData> {
  const symbol = toSymbol(code, options.market ?? IDX)
  const url = `${ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(options.range)}`

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  const text = await response.text()

  if (!response.ok) {
    // Yahoo tetap mengirim JSON berisi alasan pada 404; coba baca dulu sebelum menyerah.
    try {
      return parseChartResponse(JSON.parse(text))
    } catch {
      throw new Error(`Yahoo membalas HTTP ${response.status} untuk ${symbol}.`)
    }
  }

  if (options.rawDir) {
    await mkdir(options.rawDir, { recursive: true })
    await writeFile(join(options.rawDir, `${symbol}-${options.range}.json`), text)
  }

  return parseChartResponse(JSON.parse(text))
}
