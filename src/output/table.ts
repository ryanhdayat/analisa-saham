import { csvNumber } from './csv.ts'
import { RANK_COLUMNS } from '../analysis/report.ts'
import type { ScanRow } from '../analysis/report.ts'

/** Kolom yang muat di terminal. Berkas CSV/Excel membawa selengkapnya. */
const KOLOM: Array<{ head: string; width: number; get: (r: ScanRow) => string }> = [
  { head: 'KODE', width: 6, get: (r) => r.code },
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
  {
    head: 'ASING20',
    width: 14,
    get: (r) => {
      const f = r.metrics.flow
      if (!f.available || !f.value) return 'n/a'
      const rp = `${f.value.value20 >= 0 ? '+' : '−'}Rp${Math.abs(f.value.value20 / 1e9).toFixed(1)}M`
      // Umur cache dicetak DI SEL, bukan cuma di header — spanduk gampang terlewat.
      return f.staleness ? `${rp} (${f.staleness.daysOld}h)` : rp
    },
  },
  {
    head: 'NILAI/HR',
    width: 11,
    get: (r) => {
      const v = r.metrics.liquidity.value?.avgDailyValue
      return v == null ? 'n/a' : `Rp${(v / 1e9).toFixed(1)}M`
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

export function renderTable(rows: ScanRow[], skipped: ScanRow[]): string {
  const out: string[] = []
  const tanggal = rows[0]?.date ?? skipped[0]?.date ?? '—'

  out.push(`SCAN WATCHLIST — ${tanggal}`)
  out.push(`${rows.length} lolos, ${skipped.length} tersaring keluar`)

  // Degradasi harus terlihat: peringkat yang tersusun dari kolom berbeda tidak
  // sebanding antar-run, dan itu tidak boleh diketahui belakangan.
  const hilang = new Set<string>()
  for (const r of rows) for (const c of RANK_COLUMNS) if (!r.rank.used.includes(c)) hilang.add(c)
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
      out.push(`${pad(r.code, 6)} ${r.gates.failures.join(' | ')}`)
    }
  }

  out.push('')
  out.push(
    'Catatan: Wyckoff dan VPA adalah tafsir heuristik dan TIDAK ikut memeringkat. ' +
      'Nilai asing adalah estimasi rupiah dari data lembar IDX.',
  )

  return out.join('\n')
}
