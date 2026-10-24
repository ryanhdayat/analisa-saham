import { expect, test, describe } from 'bun:test'
import { buildBeranda, loadBerandaTemplate } from './beranda.ts'

describe('buildBeranda', async () => {
  const html = buildBeranda(await loadBerandaTemplate())

  test('navigasi menandai Beranda', () => {
    expect(html).toMatch(/<a href="\.\/" aria-current="page">Beranda<\/a>/)
  })

  test('ajakan utama menuju rencana hari ini', () => {
    expect(html).toMatch(/<a [^>]*href="idx\/"[^>]*>Lihat rencana hari ini<\/a>/)
  })

  test('membaca status simulasi dan tanggal data saat dibuka', () => {
    expect(html).toContain("'hasil/hasil.json'")
    expect(html).toContain('terbit.json')
  })

  test('tanpa placeholder tersisa', () => {
    expect(html).not.toMatch(/__[A-Z]+__/)
  })
})
