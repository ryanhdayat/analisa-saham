import { expect, test, describe } from 'bun:test'
import { parseArgs, parseScanArgs, parseWatchlist } from './cli-args.ts'
import { CRYPTO, IDX } from './market.ts'

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

  test('halaman HTML menyala bawaan, draft ditentukan otomatis', () => {
    const a = parseScanArgs([])
    expect(a.html).toBe(true)
    expect(a.draft).toBeNull()
  })

  test('--tanpa-html mematikan halaman screener', () => {
    expect(parseScanArgs(['--tanpa-html']).html).toBe(false)
  })

  test('--draft dan --final memaksa tanda draft', () => {
    expect(parseScanArgs(['--draft']).draft).toBe(true)
    expect(parseScanArgs(['--final']).draft).toBe(false)
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

  test('laporan CSV/Excel punya direktori sendiri, terpisah dari --out', () => {
    const a = parseScanArgs([])
    expect(a.reportDir).toBe('report')
    expect(a.outDir).toBe('out')
  })

  test('--report-dir mengatur direktori laporan', () => {
    expect(parseScanArgs(['--report-dir', 'hasil']).reportDir).toBe('hasil')
  })

  test('--report-dir tidak menggeser direktori keluaran JSON/PNG', () => {
    const a = parseScanArgs(['--report-dir', 'hasil'])
    expect(a.outDir).toBe('out')
  })

  test('--report-dir tanpa nilai ditolak', () => {
    expect(() => parseScanArgs(['--report-dir'])).toThrow(/--report-dir butuh nilai/)
    expect(() => parseScanArgs(['--report-dir', '--days'])).toThrow(/--report-dir butuh nilai/)
  })
})

describe('parseScanArgs — pasar', () => {
  test('bawaannya IDX, dan seluruh bawaan lain ikut dari sana', () => {
    const a = parseScanArgs([])
    expect(a.market).toBe(IDX)
    expect(a.watchlist).toBe('watchlist.txt')
    expect(a.outDir).toBe('out')
    expect(a.reportDir).toBe('report')
    expect(a.minValue).toBe(5e9)
  })

  test('--market crypto memindahkan seluruh bawaan ke pasar itu', () => {
    const a = parseScanArgs(['--market', 'crypto'])
    expect(a.market).toBe(CRYPTO)
    expect(a.watchlist).toBe('crypto-watchlist.txt')
    // Direktori terpisah: laporan kedua pasar sama-sama bernama scan-<tanggal>.csv.
    expect(a.outDir).toBe('out/crypto')
    expect(a.reportDir).toBe('report/crypto')
    expect(a.minValue).toBe(10e6)
  })

  test('flag eksplisit menang atas bawaan pasar', () => {
    const a = parseScanArgs(['--market', 'crypto', '--watchlist', 'lain.txt', '--report-dir', 'hasil'])
    expect(a.watchlist).toBe('lain.txt')
    expect(a.reportDir).toBe('hasil')
    expect(a.outDir).toBe('out/crypto') // yang tidak disebut tetap dari pasar
  })

  test('urutan flag tidak berpengaruh', () => {
    const depan = parseScanArgs(['--market', 'crypto', '--watchlist', 'x.txt'])
    const belakang = parseScanArgs(['--watchlist', 'x.txt', '--market', 'crypto'])
    expect(belakang.watchlist).toBe('x.txt')
    expect(belakang.market).toBe(CRYPTO)
    expect(belakang.outDir).toBe(depan.outDir)
  })

  test('ambang likuiditas dibaca dalam satuan pasarnya', () => {
    expect(parseScanArgs(['--min-likuiditas', '5']).minValue).toBe(5e9)
    expect(parseScanArgs(['--market', 'crypto', '--min-likuiditas', '5']).minValue).toBe(5e6)
  })

  test('pasar tak dikenal ditolak dan menyebut nilainya', () => {
    expect(() => parseScanArgs(['--market', 'ngawur'])).toThrow(/ngawur/)
  })

  test('--market tanpa nilai ditolak', () => {
    expect(() => parseScanArgs(['--market'])).toThrow(/--market butuh nilai/)
  })
})

describe('parseArgs — pasar', () => {
  test('bawaannya IDX', () => {
    const a = parseArgs([])
    expect(a.market).toBe(IDX)
    expect(a.outDir).toBe('out')
    expect(a.watchlist).toBe('watchlist.txt')
  })

  test('--market crypto memindahkan bawaan grafik ke pasar itu', () => {
    const a = parseArgs(['--market', 'crypto'])
    expect(a.market).toBe(CRYPTO)
    expect(a.outDir).toBe('out/crypto')
    expect(a.watchlist).toBe('crypto-watchlist.txt')
  })

  test('flag eksplisit tetap menang', () => {
    expect(parseArgs(['--market', 'crypto', '--out', 'gambar']).outDir).toBe('gambar')
  })

  test('pasar tak dikenal ditolak', () => {
    expect(() => parseArgs(['--market', 'ngawur'])).toThrow(/ngawur/)
  })
})
