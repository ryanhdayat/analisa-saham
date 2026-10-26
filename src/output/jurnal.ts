import { readFile } from 'node:fs/promises'
import { tanamTema } from './tema.ts'

/**
 * Halaman jurnal pribadi. Kosong saat dibangun: entri dibaca peramban dari
 * /api/jurnal setelah masuk, rencana dari `hasil/hasil.json`.
 */
export function buildJurnal(template: string): string {
  return tanamTema(template, 'jurnal', '../')
}

export async function loadJurnalTemplate(): Promise<string> {
  return readFile(new URL('./jurnal-template.html', import.meta.url), 'utf8')
}
