import { expect, test, describe } from 'bun:test'
import { navHtml, SKRIP_BASI, TEMA_CSS } from './tema.ts'
import { buildScreener, loadTemplate } from './screener.ts'
import { buildHasilPage, loadHasilTemplate } from './hasil-page.ts'
import { IDX } from '../market.ts'
import { summarize } from '../hasil/nilai.ts'
import { ambil } from './penanda.test-util.ts'

describe('dataBasi', () => {
  const basi = ambil<(t: string, p: string, now: Date) => boolean>(SKRIP_BASI, 'dataBasi')

  test('IDX: Jumat pagi dengan data Kamis → segar', () => {
    expect(basi('2026-10-22', 'idx', new Date('2026-10-23T00:15:00Z'))).toBe(false)
  })
  test('IDX: Senin pagi dengan data Kamis → basi', () => {
    expect(basi('2026-10-22', 'idx', new Date('2026-10-26T00:15:00Z'))).toBe(true)
  })
  test('IDX: Senin pagi dengan data Jumat → segar', () => {
    expect(basi('2026-10-23', 'idx', new Date('2026-10-26T00:15:00Z'))).toBe(false)
  })
  test('IDX: hari kerja setelah 16:15 WIB mengharapkan data hari itu', () => {
    expect(basi('2026-10-22', 'idx', new Date('2026-10-23T10:00:00Z'))).toBe(true)
  })
  test('crypto: data kemarin (UTC) → segar; lebih tua → basi', () => {
    expect(basi('2026-10-22', 'crypto', new Date('2026-10-23T05:00:00Z'))).toBe(false)
    expect(basi('2026-10-22', 'crypto', new Date('2026-10-24T05:00:00Z'))).toBe(true)
  })
})

describe('navHtml', () => {
  test('halaman aktif ditandai, tautan relatif ke akar', () => {
    const html = navHtml('hasil', '../')
    expect(html).toMatch(/<a href="\.\.\/hasil\/" aria-current="page">/)
    expect(html).toContain('href="../idx/"')
    expect(html).toContain('href="../"')
  })
  test('beranda di akar memakai ./', () => {
    expect(navHtml('beranda', '')).toMatch(/<a href="\.\/" aria-current="page">/)
  })
})

describe('tema ditanam di semua halaman', async () => {
  const screener = buildScreener([], new Map(), await loadTemplate(), IDX, { minValue: 5e9, minRatio: 0 }).html
  const hasil = buildHasilPage([{ id: 'idx', label: 'Saham IDX', currency: 'IDR', picks: [], ringkasan: summarize([]), gagal: [] }], await loadHasilTemplate(), new Date())
  for (const [nama, html] of [['screener', screener], ['hasil', hasil]] as const) {
    test(`${nama}: tanpa placeholder tersisa, tema dan navigasi ada`, () => {
      expect(html).not.toMatch(/__TEMA__|__NAV__|__BASI__/)
      expect(html).toContain(TEMA_CSS.slice(0, 40))
      expect(html).toContain('aria-label="Navigasi situs"')
      expect(html).toContain('function dataBasi')
    })
  }
})
