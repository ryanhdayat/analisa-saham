import { csvNumber } from './csv.ts'
import type { ScanRow } from '../analysis/report.ts'
import { IDX, type Market } from '../market.ts'

interface Kolom {
  head: string
  width: number
  get: (r: ScanRow) => string
}

/** Kolom yang muat di terminal. Berkas CSV/Excel membawa selengkapnya. */
const kolomFor = (market: Market, codeWidth: number): Kolom[] => [
  { head: 'KODE', width: codeWidth, get: (r) => r.code },
  { head: 'CLOSE', width: 9, get: (r) => csvNumber(r.close, 0) },
  { head: 'SKOR', width: 6, get: (r) => csvNumber(r.rank.score, 2) },
  { head: 'RVOL', width: 6, get: (r) => csvNumber(r.metrics.volume.value?.rvol ?? null, 2) },
  {
    head: 'TREN D/W',
    width: 18,
    get: (r) => {
      const s = r.metrics.structure.value
      return s ? `${s.daily.structure}/${s.weekly.structure}` : 'n/a'
    },
  },
  { head: 'FASE', width: 9, get: (r) => r.metrics.structure.value?.daily.phase ?? 'n/a' },
  { head: 'MA', width: 6, get: (r) => (r.metrics.filters.value?.stacked ? 'susun' : '—') },
  { head: 'RS60', width: 7, get: (r) => csvNumber(r.metrics.strength.value?.rs60 ?? null, 1) },
  // Kolom khas IDX: dihilangkan di pasar yang tidak punya datanya, bukan
  // dicetak kosong terus-menerus.
  ...(market.hasIdxLayer ? ([{
    head: 'ASING20',
    width: 14,
    get: (r) => {
      const f = r.metrics.flow
      if (!f.available || !f.value) return 'n/a'
      const rp = `${f.value.value20 >= 0 ? '+' : '−'}Rp${Math.abs(f.value.value20 / 1e9).toFixed(1)}M`
      // Umur cache dicetak DI SEL, bukan cuma di header — spanduk gampang terlewat.
      return f.staleness ? `${rp} (${f.staleness.daysOld}h)` : rp
    },
  }] as Kolom[]) : []),
  {
    head: 'NILAI/HR',
    width: 11,
    get: (r) => {
      const v = r.metrics.liquidity.value?.avgDailyValue
      return v == null ? 'n/a' : market.moneyCompact(v)
    },
  },
  { head: 'R:R', width: 7, get: (r) => {
    const rr = r.metrics.riskReward.value?.ratio
    return rr == null ? 'n/a' : `1:${rr.toFixed(1)}`
  } },
  { head: 'VPA', width: 16, get: (r) => r.metrics.vpa.value?.latest?.signal ?? '—' },
  { head: 'WYCKOFF', width: 12, get: (r) => r.metrics.wyckoff.value?.phase ?? 'n/a' },
]

const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s.padEnd(w))

export function renderTable(rows: ScanRow[], skipped: ScanRow[], market: Market = IDX): string {
  // Diukur dari baris yang benar-benar ada, dengan lebar pasar sebagai LANTAI.
  // Lebar tetap apa pun akhirnya kurang: ticker crypto yang dibedakan Yahoo bisa
  // 18 karakter, dan kode yang terpotong itu ambigu soal instrumen apa yang dibaca.
  const codeWidth = Math.max(
    market.codeWidth,
    ...[...rows, ...skipped].map((r) => r.code.length),
  )
  const KOLOM = kolomFor(market, codeWidth)
  const out: string[] = []
  const tanggal = rows[0]?.date ?? skipped[0]?.date ?? '—'

  out.push(`SCAN WATCHLIST — ${tanggal}`)
  out.push(`${rows.length} lolos, ${skipped.length} tersaring keluar`)

  // Degradasi harus terlihat: peringkat yang tersusun dari kolom berbeda tidak
  // sebanding antar-run, dan itu tidak boleh diketahui belakangan.
  const hilang = new Set<string>()
  for (const r of rows) for (const c of market.rankColumns) if (!r.rank.used.includes(c)) hilang.add(c)
  if (hilang.size > 0) {
    out.push('')
    out.push(
      `PERINGATAN — peringkat TERDEGRADASI: kolom ${[...hilang].join(', ')} tidak tersedia. ` +
        `Skor dihitung dari kolom yang ada saja, jadi baris ini tidak sebanding dengan hasil run yang lengkap.`,
    )
  }

  out.push('')
  out.push(KOLOM.map((k) => pad(k.head, k.width)).join(' '))
  for (const r of rows) {
    out.push(KOLOM.map((k) => pad(k.get(r), k.width)).join(' '))
  }

  if (rows.length === 0) out.push('(tidak ada emiten yang lolos gerbang)')

  if (skipped.length > 0) {
    out.push('')
    out.push('TERSARING KELUAR')
    for (const r of skipped) {
      out.push(`${pad(r.code, codeWidth)} ${r.gates.failures.join(' | ')}`)
    }
  }

  out.push('')
  out.push(
    'Catatan: Wyckoff dan VPA adalah tafsir heuristik dan TIDAK ikut memeringkat.' +
      (market.hasIdxLayer
        ? ' Nilai asing adalah estimasi rupiah dari data lembar IDX.'
        : ''),
  )

  return out.join('\n')
}
