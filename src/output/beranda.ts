import { readFile } from 'node:fs/promises'
import { tanamTema } from './tema.ts'

/**
 * Halaman depan situs. Tidak membawa data: tanggal terbitan dan status simulasi
 * dibaca peramban dari berkas terbit.json tiap bagian dan `hasil/hasil.json` saat dibuka.
 */
export function buildBeranda(template: string): string {
  return tanamTema(template, 'beranda', '')
}

export async function loadBerandaTemplate(): Promise<string> {
  return readFile(new URL('./beranda-template.html', import.meta.url), 'utf8')
}
