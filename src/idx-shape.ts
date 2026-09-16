import type { RawStockSummary } from './idx-types.ts'
import type { ForeignDay } from './analysis/flow.ts'
import type { FreeFloatInput } from './analysis/liquidity.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** Zona bursa IDX. Semua "hari ini" di berkas ini diukur di sini. */
export const EXCHANGE_TZ = 'Asia/Jakarta'

function compact(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/**
 * Tanggal bursa hari ini, `YYYY-MM-DD`, dibaca di Asia/Jakarta.
 *
 * Bukan UTC dan bukan zona mesin. Menjalankan scan sesaat setelah tengah malam WIB
 * berarti UTC masih di tanggal kemarin: memakai UTC membuat tanggal bursa hari ini
 * tidak pernah dicoba, dan data kemarin terbaca berumur nol hari alias "segar".
 * Keduanya salah dengan cara yang senyap.
 */
export function exchangeToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EXCHANGE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Tengah malam UTC pada tanggal bursa `now`, supaya aritmetika hari bebas zona. */
function exchangeMidnight(now: Date): Date {
  return new Date(`${exchangeToday(now)}T00:00:00Z`)
}

export function toIsoDate(compactDate: string): string {
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`
}

/**
 * Tanggal yang layak dicoba, mundur dari `from`, melewati akhir pekan.
 *
 * Hari libur bursa tidak bisa diketahui dari kalender, tapi tidak perlu: IDX
 * membalas 0 baris untuk hari non-bursa, jadi tanggal kosong tinggal dilewati.
 * Melewati Sabtu–Minggu di sini semata untuk menghemat permintaan.
 */
export function candidateDates(from: Date, count: number): string[] {
  const dates: string[] = []
  const cursor = exchangeMidnight(from)
  while (dates.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(compact(cursor))
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return dates
}

/**
 * Deret aliran asing harian satu emiten, URUT MENAIK.
 *
 * Urutan penting: jendela 5/20/60 hari diambil dari ekor deret. Kalau urutannya
 * menurun, "20 hari terakhir" justru mengambil 20 hari TERTUA.
 */
export function buildForeignDays(
  byDate: Map<string, RawStockSummary[]>,
  code: string,
): ForeignDay[] {
  const days: ForeignDay[] = []
  for (const date of [...byDate.keys()].sort()) {
    const row = byDate.get(date)!.find((r) => r.StockCode === code)
    if (!row) continue
    days.push({
      date: toIsoDate(date),
      netShares: row.ForeignBuy - row.ForeignSell,
      close: row.Close,
    })
  }
  return days
}

/**
 * Free float dari hari terbaru yang memuat emiten ini.
 *
 * Memakai `WeightForIndex`, BUKAN `TradebleShares`. Diverifikasi terhadap
 * `stock-summary-20260916`: `TradebleShares` sama persis dengan `ListedShares`
 * di 908 dari 963 emiten, jadi rasionya selalu 100% dan tidak berarti apa-apa.
 * `WeightForIndex` adalah lembar yang dipakai IDX untuk membobot indeks — sudah
 * disesuaikan free float — dan menghasilkan angka yang masuk akal: BBCA 31,5%,
 * BBRI 42,3%, ASII 43,8%.
 */
export function buildFreeFloat(
  byDate: Map<string, RawStockSummary[]>,
  code: string,
): FreeFloatInput | undefined {
  for (const date of [...byDate.keys()].sort().reverse()) {
    const row = byDate.get(date)!.find((r) => r.StockCode === code)
    if (!row) continue
    return { freeFloatShares: row.WeightForIndex, listedShares: row.ListedShares }
  }
  return undefined
}

/**
 * Umur data terhadap hari ini. `undefined` kalau datanya hari ini — supaya sel
 * yang segar tidak dibubuhi label umur yang cuma jadi derau.
 */
export function stalenessFrom(
  newestIso: string,
  today: Date,
): { asOf: string; daysOld: number } | undefined {
  const newest = Date.parse(`${newestIso}T00:00:00Z`)
  const days = Math.round((exchangeMidnight(today).getTime() - newest) / 86400000)
  return days <= 0 ? undefined : { asOf: newestIso, daysOld: days }
}
