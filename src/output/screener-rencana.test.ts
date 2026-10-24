import { expect, test, describe } from 'bun:test'
import { loadTemplate } from './screener.ts'
import { BIAYA_BELI, BIAYA_JUAL, hitungLot } from '../rencana/rencana.ts'
import { ambil } from './penanda.test-util.ts'

describe('screener-template: rencana hari ini', async () => {
  const template = await loadTemplate()

  test('salinan hitungLot di halaman sama persis dengan modul', () => {
    const diHalaman = ambil<typeof hitungLot>(template, 'hitungLot')
    const kasus: [number, number, number][] = [
      [2100, 1995, 1e8], [11375, 10550, 1e8], [11375, 10550, 1e6], [50, 47, 5e6],
      [2100, 1995, 0], [2100, 1995, NaN], [2100, 1995, -1], [2100, 2100, 1e8], [1155, 1080, 37_500_000],
    ]
    for (const [b, r, m] of kasus) expect(diHalaman(b, r, m)).toBe(hitungLot(b, r, m))
  })

  test('biaya di halaman sama dengan modul', () => {
    expect(ambil<{ beli: number; jual: number }>(template, 'BIAYA')).toEqual({ beli: BIAYA_BELI, jual: BIAYA_JUAL })
  })

  test('hari tanpa saham lolos punya teks sendiri', () => {
    expect(template).toContain('Tidak ada rencana hari ini')
  })

  test('menyebut masa simulasi dan bukan perintah beli', () => {
    expect(template).toContain('Stockbit Virtual Trading')
    expect(template).toContain('bukan perintah beli')
  })

  test('modal tidak terbaca punya pesan, tidak menampilkan NaN', () => {
    expect(template).toContain('Modal tidak terbaca')
  })
})
