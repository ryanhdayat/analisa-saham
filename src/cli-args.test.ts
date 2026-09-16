import { expect, test, describe } from 'bun:test'
import { parseArgs, parseScanArgs, parseWatchlist } from './cli-args.ts'

describe('parseWatchlist', () => {
  test('satu kode per baris, huruf besar', () => {
    expect(parseWatchlist('bbca\nBBRI\ntlkm')).toEqual(['BBCA', 'BBRI', 'TLKM'])
  })

  test('baris kosong dan komentar diabaikan', () => {
    expect(parseWatchlist('# watchlist\n\nBBCA\n   \n# catatan\nBBRI\n')).toEqual(['BBCA', 'BBRI'])
  })

  test('komentar di ujung baris dipangkas', () => {
    expect(parseWatchlist('BBCA # bank terbesar')).toEqual(['BBCA'])
  })

  test('duplikat dibuang, urutan pertama dipertahankan', () => {
    expect(parseWatchlist('BBCA\nBBRI\nBBCA')).toEqual(['BBCA', 'BBRI'])
  })

  test('berkas kosong menghasilkan daftar kosong', () => {
    expect(parseWatchlist('\n\n# cuma komentar\n')).toEqual([])
  })
})

describe('parseArgs', () => {
  test('tanpa argumen memakai nilai bawaan dan belum punya kode', () => {
    const a = parseArgs([])
    expect(a.codes).toEqual([])
    expect(a.days).toBe(250)
    expect(a.rows).toBe(24)
    expect(a.outDir).toBe('out')
  })

  test('argumen posisional jadi daftar kode, dihuruf-besarkan', () => {
    expect(parseArgs(['bbca', 'BBRI']).codes).toEqual(['BBCA', 'BBRI'])
  })

  test('--days mengatur panjang jendela tampil', () => {
    expect(parseArgs(['BBCA', '--days', '120']).days).toBe(120)
  })

  test('--rows mengatur jumlah baris profil volume', () => {
    expect(parseArgs(['--rows', '12']).rows).toBe(12)
  })

  test('--out mengatur direktori keluaran', () => {
    expect(parseArgs(['--out', 'charts']).outDir).toBe('charts')
  })

  test('--svg menyimpan SVG di samping PNG', () => {
    expect(parseArgs([]).keepSvg).toBe(false)
    expect(parseArgs(['--svg']).keepSvg).toBe(true)
  })

  test('--watchlist mengarahkan ke berkas daftar lain', () => {
    expect(parseArgs([]).watchlist).toBe('watchlist.txt')
    expect(parseArgs(['--watchlist', 'bank.txt']).watchlist).toBe('bank.txt')
  })

  test('--days bukan angka ditolak dengan pesan jelas', () => {
    expect(() => parseArgs(['--days', 'banyak'])).toThrow(/--days/)
  })

  test('--days nol atau negatif ditolak', () => {
    expect(() => parseArgs(['--days', '0'])).toThrow(/--days/)
  })

  test('opsi tanpa nilai ditolak, tidak diam-diam menelan kode berikutnya', () => {
    expect(() => parseArgs(['--days'])).toThrow(/--days/)
  })

  test('opsi tak dikenal ditolak, bukan dianggap kode emiten', () => {
    expect(() => parseArgs(['--zoom'])).toThrow(/--zoom/)
  })
})

describe('parseScanArgs', () => {
  test('nilai bawaan: 250 hari, ambang Rp 5 M, R:R 1:2, IDX menyala', () => {
    const a = parseScanArgs([])
    expect(a.days).toBe(250)
    expect(a.minValue).toBe(5e9)
    expect(a.minRatio).toBe(2)
    expect(a.useIdx).toBe(true)
  })

  test('--min-likuiditas dibaca dalam miliar rupiah', () => {
    expect(parseScanArgs(['--min-likuiditas', '20']).minValue).toBe(20e9)
  })

  test('--min-rr mengubah ambang risk reward', () => {
    expect(parseScanArgs(['--min-rr', '3']).minRatio).toBe(3)
  })

  test('--tanpa-idx mematikan lapisan pengaya', () => {
    expect(parseScanArgs(['--tanpa-idx']).useIdx).toBe(false)
  })

  test('--hari-idx mengatur panjang riwayat aliran asing', () => {
    expect(parseScanArgs(['--hari-idx', '30']).idxDays).toBe(30)
  })

  test('kode posisional tetap menang atas watchlist', () => {
    expect(parseScanArgs(['bbca', 'bbri']).codes).toEqual(['BBCA', 'BBRI'])
  })

  test('nilai pecahan diterima untuk ambang, bukan hanya bilangan bulat', () => {
    expect(parseScanArgs(['--min-rr', '1.5']).minRatio).toBe(1.5)
    expect(parseScanArgs(['--min-likuiditas', '0.5']).minValue).toBe(0.5e9)
  })

  test('ambang negatif atau nol ditolak', () => {
    expect(() => parseScanArgs(['--min-rr', '0'])).toThrow(/--min-rr/)
    expect(() => parseScanArgs(['--min-likuiditas', '-1'])).toThrow(/--min-likuiditas/)
  })

  test('opsi tak dikenal ditolak, bukan dianggap kode emiten', () => {
    expect(() => parseScanArgs(['--ngawur'])).toThrow(/--ngawur/)
  })
})
