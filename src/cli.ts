import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs, parseWatchlist } from './cli-args.ts'
import { fetchBars } from './yahoo.ts'
import { buildChartInput, WARMUP_BARS } from './chart.ts'
import { renderSvg, CANVAS } from './render.ts'
import { SvgShooter } from './png.ts'

const RAW_DIR = 'raw'

const USAGE = `Pakai: bun run src/cli.ts [KODE...] [opsi]

  KODE...              Kode emiten tanpa sufiks, mis. BBCA BBRI. Kalau kosong,
                       dibaca dari watchlist.
  --days N             Panjang jendela tampil dalam bar (bawaan 250).
  --rows N             Jumlah baris profil volume (bawaan 24).
  --out DIR            Direktori keluaran (bawaan out).
  --watchlist BERKAS   Daftar kode, satu per baris (bawaan watchlist.txt).
  --svg                Simpan juga SVG-nya di samping PNG.`

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    // Salah ketik opsi tidak layak dapat stack trace; pesan satu baris lebih terbaca.
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return 1
  }

  let codes = args.codes
  if (codes.length === 0) {
    try {
      codes = parseWatchlist(await readFile(args.watchlist, 'utf8'))
    } catch {
      console.error(
        `Tidak bisa membaca ${args.watchlist}. Buat berkasnya (satu kode emiten per baris) ` +
          `atau sebutkan kodenya langsung: bun run src/cli.ts BBCA`,
      )
      return 1
    }
    if (codes.length === 0) {
      console.error(`${args.watchlist} tidak berisi satu kode emiten pun.`)
      return 1
    }
  }

  await mkdir(args.outDir, { recursive: true })

  // Ambil lebih panjang dari yang digambar supaya MA 200 sudah bernilai sejak
  // candle pertama. Lihat WARMUP_BARS di chart.ts.
  const range = `${Math.ceil((args.days + WARMUP_BARS) / 250) + 1}y`

  const shooter = new SvgShooter()
  let failed = 0

  try {
    for (const code of codes) {
      try {
        const data = await fetchBars(code, { range, rawDir: RAW_DIR })
        const input = buildChartInput(data, args.days, args.rows)
        const svg = renderSvg(input)

        const pngPath = join(args.outDir, `${code}.png`)
        await shooter.shoot(svg, pngPath, CANVAS.width, CANVAS.height)
        if (args.keepSvg) await writeFile(join(args.outDir, `${code}.svg`), svg)

        const first = input.bars[0]!.date
        const last = input.bars[input.bars.length - 1]!.date
        console.log(`${code.padEnd(6)} ${pngPath}  ${input.bars.length} bar  ${first} s.d. ${last}`)
      } catch (err) {
        failed++
        console.error(`${code.padEnd(6)} GAGAL: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } finally {
    await shooter.close()
  }

  if (failed > 0) console.error(`\n${failed} dari ${codes.length} emiten gagal.`)
  return failed > 0 ? 1 : 0
}

process.exit(await main())
