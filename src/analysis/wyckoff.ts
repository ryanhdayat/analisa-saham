import { metric, unavailable, type Confidence, type Metric } from './metric.ts'
import type { StructureRead } from './structure.ts'
import type { FiltersRead } from './filters.ts'
import type { VpaRead } from './vpa.ts'

export type WyckoffPhase = 'akumulasi' | 'markup' | 'distribusi' | 'markdown' | 'tidak-jelas'

export interface WyckoffRead {
  phase: WyckoffPhase
  /** Alasan yang membuat fase ini dipilih. */
  reasons: string[]
}

const SARAN: Record<WyckoffPhase, string> = {
  akumulasi: 'akumulasi — layak diawasi, tapi tunggu markup terkonfirmasi',
  markup: 'markup — satu-satunya fase yang nyaman untuk posisi beli',
  distribusi: 'distribusi — barang sedang dilepas, hindari beli',
  markdown: 'markdown — tren turun, jangan menangkap pisau',
  'tidak-jelas': 'tidak jelas — struktur belum memberi tahu apa pun',
}

/**
 * Fase Wyckoff. **Metrik paling lemah di antara dua belas**, sengaja dibatasi.
 *
 * Praktisi berpengalaman bisa berbeda pendapat soal fase pada grafik yang sama.
 * Aturan di sini menyederhanakan penilaian yang sesungguhnya bertumpu pada
 * konteks, jadi:
 *
 * - keyakinan **tidak pernah `tinggi`** kecuali seluruh syarat sejalan;
 * - hasilnya **tidak pernah ikut memengaruhi peringkat** (lihat `report.ts`);
 * - vonisnya selalu menyebut bahwa ini tafsir, bukan fakta.
 *
 * Kalau modul ini terasa terlalu ragu-ragu, itu memang disengaja.
 */
export function analyzeWyckoff(
  structure: StructureRead | null,
  filters: FiltersRead | null,
  vpa: VpaRead | null,
  close: number,
  rangeCompressing: boolean,
): Metric<WyckoffRead> {
  if (!structure) return unavailable('Struktur harga belum terbaca, fase tidak bisa ditebak.')

  const s = structure.daily.structure
  const signals = new Set((vpa?.events ?? []).map((e) => e.signal))
  const reasons: string[] = []

  let phase: WyckoffPhase = 'tidak-jelas'
  let sejalanPenuh = false

  if (s === 'uptrend' && filters && close > filters.ma50) {
    phase = 'markup'
    reasons.push(`Struktur uptrend dan harga ${Math.round(close)} di atas MA 50 ${Math.round(filters.ma50)}.`)
    sejalanPenuh = filters.stacked && structure.aligned
    if (sejalanPenuh) reasons.push('MA 20/50/200 tersusun rapi dan mingguan sejalan.')
  } else if (s === 'downtrend' && filters && close < filters.ma50) {
    phase = 'markdown'
    reasons.push(`Struktur downtrend dan harga ${Math.round(close)} di bawah MA 50 ${Math.round(filters.ma50)}.`)
    sejalanPenuh = !filters.stacked && structure.aligned
  } else if (s === 'sideways' && signals.has('upthrust')) {
    phase = 'distribusi'
    reasons.push('Sideways disertai upthrust — indikasi barang dilepas.')
  } else if (s === 'sideways' && (signals.has('spring') || signals.has('stopping-volume'))) {
    phase = 'akumulasi'
    reasons.push(
      signals.has('spring') ? 'Sideways disertai spring.' : 'Sideways disertai stopping volume.',
    )
    if (rangeCompressing) reasons.push('Rentang harian menyempit — ATR menurun.')
  } else {
    reasons.push(`Struktur ${s} tanpa penanda VPA yang mengarahkan ke fase tertentu.`)
  }

  // Batas keras: tanpa seluruh syarat sejalan, keyakinan tidak pernah melewati sedang.
  const confidence: Confidence =
    phase === 'tidak-jelas' ? 'rendah' : sejalanPenuh ? 'tinggi' : 'sedang'

  return metric(
    { phase, reasons },
    `${SARAN[phase]} — tafsir, bukan fakta; fase Wyckoff subjektif dan tidak ikut memeringkat`,
    confidence,
    reasons,
  )
}
