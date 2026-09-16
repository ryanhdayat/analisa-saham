/** Tingkat keyakinan sebuah pembacaan. Dicetak apa adanya di keluaran. */
export type Confidence = 'rendah' | 'sedang' | 'tinggi'

/**
 * Amplop seragam untuk tiap metrik.
 *
 * Alasannya satu: tidak boleh ada angka telanjang tanpa alasannya. Metrik yang
 * hanya mengembalikan angka memaksa pembaca percaya begitu saja; `evidence`
 * membuat tiap vonis bisa dibantah dengan melihat tanggal dan angkanya.
 *
 * `available: false` berarti SUMBER DATANYA tidak ada — bukan nilainya nol.
 * Membedakan keduanya penting: net asing nol artinya asing tidak bergerak;
 * net asing tidak tersedia artinya kita tidak tahu.
 */
export interface Metric<T> {
  value: T | null
  verdict: string
  confidence: Confidence
  evidence: string[]
  available: boolean
  /** Diisi kalau nilainya berasal dari cache, bukan tarikan baru. */
  staleness?: { asOf: string; daysOld: number }
}

export function unavailable<T>(reason: string): Metric<T> {
  return { value: null, verdict: reason, confidence: 'rendah', evidence: [], available: false }
}

export function metric<T>(
  value: T,
  verdict: string,
  confidence: Confidence,
  evidence: string[] = [],
): Metric<T> {
  return { value, verdict, confidence, evidence, available: true }
}
