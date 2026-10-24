import { expect, test, describe } from 'bun:test'
import { MIN_TRANSAKSI, posisi, ringkasSimulasi } from './simulasi.ts'
import { biaya, returnBersih } from './rencana.ts'
import { judgeIdx, type Pilihan } from '../hasil/nilai.ts'
import type { Bar } from '../types.ts'

const bar = (date: string, low: number, high: number, close = (low + high) / 2, open = close): Bar => ({ date, open, high, low, close, volume: 1 })
const pilihan = (over: Partial<Pilihan> = {}): Pilihan => ({
  code: 'BBCA', name: 'BCA', date: '2026-10-01', entry: 1000, stop: 920, target: 1200, label: 'bersih', ...over,
})
// Terisi di 990 pada 10-02.
const isi = bar('2026-10-02', 980, 1010, 1000, 990)
const kenaTarget = (over: Partial<Pilihan> = {}) => judgeIdx(pilihan(over), [isi, bar('2026-10-03', 1100, 1210)])
const kenaCut = (over: Partial<Pilihan> = {}) => judgeIdx(pilihan(over), [isi, bar('2026-10-03', 900, 1000)])
const terbuka = () => judgeIdx(pilihan(), [isi])

describe('posisi', () => {
  test('kena target: rupiah = lot × 100 × (keluar − isi) − biaya', () => {
    // lot = min(floor(1 jt / (80 × 100)), floor(20 jt / (1000 × 100))) = 125
    const p = posisi(kenaTarget())!
    expect(p.lot).toBe(125)
    expect(p.rp).toBeCloseTo(125 * 100 * (1200 - 990) - biaya(990, 1200, 125), 6)
    expect(p.retBersih).toBeCloseTo(returnBersih(990, 1200), 9)
  })

  test('tidak terbeli → tanpa posisi', () => {
    expect(posisi(judgeIdx(pilihan(), [bar('2026-10-02', 1010, 1050, 1040, 1020)]))).toBeNull()
  })

  test('terbuka dinilai di close terakhir', () => {
    expect(posisi(terbuka())!.rp).toBeCloseTo(125 * 100 * (1000 - 990) - biaya(990, 1000, 125), 6)
  })
})

describe('ringkasSimulasi', () => {
  test(`kurang dari ${MIN_TRANSAKSI} transaksi selesai → kurang-data`, () => {
    expect(ringkasSimulasi(Array.from({ length: 29 }, () => kenaTarget())).status).toBe('kurang-data')
  })

  test('30 transaksi, rata-rata positif → lulus', () => {
    expect(ringkasSimulasi(Array.from({ length: 30 }, () => kenaTarget())).status).toBe('lulus')
  })

  test('30 transaksi, rata-rata negatif → belum-lulus', () => {
    expect(ringkasSimulasi(Array.from({ length: 30 }, () => kenaCut())).status).toBe('belum-lulus')
  })

  test('yang masih terbuka tidak dihitung selesai, tapi ikut total rupiah', () => {
    const s = ringkasSimulasi([kenaTarget(), terbuka()])
    expect(s.selesai).toBe(1)
    expect(s.totalRp).toBeCloseTo(posisi(kenaTarget())!.rp + posisi(terbuka())!.rp, 6)
  })

  test('dilewati dan tidak terbeli dihitung terpisah', () => {
    const s = ringkasSimulasi([
      judgeIdx(pilihan(), [bar('2026-10-02', 1190, 1250, 1220, 1210)]),
      judgeIdx(pilihan(), [bar('2026-10-02', 1010, 1050, 1040, 1020)]),
    ])
    expect(s).toMatchObject({ selesai: 0, dilewati: 1, tidakTerbeli: 1, rataBersih: null, status: 'kurang-data' })
  })

  test('kelompok per label; pilihan lama tanpa label masuk tanpa-label', () => {
    const s = ringkasSimulasi([kenaTarget(), kenaCut({ label: 'hati-hati' }), kenaCut({ label: undefined })])
    expect(s.perLabel.bersih).toMatchObject({ n: 1, target: 1, cut: 0 })
    expect(s.perLabel['hati-hati']).toMatchObject({ n: 1, target: 0, cut: 1 })
    expect(s.perLabel['tanpa-label']).toMatchObject({ n: 1, cut: 1 })
    expect(s.modal).toBe(100_000_000)
  })
})
