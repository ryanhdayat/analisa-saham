import type { ScanRow } from '../analysis/report.ts'

/**
 * Catatan risiko untuk baris yang lolos. Tidak menggagalkan gerbang — hanya
 * memberi tahu kenapa baris itu tidak "bersih".
 *
 * Dihitung dari ScanRow (bukan dari baris tabel HTML) supaya catatan pilihan di
 * /hasil/ memakai aturan yang sama dengan halaman screener.
 *
 * R:R di bawah 1 ikut dicatat walau R:R bukan syarat gerbang: risiko ke stop
 * lebih besar dari imbalan ke target, dan itu harus terlihat.
 */
export interface Catatan {
  /** Istilah asli, mis. `R:R 1:0,51`, `Wyckoff distribusi`, `no-demand 10-23`. */
  teknis: string
  /** Kalimat untuk pemula. */
  awam: string
  kind: 'bad' | 'warn'
}

export type Label = 'bersih' | 'hati-hati'

const BAD_WY = new Set(['distribusi', 'markdown'])
const AWAM_VPA: Record<string, string> = {
  'no-demand': 'pembeli sepi saat harga naik',
  upthrust: 'sempat naik lalu ditolak turun',
}
const AWAM_VOLUME: Record<string, string> = {
  'rally-lemah': 'naiknya tanpa dukungan volume',
  'tekanan-jual': 'turun dengan volume besar',
}

const v = <T,>(m: { value: T | null; available: boolean }) => (m.available ? m.value : null)
const angka = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',')

export function catatanRisiko(row: ScanRow): Catatan[] {
  const out: Catatan[] = []
  const wy = v(row.metrics.wyckoff)?.phase
  if (wy && BAD_WY.has(wy)) out.push({ teknis: `Wyckoff ${wy}`, awam: 'pola grafik cenderung turun', kind: 'bad' })

  const vpa = v(row.metrics.vpa)?.latest
  if (vpa && AWAM_VPA[vpa.signal]) {
    out.push({ teknis: `${vpa.signal} ${vpa.date.slice(5)}`, awam: AWAM_VPA[vpa.signal]!, kind: 'bad' })
  }

  if (v(row.metrics.structure)?.daily.phase === 'rebound') {
    out.push({ teknis: 'rebound dlm downtrend', awam: 'naik sesaat di tren turun', kind: 'warn' })
  }
  if (v(row.metrics.filters)?.obvDivergence === 'bearish') {
    out.push({ teknis: 'OBV bearish', awam: 'aliran volume melemah', kind: 'warn' })
  }

  const baca = v(row.metrics.volume)?.classification
  if (baca && AWAM_VOLUME[baca]) out.push({ teknis: baca, awam: AWAM_VOLUME[baca]!, kind: 'warn' })

  const rr = v(row.metrics.riskReward)?.ratio
  if (typeof rr === 'number' && rr < 1) {
    out.push({ teknis: `R:R 1:${angka(rr)}`, awam: 'potensi untung lebih kecil dari risiko rugi', kind: 'warn' })
  }
  return out
}

export function labelRisiko(catatan: Catatan[]): Label {
  return catatan.length === 0 ? 'bersih' : 'hati-hati'
}
