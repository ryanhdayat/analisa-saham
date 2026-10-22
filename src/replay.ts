import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRow, type ScanRow } from './analysis/report.ts'
import { WARMUP_BARS } from './chart.ts'
import { gateOptions, parseWatchlist, scanDefaultsFor } from './cli-args.ts'
import { judge } from './hasil/nilai.ts'
import { volumeProfile } from './indicators.ts'
import { historyRange, marketById, type Market } from './market.ts'
import { columnsFor } from './output/columns.ts'
import { jakartaStamp } from './output/screener.ts'
import {
  capTarget, evaluateFilter, forwardReturn, isRanked, rankColumns, sampleIndices, summarizeBucket,
  type BucketStats, type FilterStats, type Sample,
} from './replay/stats.ts'
import { fetchBars, parseChartResponse, toSymbol } from './yahoo.ts'
import type { Bar } from './types.ts'

/**
 * Uji ulang scan: jalankan analisa yang sama persis dengan scan.ts pada tanggal-
 * tanggal di masa lalu — hanya dengan bar sampai tanggal itu — lalu lihat apa
 * yang terjadi sesudahnya. Hasilnya: kolom scan mana yang benar-benar membedakan
 * emiten yang naik dari yang tidak.
 *
 *   bun run src/replay.ts                      # IDX, 2 tahun, sampel tiap 5 bar
 *   bun run src/replay.ts --market crypto
 *   bun run src/replay.ts --tahun 1 --langkah 10 BBCA BBRI
 *   bun run src/replay.ts --semua              # ikutkan juga sampel tidak likuid
 *
 * Bawaannya hanya sampel yang lolos gerbang likuiditas: hanya itu yang bisa dipilih
 * screener, dan saham tidur yang harganya diam berminggu-minggu (return tepat 0)
 * menenggelamkan semua kolom lain kalau ikut dihitung.
 *
 * Lapisan IDX tidak dipakai (sama seperti cron yang memakai --tanpa-idx).
 */

const RAW_DIR = 'raw'
const OUT_DIR = 'report/replay'
const DISPLAY_DAYS = 250
const PROFILE_ROWS = 24
/** Kelompok dengan sampel lebih sedikit dari ini tidak ikut menentukan peringkat kolom. */
const MIN_N = 100
/** Bar terakhir yang masih dihitung sebagai sinyal VPA "baru". */
const VPA_FRESH_BARS = 5

/** Kolom yang diuji. Kolom khas IDX (asing, free float, RS sektor) selalu n/a tanpa lapisan IDX. */
const ANALYZED = [
  'GERBANG', 'SKOR', 'TREND', 'RS60', 'RVOL_SKOR', 'RVOL', 'VOLUME_BACA', 'TREN_HARIAN', 'TREN_MINGGUAN',
  'FASE', 'RS60_POIN', 'MA_TERSUSUN', 'DIVERGENSI_OBV', 'ATR_PERSEN', 'NILAI_HARIAN', 'RR', 'VPA_5HARI', 'WYCKOFF',
]

/**
 * Varian target yang dinilai untuk tiap rencana: target analisa apa adanya, dan
 * target yang dipotong ke +15% / +10% dari entry. Cut loss-nya sama untuk semua.
 * Gerbang R:R ≥ 2 memilih target yang jauh; varian ini menguji apakah target
 * yang lebih dekat lebih sering tercapai sebelum cut loss.
 */
const VARIANTS: { key: string; label: string; cap: number | null }[] = [
  { key: 'analisa', label: 'target analisa', cap: null },
  { key: 'maks15', label: 'target maks +15%', cap: 0.15 },
  { key: 'maks10', label: 'target maks +10%', cap: 0.1 },
]

type Predicate = (s: Sample) => boolean

/**
 * Kombinasi yang diuji, diturunkan dari temuan per kolom (tren penuh, volatilitas
 * tenang, pullback) plus pembanding terburuknya. Karena diturunkan dari data yang
 * sama, laporan memisahkan tiap kombinasi per paruh waktu.
 */
function combinations(samples: Sample[]): { label: string; pred: Predicate }[] {
  const atr = samples.map((s) => s.values.ATR_PERSEN).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b)
  const med = atr[Math.floor(atr.length / 2)] ?? 0
  const top = atr[Math.floor(atr.length * 0.8)] ?? 0
  const num = (s: Sample, c: string) => (typeof s.values[c] === 'number' ? (s.values[c] as number) : null)
  const trend = (s: Sample) => num(s, 'TREND')
  const full: Predicate = (s) => Math.abs((trend(s) ?? -1) - 1) < 1e-9
  const calm: Predicate = (s) => (num(s, 'ATR_PERSEN') ?? Infinity) <= med
  const lolos: Predicate = (s) => s.values.GERBANG === 'lolos'
  const pullback: Predicate = (s) => s.values.FASE === 'pullback'
  const m = String(Math.round(med * 10) / 10).replace('.', ',')
  return [
    { label: 'Semua sampel', pred: () => true },
    { label: 'Lolos gerbang (aturan sekarang)', pred: lolos },
    { label: 'TREND = 1', pred: full },
    { label: `TREND = 1 + ATR ≤ ${m}%`, pred: (s) => full(s) && calm(s) },
    { label: `TREND = 1 + ATR ≤ ${m}% + pullback`, pred: (s) => full(s) && calm(s) && pullback(s) },
    { label: `TREND ≥ 0,8 + ATR ≤ ${m}%`, pred: (s) => (trend(s) ?? 0) >= 0.8 - 1e-9 && calm(s) },
    { label: 'Pullback + tren mingguan uptrend', pred: (s) => pullback(s) && s.values.TREN_MINGGUAN === 'uptrend' },
    { label: `Lolos gerbang + TREND = 1 + ATR ≤ ${m}%`, pred: (s) => lolos(s) && full(s) && calm(s) },
    { label: 'Pembanding: TREND 0,4–0,6', pred: (s) => (trend(s) ?? -1) >= 0.4 - 1e-9 && (trend(s) ?? 9) <= 0.6 + 1e-9 },
    { label: 'Pembanding: ATR 20% teratas', pred: (s) => (num(s, 'ATR_PERSEN') ?? -Infinity) > top },
  ]
}

interface ReplayArgs {
  market: Market
  tahun: number
  langkah: number
  horizon: number
  /** Ikutkan sampel yang tidak lolos gerbang likuiditas. */
  semua: boolean
  codes: string[]
}

function parseReplayArgs(argv: string[]): ReplayArgs {
  const args: ReplayArgs = { market: marketById('idx'), tahun: 2, langkah: 5, horizon: 20, semua: false, codes: [] }
  const num = (flag: string, v: string | undefined) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} butuh angka positif.`)
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--market') args.market = marketById(argv[++i] ?? '')
    else if (a === '--tahun') args.tahun = num(a, argv[++i])
    else if (a === '--langkah') args.langkah = Math.round(num(a, argv[++i]))
    else if (a === '--horizon') args.horizon = Math.round(num(a, argv[++i]))
    else if (a === '--semua') args.semua = true
    else if (a.startsWith('--')) throw new Error(`Opsi tidak dikenal: ${a}`)
    else args.codes.push(a.toUpperCase())
  }
  return args
}

/**
 * Bar dari cache raw/ kalau umurnya kurang dari 12 jam, selain itu dari Yahoo.
 * Uji ulang biasanya dijalankan berkali-kali saat membaca hasilnya; mengambil
 * ~900 emiten x 5 tahun tiap kali buang waktu beberapa menit.
 */
async function loadBars(code: string, range: string, market: Market): Promise<{ bars: Bar[]; name: string }> {
  const path = join(RAW_DIR, `${toSymbol(code, market)}-${range}.json`)
  try {
    if (Date.now() - (await stat(path)).mtimeMs < 12 * 3600_000) {
      return parseChartResponse(JSON.parse(await readFile(path, 'utf8')))
    }
  } catch {
    // Belum ada cache — ambil dari Yahoo.
  }
  return fetchBars(code, { range, rawDir: RAW_DIR, market })
}

/** Indeks bar terakhir yang tanggalnya ≤ `date`. */
function upperIndex(bars: Bar[], date: string): number {
  let lo = 0
  let hi = bars.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid]!.date <= date) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

function rowValues(row: ScanRow, market: Market, fresh: string): Sample['values'] {
  const out: Sample['values'] = {}
  for (const c of columnsFor(market)) out[c.header] = c.value(row)
  // Dalam satuan --min-likuiditas pasarnya (miliar rupiah / juta dolar), supaya
  // batas kuantilnya terbaca, bukan 309561331000.
  const value = out[`NILAI_HARIAN_${market.currencyCode}`]
  out.NILAI_HARIAN = typeof value === 'number' ? value / market.minValueScale : null
  out.GERBANG = row.gates.passed ? 'lolos' : 'tersaring'
  const vpaDate = out.VPA_TANGGAL
  out.VPA_5HARI = typeof vpaDate === 'string' && vpaDate >= fresh ? (out.VPA_TERAKHIR ?? null) : 'tidak ada'
  return out
}

const pct = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d).replace('.', ',')}%`)
const signed = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : ''}${pct(x)}`)
const pp = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} poin`

function bucketTable(buckets: BucketStats[], base: BucketStats): string {
  const lines = [
    '| Kelompok | Sampel | Naik | vs semua | Rata-rata | Median | Kena target dulu | Selesai | Rata-rata trade |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|',
  ]
  for (const b of buckets) {
    const thin = b.nFwd < MIN_N ? ' _(sedikit)_' : ''
    const lift = b.naik === null || base.naik === null ? '—' : `${b.naik >= base.naik ? '+' : ''}${pp(b.naik - base.naik)}`
    lines.push(
      `| ${b.label}${thin} | ${b.nFwd} | ${pct(b.naik)} | ${lift} | ${signed(b.rata)} | ${signed(b.median)} | ${pct(b.kenaTarget)} | ${b.nSettled} | ${signed(b.rataTrade)} |`,
    )
  }
  return lines.join('\n')
}

function report(
  samples: Sample[],
  args: ReplayArgs,
  meta: { from: string; to: string; codes: number; gagal: string[]; total: number },
): string {
  const base = summarizeBucket('semua', samples)
  const ranked = rankColumns(samples, ANALYZED, MIN_N)
  const eligible = (b: BucketStats) => isRanked(b, MIN_N)
  const best = ranked
    .flatMap((r) => r.buckets.filter(eligible).map((b) => ({ column: r.column, ...b })))
    .sort((a, b) => b.naik! - a.naik!)

  const out: string[] = []
  out.push(`# Uji ulang scan — ${args.market.exchangeLabel}`, '')
  out.push(
    `Dibuat ${jakartaStamp(new Date())}. ${meta.codes} emiten, sampel tiap ${args.langkah} bar dari ${meta.from} sampai ${meta.to}: **${samples.length.toLocaleString('id-ID')} sampel**.`,
    '',
    args.semua
      ? `- Semua sampel, termasuk yang tidak lolos gerbang likuiditas.`
      : `- **Hanya sampel likuid** (nilai transaksi harian ≥ ${args.market.moneyCompact(args.market.minValue)}): ${samples.length.toLocaleString('id-ID')} dari ${meta.total.toLocaleString('id-ID')}. Pakai \`--semua\` untuk semuanya.`,
    `- NILAI_HARIAN dalam ${args.market.minValueUnit.toLowerCase()} ${args.market.currencyCode}.`,
    `- **Naik** = harga close ${args.horizon} bar setelah tanggal sampel lebih tinggi dari close tanggal itu.`,
    '- **Kena target dulu** = aturan /hasil/: target analisa vs cut loss (stop dijepit 5–10%), dihitung di antara yang sudah selesai.',
    `- Baseline semua sampel: **naik ${pct(base.naik)}**, rata-rata ${signed(base.rata)}, median ${signed(base.median)}; kena target dulu ${pct(base.kenaTarget)}.`,
    '',
    '> **Batasan.** (1) Watchlist hari ini — emiten yang sudah delisting tidak ada, jadi hasil cenderung terlalu bagus.',
    '> (2) Sampel saling tumpang tindih dan bergerak bersama pasar; selisih beberapa poin bisa kebetulan.',
    '> (3) Tanpa lapisan IDX (asing, free float, RS sektor). (4) Masa lalu bukan jaminan.',
    '> (5) Rata-rata bisa digelembungkan segelintir lonjakan ekstrem (terutama crypto); **Naik** dan **Median** lebih bisa dipercaya.',
    '',
  )
  if (meta.gagal.length) out.push(`Gagal diambil (${meta.gagal.length}): ${meta.gagal.join(', ')}`, '')

  out.push('## Kolom yang paling membedakan', '')
  out.push(`Selisih persen naik antara kelompok terbaik dan terburuk tiap kolom (kelompok ≥ ${MIN_N} sampel).`, '')
  out.push('| Kolom | Selisih | Kelompok terbaik | Naik | Kelompok terburuk | Naik |', '|---|--:|---|--:|---|--:|')
  for (const r of ranked) {
    const e = r.buckets.filter(eligible)
    if (e.length < 2) {
      out.push(`| ${r.column} | — | — | — | — | — |`)
      continue
    }
    const hi = e.reduce((a, b) => (b.naik! > a.naik! ? b : a))
    const lo = e.reduce((a, b) => (b.naik! < a.naik! ? b : a))
    out.push(`| ${r.column} | ${pp(r.spread)} | ${hi.label} | ${pct(hi.naik)} | ${lo.label} | ${pct(lo.naik)} |`)
  }
  out.push('', '## Kondisi dengan peluang naik tertinggi', '')
  out.push('| Kolom | Kelompok | Sampel | Naik | Rata-rata | Kena target dulu |', '|---|---|--:|--:|--:|--:|')
  for (const b of best.slice(0, 12)) {
    out.push(`| ${b.column} | ${b.label} | ${b.nFwd} | ${pct(b.naik)} | ${signed(b.rata)} | ${pct(b.kenaTarget)} |`)
  }
  const split = [...samples.map((s) => s.date)].sort()[Math.floor(samples.length / 2)]!
  const combos = combinations(samples).map((c) => evaluateFilter(c.label, samples.filter(c.pred), split, VARIANTS.map((v) => v.key)))
  out.push('', '## Kombinasi', '')
  out.push(
    `Paruh 1 = sampel sebelum ${split}, paruh 2 = sesudahnya. Kondisi yang unggul hanya di satu paruh kemungkinan kebetulan.`,
    '',
    '| Kondisi | Sampel | Naik | Paruh 1 | Paruh 2 | Median |',
    '|---|--:|--:|--:|--:|--:|',
  )
  for (const c of combos) {
    out.push(`| ${c.label}${c.n < MIN_N ? ' _(sedikit)_' : ''} | ${c.n} | ${pct(c.naik)} | ${pct(c.naikAwal)} | ${pct(c.naikAkhir)} | ${signed(c.median)} |`)
  }
  out.push('', '## Varian target', '')
  out.push(
    'Kena target dulu / rata-rata return trade yang sudah selesai, per varian target. Cut loss sama untuk semua (stop analisa dijepit 5–10%).',
    '',
    `| Kondisi | ${VARIANTS.map((v) => v.label).join(' | ')} |`,
    `|---|${VARIANTS.map(() => '--:').join('|')}|`,
  )
  const tradeCell = (c: FilterStats, key: string) => {
    const t = c.trades[key]!
    return t.nSettled ? `${pct(t.kenaTarget)} / ${signed(t.rataTrade)} (${t.nSettled})` : '—'
  }
  for (const c of combos) out.push(`| ${c.label} | ${VARIANTS.map((v) => tradeCell(c, v.key)).join(' | ')} |`)
  out.push('', '## Rincian per kolom', '')
  for (const r of ranked) out.push(`### ${r.column}`, '', bucketTable(r.buckets, base), '')
  return out.join('\n')
}

function samplesCsv(samples: Sample[]): string {
  const head = ['KODE', 'TANGGAL', 'RETURN_MAJU', 'STATUS', 'RETURN_TRADE', ...ANALYZED]
  const cell = (v: string | number | null | undefined) =>
    v === null || v === undefined ? 'n/a' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6).replace('.', ',') : v
  const lines = [head.join(';')]
  for (const s of samples) {
    lines.push(
      [s.code, s.date, cell(s.fwd), s.trades.analisa?.status ?? 'n/a', cell(s.trades.analisa?.ret), ...ANALYZED.map((c) => cell(s.values[c]))].join(';'),
    )
  }
  return lines.join('\n')
}

async function main(): Promise<number> {
  let args: ReplayArgs
  try {
    args = parseReplayArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 2
  }
  const { market } = args
  const codes = args.codes.length ? args.codes : parseWatchlist(await readFile(market.watchlist, 'utf8'))

  // Sejarah yang dipegang scan.ts sungguhan, dan yang minimal dibutuhkan analisanya.
  const history = parseInt(historyRange(DISPLAY_DAYS, WARMUP_BARS, market)) * market.barsPerYear
  const minHistory = DISPLAY_DAYS + WARMUP_BARS
  const lookback = Math.round(args.tahun * market.barsPerYear)
  const range = `${Math.ceil((lookback + minHistory) / market.barsPerYear) + 1}y`
  console.log(`[replay] ${market.id}: ${codes.length} emiten, rentang ${range}, ${args.tahun} tahun, langkah ${args.langkah}, horizon ${args.horizon}`)

  const index = (await loadBars(market.benchmark, range, market)).bars
  // Gerbang yang sama dengan scan.ts bawaan, supaya GERBANG di laporan berarti
  // persis "yang akan dipilih cron".
  const options = {
    minValue: market.minValue,
    ...gateOptions(scanDefaultsFor(market)),
    rankColumns: market.rankColumns,
    money: market.money,
    dailyValue: market.dailyValue,
  }

  const samples: Sample[] = []
  const gagal: string[] = []
  const t0 = Date.now()
  for (const [n, code] of codes.entries()) {
    let data: { bars: Bar[]; name: string }
    try {
      data = await loadBars(code, range, market)
    } catch (err) {
      gagal.push(code)
      console.error(`${code.padEnd(6)} GAGAL: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const { bars, name } = data
    for (const i of sampleIndices(bars.length, { step: args.langkah, minHistory, lookback })) {
      // Close nol = data rusak; analisa dan entry di harga nol tidak bermakna.
      if (!(bars[i]!.close > 0)) continue
      const hist = bars.slice(Math.max(0, i + 1 - history), i + 1)
      const display = hist.slice(-DISPLAY_DAYS)
      const date = bars[i]!.date
      const row = buildRow(
        {
          code,
          name,
          bars: hist,
          displayBars: display,
          profile: volumeProfile(display, PROFILE_ROWS),
          indexBars: index.slice(0, upperIndex(index, date) + 1),
        },
        options,
      )
      const rr = row.metrics.riskReward
      const trades: Sample['trades'] = {}
      if (rr.available && rr.value) {
        const { entry, stop, target } = rr.value
        const after = bars.slice(i)
        for (const v of VARIANTS) {
          const h = judge({ code, name, date, entry, stop, target: v.cap === null ? target : capTarget(entry, target, v.cap) }, after)
          trades[v.key] = { status: h.status, ret: h.ret }
        }
      }
      const fresh = bars[Math.max(0, i - VPA_FRESH_BARS + 1)]!.date
      samples.push({
        code,
        date,
        values: rowValues(row, market, fresh),
        fwd: forwardReturn(bars, i, args.horizon),
        trades,
      })
    }
    if ((n + 1) % 50 === 0) console.log(`[replay] ${n + 1}/${codes.length} emiten, ${samples.length} sampel, ${Math.round((Date.now() - t0) / 1000)} dtk`)
  }

  const total = samples.length
  const liquid = (s: Sample) => typeof s.values.NILAI_HARIAN === 'number' && s.values.NILAI_HARIAN * market.minValueScale >= market.minValue
  const analyzed = args.semua ? samples : samples.filter(liquid)

  if (analyzed.length === 0) {
    console.error('Tidak ada sampel — tidak ada emiten dengan sejarah yang cukup.')
    return 1
  }
  const dates = analyzed.map((s) => s.date).sort()
  const tanggal = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
  await mkdir(OUT_DIR, { recursive: true })
  const md = join(OUT_DIR, `${market.id}-${tanggal}.md`)
  const csv = join(OUT_DIR, `${market.id}-${tanggal}-sampel.csv`)
  await writeFile(md, report(analyzed, args, { from: dates[0]!, to: dates.at(-1)!, codes: codes.length - gagal.length, gagal, total }))
  await writeFile(csv, samplesCsv(analyzed))

  const ranked = rankColumns(analyzed, ANALYZED, MIN_N)
  console.log('')
  for (const r of ranked) console.log(`${r.column.padEnd(16)} selisih ${pp(r.spread)}`)
  console.log('')
  console.log(`Laporan: ${md}`)
  console.log(`Sampel : ${csv}`)
  return 0
}

process.exit(await main())
