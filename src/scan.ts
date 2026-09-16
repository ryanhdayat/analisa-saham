import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseScanArgs, parseWatchlist, type ScanArgs } from './cli-args.ts'
import { fetchBars } from './yahoo.ts'
import type { Bar } from './types.ts'
import { volumeProfile } from './indicators.ts'
import { WARMUP_BARS } from './chart.ts'
import { buildRow, type ScanRow } from './analysis/report.ts'
import { fetchEnrichment, type Enrichment } from './idx.ts'
import { renderTable } from './output/table.ts'
import { toCsv } from './output/csv.ts'
import { writeXlsx } from './output/xlsx.ts'
import { toJson } from './output/json.ts'

const RAW_DIR = 'raw'
const PROFILE_ROWS = 24
const IHSG = '^JKSE'

const USAGE = `Pakai: bun run src/scan.ts [KODE...] [opsi]

  KODE...                  Kode emiten. Kosong = baca watchlist.
  --days N                 Panjang jendela analisis (bawaan 250).
  --min-likuiditas MILIAR  Ambang nilai transaksi harian (bawaan 5).
  --min-rr N               Ambang risk/reward (bawaan 2).
  --hari-idx N             Hari bursa riwayat aliran asing (bawaan 60).
  --tanpa-idx              Lewati lapisan IDX; jalankan 9 metrik Yahoo saja.
  --out DIR                Direktori keluaran (bawaan out).
  --watchlist BERKAS       Daftar kode (bawaan watchlist.txt).`

async function resolveCodes(args: ScanArgs): Promise<string[] | null> {
  if (args.codes.length > 0) return args.codes
  try {
    const codes = parseWatchlist(await readFile(args.watchlist, 'utf8'))
    if (codes.length === 0) {
      console.error(`${args.watchlist} tidak berisi satu kode emiten pun.`)
      return null
    }
    return codes
  } catch {
    console.error(`Tidak bisa membaca ${args.watchlist}. Sebutkan kodenya langsung, mis. bun run src/scan.ts BBCA`)
    return null
  }
}

async function main(): Promise<number> {
  let args: ScanArgs
  try {
    args = parseScanArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return 1
  }

  const codes = await resolveCodes(args)
  if (!codes) return 1

  await mkdir(args.outDir, { recursive: true })
  const range = `${Math.ceil((args.days + WARMUP_BARS) / 250) + 1}y`

  // IHSG dulu: tanpa ini metrik kekuatan relatif tidak bisa dihitung untuk siapa pun.
  let indexBars: Bar[]
  try {
    indexBars = (await fetchBars(IHSG, { range, rawDir: RAW_DIR })).bars
  } catch (err) {
    console.error(`Gagal mengambil IHSG (${IHSG}): ${err instanceof Error ? err.message : String(err)}`)
    console.error('Kekuatan relatif tidak bisa dihitung; scan dilanjutkan tanpa metrik itu.')
    indexBars = []
  }

  // Lapisan pengaya IDX. Kegagalannya TIDAK menggagalkan scan.
  const enrichment: Enrichment = args.useIdx
    ? await fetchEnrichment(codes, args.idxDays)
    : {
        foreignByCode: new Map(),
        freeFloatByCode: new Map(),
        sectorBarsByCode: new Map(),
        note: 'Lapisan IDX dimatikan lewat --tanpa-idx.',
      }
  if (enrichment.note) console.error(`[idx] ${enrichment.note}`)

  const rows: ScanRow[] = []
  let failed = 0

  for (const code of codes) {
    try {
      const data = await fetchBars(code, { range, rawDir: RAW_DIR })
      const displayBars = data.bars.slice(-args.days)
      const row = buildRow(
        {
          code,
          name: data.name,
          bars: data.bars,
          displayBars,
          profile: volumeProfile(displayBars, PROFILE_ROWS),
          indexBars,
          sectorBars: enrichment.sectorBarsByCode.get(code),
          foreignDays: enrichment.foreignByCode.get(code),
          foreignStaleness: enrichment.staleness,
          freeFloat: enrichment.freeFloatByCode.get(code),
        },
        { minValue: args.minValue, minRatio: args.minRatio },
      )
      rows.push(row)
      await writeFile(join(args.outDir, `${code}.json`), toJson(row))
    } catch (err) {
      failed++
      console.error(`${code.padEnd(6)} GAGAL: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const passed = rows.filter((r) => r.gates.passed).sort((a, b) => b.rank.score - a.rank.score)
  const skipped = rows.filter((r) => !r.gates.passed)

  console.log('')
  console.log(renderTable(passed, skipped))

  const tanggal = rows[0]?.date ?? new Date().toISOString().slice(0, 10)
  const csvPath = join(args.outDir, `scan-${tanggal}.csv`)
  const xlsxPath = join(args.outDir, `scan-${tanggal}.xlsx`)
  await writeFile(csvPath, toCsv([...passed, ...skipped]))
  await writeXlsx(passed, skipped, xlsxPath)

  console.log('')
  console.log(`CSV  : ${csvPath}`)
  console.log(`Excel: ${xlsxPath}`)
  console.log(`JSON : ${args.outDir}/<KODE>.json`)

  if (failed > 0) console.error(`\n${failed} dari ${codes.length} emiten gagal diambil.`)
  return failed > 0 ? 1 : 0
}

process.exit(await main())
