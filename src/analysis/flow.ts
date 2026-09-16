import { metric, unavailable, type Metric } from './metric.ts'

export interface ForeignDay {
  date: string
  /** ForeignBuy - ForeignSell, satuan LEMBAR. */
  netShares: number
  /** Penutupan hari itu, untuk mengestimasi nilai rupiah. */
  close: number
}

export interface FlowRead {
  net5: number
  net20: number
  net60: number
  /** Estimasi rupiah — bukan angka terbitan IDX. */
  value5: number
  value20: number
  value60: number
  /** Bagian hari bernet positif dalam 20 hari, 0..1. */
  persistence20: number
  /** 0..1 untuk peringkat. */
  flowScore: number
}

const sumShares = (days: ForeignDay[], n: number) =>
  days.slice(-n).reduce((a, d) => a + d.netShares, 0)

const sumValue = (days: ForeignDay[], n: number) =>
  days.slice(-n).reduce((a, d) => a + d.netShares * d.close, 0)

/**
 * Aliran dana asing per emiten.
 *
 * **`ForeignBuy`/`ForeignSell` satuannya LEMBAR, bukan rupiah** — temuan yang sudah
 * diverifikasi di `01-app1` terhadap data 2026-09-11. Karena itu nilai rupiah di
 * sini hasil perkalian dengan penutupan harian, alias **estimasi**, dan wajib
 * dilabeli begitu di mana pun ia dicetak. Memperlakukannya sebagai angka resmi
 * IDX akan salah.
 *
 * Perlu dicatat juga apa yang metrik ini BUKAN: ini bukan bandarmology. Net beli
 * per broker tidak diterbitkan IDX, jadi "akumulasi konsisten oleh segelintir
 * broker" tidak bisa dilihat dari sini. Aliran asing hanya proksi parsial.
 */
export function analyzeFlow(
  days: ForeignDay[],
  staleness?: { asOf: string; daysOld: number },
): Metric<FlowRead> {
  if (days.length === 0) {
    return unavailable('Aliran asing tidak tersedia — butuh data IDX yang gagal diambil.')
  }

  const window20 = days.slice(-20)
  const positif = window20.filter((d) => d.netShares > 0).length
  const persistence20 = window20.length > 0 ? positif / window20.length : 0

  const net20 = sumShares(days, 20)
  const total20 = window20.reduce((a, d) => a + Math.abs(d.netShares), 0)
  // Arah bersih dinormalkan terhadap besaran aktivitasnya sendiri, supaya emiten
  // besar dan kecil bisa dibandingkan di kolom peringkat yang sama.
  const arah = total20 > 0 ? net20 / total20 : 0
  const flowScore = Math.min(1, Math.max(0, (arah + 1) / 2))

  const value20 = sumValue(days, 20)
  const miliar = (v: number) => `Rp ${(v / 1e9).toFixed(1)} M`

  const evidence = [
    `Net asing 5/20/60 hari: ${sumShares(days, 5).toLocaleString('id-ID')} / ${net20.toLocaleString('id-ID')} / ${sumShares(days, 60).toLocaleString('id-ID')} LEMBAR.`,
    `Estimasi nilai 20 hari ${miliar(value20)} — hasil perkalian lembar × close, bukan angka resmi IDX.`,
    `${positif} dari ${window20.length} hari terakhir bernet beli (persistensi ${(persistence20 * 100).toFixed(0)}%).`,
    'Bukan bandarmology: net beli per broker tidak diterbitkan IDX.',
  ]

  const arahKata = net20 > 0 ? 'akumulasi' : net20 < 0 ? 'distribusi' : 'datar'
  const umur = staleness ? ` (data per ${staleness.asOf}, ${staleness.daysOld} hari lalu)` : ''

  const result = metric(
    {
      net5: sumShares(days, 5),
      net20,
      net60: sumShares(days, 60),
      value5: sumValue(days, 5),
      value20,
      value60: sumValue(days, 60),
      persistence20,
      flowScore,
    },
    `asing ${arahKata} ~${miliar(value20)} dalam 20 hari (estimasi)${umur}`,
    Math.abs(arah) >= 0.3 ? 'sedang' : 'rendah',
    evidence,
  )

  return staleness ? { ...result, staleness } : result
}
