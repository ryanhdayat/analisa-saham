import { floorToTick, idxTickSize } from '../analysis/levels.ts'
import { cutLoss } from '../hasil/nilai.ts'
import { SHARES_PER_LOT } from '../market.ts'

/**
 * Rencana harian untuk pemula: harga beli, jumlah lot, jual rugi, jual untung.
 *
 * Satu sumber hitungan untuk kartu "Rencana hari ini" dan simulasi di /hasil/ —
 * angka yang dilihat harus sama dengan angka yang dinilai.
 */

/** Sama dengan modal Stockbit Demo Virtual Trading. */
export const MODAL_BAWAAN = 100_000_000
/** Rugi maksimal per saham, pecahan modal. */
export const RISIKO_PER_SAHAM = 0.01
/** Nilai posisi maksimal per saham, pecahan modal. */
export const BATAS_PER_SAHAM = 0.2
/**
 * Biaya transaksi, pecahan nilai transaksi. Angka umum broker online; cocokkan
 * dengan tarif Stockbit yang berlaku sebelum mengandalkan hasil rupiahnya.
 */
export const BIAYA_BELI = 0.0015
export const BIAYA_JUAL = 0.0025

export interface Rencana {
  /** Harga Buy limit: close terakhir. */
  beli: number
  /** Jual kalau turun ke sini: cut loss evaluasi, dibulatkan ke bawah ke fraksi BEI. */
  jualRugi: number
  /** Jual kalau naik ke sini: target, dibulatkan ke bawah ke fraksi BEI. */
  jualUntung: number
  lot: number
  /** Nilai beli, rupiah. */
  nilai: number
  /** Hasil kalau kena jual rugi, rupiah, sudah dipotong biaya (negatif). */
  rugiRp: number
  /** Hasil kalau kena jual untung, rupiah, sudah dipotong biaya. */
  untungRp: number
}

/** Biaya beli + jual satu posisi, rupiah. */
export function biaya(beli: number, jual: number, lot: number): number {
  return lot * SHARES_PER_LOT * (beli * BIAYA_BELI + jual * BIAYA_JUAL)
}

/** Return satu transaksi setelah biaya, pecahan. */
export function returnBersih(beli: number, jual: number): number {
  return (jual * (1 - BIAYA_JUAL)) / (beli * (1 + BIAYA_BELI)) - 1
}

/**
 * Lot terbanyak yang memenuhi dua batas: rugi sampai jual-rugi ≤ 1% modal, dan
 * nilai posisi ≤ 20% modal. 0 berarti modal tidak sah atau terlalu kecil.
 *
 * Salinannya ada di screener-template.html (penanda hitungLot) dan dites sama.
 */
export function hitungLot(beli: number, jualRugi: number, modal: number): number {
  if (!Number.isFinite(modal) || modal <= 0 || !(beli > jualRugi)) return 0
  const lotRisiko = Math.floor((modal * RISIKO_PER_SAHAM) / ((beli - jualRugi) * SHARES_PER_LOT))
  const lotBatas = Math.floor((modal * BATAS_PER_SAHAM) / (beli * SHARES_PER_LOT))
  return Math.max(0, Math.min(lotRisiko, lotBatas))
}

export function rencanaIdx(entry: number, stop: number, target: number, modal = MODAL_BAWAAN): Rencana {
  const beli = entry
  const jualRugi = floorToTick(cutLoss(entry, stop))
  // Target kurang dari satu fraksi di atas harga beli terbulatkan ke harga beli itu sendiri —
  // "jual untung" yang rugi setelah biaya. Paling dekat satu fraksi di atas harga beli.
  const jualUntung = Math.max(floorToTick(target), beli + idxTickSize(beli))
  const lot = hitungLot(beli, jualRugi, modal)
  const hasil = (jual: number) => lot * SHARES_PER_LOT * (jual - beli) - biaya(beli, jual, lot)
  return { beli, jualRugi, jualUntung, lot, nilai: lot * SHARES_PER_LOT * beli, rugiRp: hasil(jualRugi), untungRp: hasil(jualUntung) }
}
