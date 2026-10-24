/**
 * Utilitas tes: ambil fungsi bertanda `/*<nama>*\/ … /*</nama>*\/` dari teks
 * skrip halaman, lalu jalankan. Dipakai untuk membuktikan salinan rumus di
 * template sama dengan modul TypeScript-nya.
 */
export function ambil<T>(teks: string, nama: string): T {
  const m = teks.match(new RegExp(`/\\*<${nama}>\\*/([\\s\\S]*?)/\\*</${nama}>\\*/`))
  if (!m) throw new Error(`penanda ${nama} tidak ditemukan`)
  return new Function(`${m[1]}; return ${nama}`)() as T
}
