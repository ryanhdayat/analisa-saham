import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildJurnal, loadJurnalTemplate } from './output/jurnal.ts'

/**
 * Tulis halaman jurnal ke jalur yang diberikan.
 *
 *   bun run src/jurnal.ts situs/jurnal/index.html
 */
const tujuan = process.argv[2]
if (!tujuan) {
  console.error('Pakai: bun run src/jurnal.ts <jalur index.html>')
  process.exit(1)
}
await mkdir(dirname(tujuan), { recursive: true })
await writeFile(tujuan, buildJurnal(await loadJurnalTemplate()))
console.log(`Jurnal: ${tujuan}`)
