import { writeFile } from 'node:fs/promises'
import { buildBeranda, loadBerandaTemplate } from './output/beranda.ts'

/**
 * Tulis halaman depan situs ke jalur yang diberikan.
 *
 *   bun run src/beranda.ts situs/index.html
 */
const tujuan = process.argv[2]
if (!tujuan) {
  console.error('Pakai: bun run src/beranda.ts <jalur index.html>')
  process.exit(1)
}
await writeFile(tujuan, buildBeranda(await loadBerandaTemplate()))
console.log(`Beranda: ${tujuan}`)
