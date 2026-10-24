import { biaya, MODAL_BAWAAN, rencanaIdx, returnBersih } from './rencana.ts'
import { SHARES_PER_LOT } from '../market.ts'
import type { Hasil } from '../hasil/nilai.ts'
import type { Label } from './catatan.ts'

/**
 * Simulasi rupiah atas rekam jejak IDX: seandainya setiap rencana dijalankan
 * dengan modal Rp100 juta dan lot dari rencananya. Tiap pilihan dihitung
 * sendiri-sendiri — tidak ada batas kas bersama antar posisi yang terbuka
 * bersamaan.
 */

/** Transaksi selesai minimal sebelum aturan lulus boleh menilai. */
export const MIN_TRANSAKSI = 30

export interface PosisiSim {
  lot: number
  /** Hasil rupiah setelah biaya; untuk posisi terbuka, di close terakhir. */
  rp: number
  /** Return setelah biaya, pecahan. */
  retBersih: number
}

/** Posisi simulasi satu pilihan; null kalau tidak pernah terbeli. */
export function posisi(h: Hasil): PosisiSim | null {
  if (h.isi === null) return null
  const keluar = h.exit ?? h.last?.close ?? h.isi
  const lot = rencanaIdx(h.entry, h.stop, h.target).lot
  return {
    lot,
    rp: lot * SHARES_PER_LOT * (keluar - h.isi) - biaya(h.isi, keluar, lot),
    retBersih: returnBersih(h.isi, keluar),
  }
}

export interface Kelompok {
  /** Transaksi selesai (kena target atau cut loss). */
  n: number
  target: number
  cut: number
  rataBersih: number | null
}

export type StatusLulus = 'kurang-data' | 'belum-lulus' | 'lulus'

export interface RingkasanSimulasi {
  modal: number
  selesai: number
  /** Termasuk posisi yang masih terbuka, dinilai di close terakhir. */
  totalRp: number
  /** Rata-rata return setelah biaya atas transaksi selesai. */
  rataBersih: number | null
  dilewati: number
  tidakTerbeli: number
  status: StatusLulus
  perLabel: Record<Label | 'tanpa-label', Kelompok>
}

const rata = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)

function kelompok(selesai: { h: Hasil; p: PosisiSim }[]): Kelompok {
  return {
    n: selesai.length,
    target: selesai.filter((x) => x.h.status === 'target').length,
    cut: selesai.filter((x) => x.h.status === 'cut').length,
    rataBersih: rata(selesai.map((x) => x.p.retBersih)),
  }
}

export function ringkasSimulasi(picks: Hasil[]): RingkasanSimulasi {
  const dengan = picks.flatMap((h) => {
    const p = posisi(h)
    return p ? [{ h, p }] : []
  })
  const selesai = dengan.filter((x) => x.h.status === 'target' || x.h.status === 'cut')
  const rataBersih = rata(selesai.map((x) => x.p.retBersih))
  const status: StatusLulus =
    selesai.length < MIN_TRANSAKSI ? 'kurang-data' : rataBersih! > 0 ? 'lulus' : 'belum-lulus'
  const dariLabel = (l: Label | 'tanpa-label') => selesai.filter((x) => (x.h.label ?? 'tanpa-label') === l)

  return {
    modal: MODAL_BAWAAN,
    selesai: selesai.length,
    totalRp: dengan.reduce((s, x) => s + x.p.rp, 0),
    rataBersih,
    dilewati: picks.filter((h) => h.status === 'dilewati').length,
    tidakTerbeli: picks.filter((h) => h.status === 'tidak-terbeli').length,
    status,
    perLabel: {
      bersih: kelompok(dariLabel('bersih')),
      'hati-hati': kelompok(dariLabel('hati-hati')),
      'tanpa-label': kelompok(dariLabel('tanpa-label')),
    },
  }
}
