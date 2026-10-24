/**
 * Tema dan navigasi bersama untuk semua halaman situs (beranda, IDX, crypto,
 * hasil). Ditanam ke tiap template saat halaman dibangun, supaya tiap halaman
 * tetap satu berkas utuh tanpa CSS eksternal.
 *
 * Arah visual: meja kerja harian yang tenang — latar abu dingin, satu aksen
 * teal, naik/turun hijau/merah. Angka memakai IBM Plex Sans dengan digit
 * tabular, bukan monospace; judul dan angka besar memakai Archivo yang
 * dipadatkan.
 */

export type Halaman = 'beranda' | 'idx' | 'crypto' | 'hasil'

export const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=IBM+Plex+Sans:wght@400;500;600&display=swap">'

const TERANG = `
  --bg: #eef1f4; --surface: #ffffff; --sunk: #f6f8fa; --ink: #16202b; --muted: #5b6875; --line: #d9e0e7;
  --accent: #0e6b73; --accent-soft: #dcefef;
  --up: #12805c; --up-soft: #ddf1e8; --down: #c0392b; --down-soft: #f8e1de; --warn: #a56a12; --warn-soft: #f6ead3;
  --ma20: #c27c0e; --ma50: #2f6fd0; --ma200: #8a4fbf;`
const GELAP = `
  --bg: #0e141a; --surface: #151d25; --sunk: #111820; --ink: #e2e8ee; --muted: #93a1ae; --line: #25313c;
  --accent: #56b8c0; --accent-soft: #163338;
  --up: #3dbb8a; --up-soft: #12302a; --down: #ef7362; --down-soft: #3a1e1c; --warn: #e3a74c; --warn-soft: #3a2c15;
  --ma20: #e0a23a; --ma50: #6ea2f0; --ma200: #b88ae6; color-scheme: dark;`

export const TEMA_CSS = `/* tema bersama — src/output/tema.ts */
:root {${TERANG}
  --font-display: "Archivo", "Arial Narrow", system-ui, sans-serif;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-data: var(--font-body);
  --radius: 10px;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${GELAP} } }
:root[data-theme="dark"] {${GELAP} }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.5; }
.num, td.n { font-variant-numeric: tabular-nums; }
a { color: var(--accent); }
button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible, summary:focus-visible, th:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.up { color: var(--up); } .down { color: var(--down); } .mut { color: var(--muted); }

nav.situs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px max(16px, env(safe-area-inset-left, 0px)) 0;
  max-width: 1180px; margin: 0 auto; }
nav.situs .merek { font: 800 17px/1 var(--font-display); font-stretch: 85%; color: var(--ink); text-decoration: none; margin-right: auto; }
nav.situs .tautan { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
nav.situs .tautan a { padding: 6px 12px; border-radius: 99px; color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 500; white-space: nowrap; }
nav.situs .tautan a:hover { color: var(--ink); background: var(--surface); }
nav.situs .tautan a[aria-current="page"] { background: var(--ink); color: var(--bg); }

.kepala { display: grid; gap: 6px; }
.kepala h1 { font-family: var(--font-display); font-stretch: 80%; font-weight: 800; font-size: clamp(30px, 6vw, 46px); line-height: 1; margin: 0; letter-spacing: -.015em; text-wrap: balance; }
.kepala .status { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; color: var(--muted); font-size: 14px; }
.lencana { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 99px; font-size: 13px; font-weight: 500; background: var(--accent-soft); color: var(--accent); }
.lencana.basi { background: var(--warn-soft); color: var(--warn); }
.lencana.simulasi::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
`

/** Navigasi situs. `akar` adalah jalur relatif ke akar situs: '' di beranda, '../' di halaman bagian. */
export function navHtml(aktif: Halaman, akar: string): string {
  const root = akar || './'
  const tautan: [Halaman, string, string][] = [
    ['beranda', root, 'Beranda'],
    ['idx', `${akar}idx/`, 'Rencana IDX'],
    ['crypto', `${akar}crypto/`, 'Crypto'],
    ['hasil', `${akar}hasil/`, 'Hasil'],
  ]
  const a = tautan
    .map(([id, href, teks]) => `<a href="${href}"${id === aktif ? ' aria-current="page"' : ''}>${teks}</a>`)
    .join('')
  return `<nav class="situs" aria-label="Navigasi situs"><a class="merek" href="${root}">Analisa Saham</a><div class="tautan">${a}</div></nav>`
}

/**
 * `dataBasi(tanggal, pasar, now)` dijalankan di peramban saat halaman DIBUKA,
 * bukan saat dibangun: yang penting adalah umur data bagi orang yang membacanya.
 *
 * Tanpa kalender libur bursa — di hari libur tanda ini bisa muncul padahal
 * datanya benar, dan teksnya menyebut kemungkinan itu.
 */
export const SKRIP_BASI = `/*<dataBasi>*/
function dataBasi(tanggal, pasar, now) {
  const hari = (d) => d.toISOString().slice(0, 10)
  if (pasar === 'crypto') return tanggal < hari(new Date(now.getTime() - 86400000))
  const wib = new Date(now.getTime() + 7 * 3600000)
  const menit = wib.getUTCHours() * 60 + wib.getUTCMinutes()
  const kerja = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5
  let d = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()))
  if (!(kerja(d) && menit >= 16 * 60 + 15)) {
    do { d = new Date(d.getTime() - 86400000) } while (!kerja(d))
  }
  return tanggal < hari(d)
}
/*</dataBasi>*/`

/** Isi placeholder bersama. Fungsi pengganti, supaya `$&` di teks tidak ditafsir. */
export function tanamTema(template: string, aktif: Halaman, akar: string): string {
  return template
    .replace('<!--__FONT__-->', () => FONT_LINK)
    .replace('/*__TEMA__*/', () => TEMA_CSS)
    .replace('<!--__NAV__-->', () => navHtml(aktif, akar))
    .replace('/*__BASI__*/', () => SKRIP_BASI)
}
