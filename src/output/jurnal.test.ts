import { describe, expect, test } from 'bun:test'
import { buildJurnal, loadJurnalTemplate } from './jurnal.ts'
import { TEMA_CSS } from './tema.ts'
import { ambil } from './penanda.test-util.ts'

type Hitung = (e: unknown, pick: unknown) => { modal: number; keluar: number | null; rp: number | null; ret: number | null; selisihBeli: number | null }

describe('halaman jurnal', async () => {
  const html = buildJurnal(await loadJurnalTemplate())
  const hitung = ambil<Hitung>(html, 'hitung')

  test('tema dan navigasi ditanam, jurnal aktif, tidak diindeks', () => {
    expect(html).not.toMatch(/__TEMA__|__NAV__|__FONT__/)
    expect(html).toContain(TEMA_CSS.slice(0, 40))
    expect(html).toMatch(/<a href="\.\.\/jurnal\/" aria-current="page">/)
    expect(html).toContain('<meta name="robots" content="noindex">')
  })

  // Angka rekaan. 10 lot = 1.000 lembar.
  const beli = { kode: 'ABCD', beli: { tanggal: '2026-01-06', harga: 1000, lot: 10 }, jual: null }
  const pick = { entry: 1010, last: { date: '2026-01-07', close: 1050 } }

  test('modal: nilai beli ditambah biaya beli 0,20%', () => {
    expect(hitung(beli, pick).modal).toBeCloseTo(1_002_000, 6)
  })
  test('terbuka: dinilai di close terakhir, setelah biaya jual 0,30%', () => {
    const h = hitung(beli, pick)
    expect(h.keluar).toBe(1050)
    expect(h.rp).toBeCloseTo(1_050_000 * 0.997 - 1_002_000, 6) // +44.850
    expect(h.selisihBeli).toBeCloseTo(1000 / 1010 - 1, 10)
  })
  test('selesai: harga jual menang atas close', () => {
    const h = hitung({ ...beli, jual: { tanggal: '2026-01-08', harga: 1100 } }, pick)
    expect(h.keluar).toBe(1100)
    expect(h.rp).toBeCloseTo(1_100_000 * 0.997 - 1_002_000, 6) // +94.700
    expect(h.ret).toBeCloseTo(94_700 / 1_002_000, 10)
  })
  test('di luar rencana tanpa jual: belum ada harga', () => {
    const h = hitung(beli, undefined)
    expect(h.rp).toBeNull()
    expect(h.selisihBeli).toBeNull()
  })
})
