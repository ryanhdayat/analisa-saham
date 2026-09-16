import type { Browser } from 'playwright-core'

/**
 * Penangkap SVG jadi PNG. Satu browser dipakai ulang untuk seluruh watchlist —
 * meluncurkan Chrome per emiten menghabiskan waktu lebih lama daripada
 * menggambarnya.
 *
 * Memakai Google Chrome yang sudah terpasang lewat `channel: 'chrome'`, sama
 * seperti `01-app1`, supaya tidak perlu mengunduh browser terpisah.
 */
export class SvgShooter {
  private browser: Browser | null = null

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser

    let chromium: typeof import('playwright-core').chromium
    try {
      ;({ chromium } = await import('playwright-core'))
    } catch {
      throw new Error('playwright-core tidak terpasang. Jalankan `bun add playwright-core`.')
    }

    try {
      this.browser = await chromium.launch({ channel: 'chrome', headless: true })
    } catch (err) {
      throw new Error(
        'Gagal meluncurkan Google Chrome (channel: "chrome"). Pastikan Google Chrome ' +
          `terpasang di path standar. Detail: ${String(err)}`,
      )
    }
    return this.browser
  }

  /**
   * Muat SVG lewat `data:` URL supaya tidak ada berkas sementara yang tertinggal,
   * lalu tangkap elemen SVG-nya — bukan viewport — supaya ukuran PNG persis sama
   * dengan ukuran gambar dan tidak ada tepi putih.
   */
  async shoot(svg: string, outPath: string, width: number, height: number): Promise<void> {
    const browser = await this.ensureBrowser()
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    })
    try {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8">` +
          `<style>html,body{margin:0;padding:0;background:#131722}svg{display:block}</style>` +
          `</head><body>${svg}</body></html>`,
        { waitUntil: 'load' },
      )
      const element = await page.$('svg')
      if (!element) throw new Error('SVG tidak ditemukan di halaman.')
      await element.screenshot({ path: outPath, type: 'png' })
    } finally {
      await page.close()
    }
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = null
  }
}
