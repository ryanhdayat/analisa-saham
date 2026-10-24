import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildPicks, summarize, yahooRangeSince, type Pilihan } from './hasil/nilai.ts'
import { writeHasilPage, type HasilPasar } from './output/hasil-page.ts'
import { CRYPTO, IDX, type Market } from './market.ts'
import { fetchBars } from './yahoo.ts'
import { posisi, ringkasSimulasi } from './rencana/simulasi.ts'
import type { Bar } from './types.ts'

/**
 * Rekam jejak pilihan screener: baca semua report/<pasar>/pilihan-<TANGGAL>.json
 * yang ditulis scan.ts, ambil bar terbaru tiap emiten, nilai, lalu tulis
 * report/hasil-<TANGGAL>/index.html.
 *
 * Tidak ada status yang disimpan antar-run: semua pilihan dinilai ulang dari bar
 * setiap kali, jadi menjalankan ini dua kali atau melewatkan sehari tidak
 * mengubah hasilnya.
 */

const PILIHAN_FILE = /^pilihan-\d{4}-\d{2}-\d{2}\.json$/

async function readPilihan(dir: string): Promise<Pilihan[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const files = names.filter((n) => PILIHAN_FILE.test(n))
  const lists = await Promise.all(files.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8')) as Pilihan[]))
  return lists.flat()
}

async function nilaiPasar(market: Market, label: string, now: Date) {
  const scans = await readPilihan(market.reportDir)
  const codes = [...new Set(scans.map((p) => p.code))]
  const earliest = scans.reduce((min, p) => (p.date < min ? p.date : min), now.toISOString().slice(0, 10))
  const range = yahooRangeSince(earliest, now)
  console.log(`[${market.id}] ${scans.length} catatan pilihan, ${codes.length} emiten, rentang ${range}`)

  const barsByCode = new Map<string, Bar[]>()
  const gagal: string[] = []
  for (const code of codes) {
    try {
      barsByCode.set(code, (await fetchBars(code, { range, market })).bars)
    } catch (err) {
      gagal.push(code)
      console.error(`${code.padEnd(6)} GAGAL: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const picks = buildPicks(scans, barsByCode, market)
  const ringkasan = summarize(picks)
  console.log(
    `[${market.id}] ${ringkasan.total} pilihan: ${ringkasan.target} target, ${ringkasan.cut} cut loss, ${ringkasan.open} terbuka`,
  )
  const idx = market.id === 'idx'
  const pasar: HasilPasar = {
    id: market.id,
    label,
    currency: idx ? 'IDR' : 'USD',
    picks: idx ? picks.map((h) => ({ ...h, sim: posisi(h) })) : picks,
    ringkasan,
    gagal,
    ...(idx ? { simulasi: ringkasSimulasi(picks) } : {}),
  }
  return { pasar, codes: codes.length }
}

async function main(): Promise<number> {
  const now = new Date()
  const results = [await nilaiPasar(IDX, 'Saham IDX', now), await nilaiPasar(CRYPTO, 'Crypto', now)]

  const tanggal = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
  const html = await writeHasilPage(join('report', `hasil-${tanggal}`), results.map((r) => r.pasar), now)
  console.log('')
  console.log(`HTML : ${html}`)

  const total = results.reduce((s, r) => s + r.codes, 0)
  const failed = results.reduce((s, r) => s + r.pasar.gagal.length, 0)
  if (failed > 0) console.error(`\n${failed} dari ${total} emiten gagal diambil.`)
  return failed > 0 ? 1 : 0
}

process.exit(await main())
