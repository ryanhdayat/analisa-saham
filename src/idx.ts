import { IdxClient } from './idx-client.ts'
import { candidateDates, buildForeignDays, buildFreeFloat, stalenessFrom, toIsoDate } from './idx-shape.ts'
import type { RawStockSummary } from './idx-types.ts'
import type { ForeignDay } from './analysis/flow.ts'
import type { FreeFloatInput } from './analysis/liquidity.ts'
import type { Bar } from './types.ts'

/** 11 sektor IDX-IC → kode indeks sektornya. Disalin dari 01-app1/src/sector.ts. */
export const SECTOR_INDEX: Record<string, string> = {
  Energi: 'IDXENERGY',
  'Barang Baku': 'IDXBASIC',
  Perindustrian: 'IDXINDUST',
  'Barang Konsumen Primer': 'IDXNONCYC',
  'Barang Konsumen Non-Primer': 'IDXCYCLIC',
  Kesehatan: 'IDXHEALTH',
  Keuangan: 'IDXFINANCE',
  'Properti & Real Estat': 'IDXPROPERT',
  Teknologi: 'IDXTECHNO',
  Infrastruktur: 'IDXINFRA',
  'Transportasi & Logistik': 'IDXTRANS',
}

export interface Enrichment {
  foreignByCode: Map<string, ForeignDay[]>
  freeFloatByCode: Map<string, FreeFloatInput>
  sectorBarsByCode: Map<string, Bar[]>
  staleness?: { asOf: string; daysOld: number }
  /** Alasan kalau lapisan ini tidak lengkap. null berarti mulus. */
  note: string | null
}

const KOSONG = (): Enrichment => ({
  foreignByCode: new Map(),
  freeFloatByCode: new Map(),
  sectorBarsByCode: new Map(),
  note: null,
})

/**
 * Lapisan PENGAYA dari IDX. Tidak pernah melempar.
 *
 * IDX ada di belakang Cloudflare dan clientnya menyetir Chrome sungguhan; scraping
 * semacam itu pasti rusak sesekali. Karena itu kegagalan di sini tidak boleh
 * menggagalkan scan — 9 dari 12 metrik sama sekali tidak bergantung pada IDX.
 *
 * Yang gagal dikembalikan sebagai peta kosong berikut `note`, dan pemanggil
 * mencetak metriknya sebagai "tidak tersedia" — BUKAN nol. Kalau ada data lama
 * di cache, ia dipakai dengan `staleness` terisi supaya umurnya bisa dicetak di
 * tiap sel yang terpengaruh.
 */
export async function fetchEnrichment(
  codes: string[],
  tradingDays: number,
  today = new Date(),
): Promise<Enrichment> {
  const result = KOSONG()
  const client = new IdxClient()

  try {
    // Dilebihkan karena hari libur bursa tidak bisa ditebak dari kalender.
    const dates = candidateDates(today, Math.ceil(tradingDays * 1.6))
    const byDate = new Map<string, RawStockSummary[]>()
    let gagalBeruntun = 0

    for (const date of dates) {
      if (byDate.size >= tradingDays) break
      try {
        const rows = await client.getStockSummary(date)
        if (rows.length > 0) byDate.set(date, rows)
        gagalBeruntun = 0
      } catch (err) {
        gagalBeruntun++
        // Tiga kegagalan beruntun berarti endpointnya yang bermasalah, bukan
        // tanggalnya. Berhenti daripada menghabiskan menit demi retry WAF.
        if (gagalBeruntun >= 3) {
          result.note = `IDX berhenti merespons setelah ${byDate.size} hari terkumpul: ${err instanceof Error ? err.message : String(err)}`
          break
        }
      }
    }

    if (byDate.size === 0) {
      result.note ??= 'IDX tidak mengembalikan satu hari pun — aliran asing, free float, dan RS sektor tidak tersedia.'
      return result
    }

    for (const code of codes) {
      const days = buildForeignDays(byDate, code)
      if (days.length > 0) result.foreignByCode.set(code, days)
      const ff = buildFreeFloat(byDate, code)
      if (ff) result.freeFloatByCode.set(code, ff)
    }

    const terbaru = toIsoDate([...byDate.keys()].sort().reverse()[0]!)
    result.staleness = stalenessFrom(terbaru, today)

    if (byDate.size < tradingDays) {
      result.note ??= `Hanya ${byDate.size} dari ${tradingDays} hari bursa yang terkumpul dari IDX.`
    }

    // ── Indeks sektor ────────────────────────────────────────────────────────
    try {
      const profiles = await client.getCompanyProfiles()
      const sektorOf = new Map(profiles.filter((p) => p.KodeEmiten && p.Sektor).map((p) => [p.KodeEmiten, p.Sektor]))
      const dibutuhkan = new Set<string>()
      const indexOfCode = new Map<string, string>()
      for (const code of codes) {
        const sektor = sektorOf.get(code)
        const indexCode = sektor ? SECTOR_INDEX[sektor] : undefined
        if (!indexCode) continue
        indexOfCode.set(code, indexCode)
        dibutuhkan.add(indexCode)
      }

      if (dibutuhkan.size > 0) {
        const barsByIndex = new Map<string, Bar[]>()
        for (const date of [...byDate.keys()].sort()) {
          const rows = await client.getIndexSummary(date).catch(() => [])
          for (const row of rows) {
            if (!dibutuhkan.has(row.IndexCode)) continue
            const list = barsByIndex.get(row.IndexCode) ?? []
            list.push({
              date: toIsoDate(date),
              open: row.Previous,
              high: row.Highest,
              low: row.Lowest,
              close: row.Close,
              volume: row.Volume,
            })
            barsByIndex.set(row.IndexCode, list)
          }
        }
        for (const [code, indexCode] of indexOfCode) {
          const bars = barsByIndex.get(indexCode)
          if (bars && bars.length > 0) result.sectorBarsByCode.set(code, bars)
        }
      }
    } catch (err) {
      result.note ??= `Indeks sektor gagal diambil: ${err instanceof Error ? err.message : String(err)}`
    }
  } catch (err) {
    result.note = `Lapisan IDX gagal seluruhnya: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    await client.close().catch(() => {})
  }

  return result
}
