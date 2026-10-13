# Scanner crypto lewat deskriptor pasar — desain

Tanggal: 2026-10-01
Status: disetujui, siap implementasi
Lanjutan dari: [scan analisis 12 metrik](./2026-09-16-scan-analisis-design.md)

## Masalah

Alur scan yang sudah ada hanya bisa membaca emiten IDX. Yang dibutuhkan: alur yang
sama — watchlist, bar harian dari Yahoo, 12 metrik, gerbang R:R 1:2, keluaran
CSV/Excel berperingkat — tapi untuk aset crypto.

Pertanyaannya bukan "bisa atau tidak", melainkan **berapa banyak yang harus berubah**.
Jawabannya: sedikit. Lapisan analisisnya sudah netral pasar; yang terikat IDX cuma
segelintir parameter.

## Batas ketersediaan data — hasil verifikasi

Diuji langsung 2026-10-01, bukan diasumsikan.

| Sumber | Hasil |
|---|---|
| `BTC-USD`, `ETH-USD`, `SOL-USD` di `v8/finance/chart` | **Ada**, OHLCV harian penuh, endpoint yang sama dengan `.JK` |
| Metadata bursa crypto | `fullExchangeName: CCC`, `exchangeTimezoneName: UTC`, `currency: USD` |
| `range=5d` untuk crypto | 5 bar, bukan 7 — jadi 1 bar = 1 hari **kalender**, bukan hari bursa |
| Net asing per aset | **TIDAK ADA** padanannya |
| Free float per aset | **TIDAK ADA** padanannya |
| Indeks sektor | **TIDAK ADA** padanannya |

Konsekuensi penting: tidak perlu klien HTTP baru. `fetchBars` dipakai apa adanya.

## Yang sudah netral pasar — dipakai tanpa diubah

Semua modul yang masukannya hanya `Bar[]`:

`indicators.ts`, `resample.ts`, `analysis/volume.ts`, `analysis/structure.ts`,
`analysis/levels.ts`, `analysis/filters.ts`, `analysis/volatility.ts`,
`analysis/vpa.ts`, `analysis/wyckoff.ts`, `analysis/riskreward.ts`, `chart.ts`,
`png.ts`.

`toWeekly` di `resample.ts` sudah diperiksa: pengelompokannya memakai kunci pekan ISO
dari string tanggal, **tanpa asumsi hari kerja**. Pekan crypto 7 hari ikut teresample
benar tanpa perubahan.

## Yang terikat IDX

| Lokasi | Keterikatan |
|---|---|
| `yahoo.ts:43` `toSymbol` | Menambah sufiks `.JK` kalau kode tidak memuat `.`. `BTC-USD` → `BTC-USD.JK` → 404. **Ini satu-satunya penghalang nyata.** |
| `scan.ts:17` | `^JKSE` sebagai patokan kekuatan relatif |
| `scan.ts:60` | Pembagi 250 hari bursa/tahun |
| `analysis/liquidity.ts:30` | `miliar()` mengeraskan `Rp` |
| `analysis/liquidity.ts:44` | Free float dari IDX |
| `analysis/flow.ts` | Aliran asing — khas IDX, tidak dipaksa jadi generik |
| `analysis/strength.ts` | Bar sektor dari IDX |
| `output/columns.ts` | Header `NILAI_HARIAN_RP` |
| `render.ts:345` | Footer grafik mengeraskan `.JK` |
| `idx.ts`, `idx-client.ts`, `idx-shape.ts`, `idx-types.ts` | Seluruh lapisan pengaya |

## Deskriptor pasar

Satu modul baru, `src/market.ts`:

```ts
export interface Market {
  id: 'idx' | 'crypto'
  /** Kode watchlist → simbol Yahoo. */
  toSymbol(code: string): string
  /** Patokan kekuatan relatif. */
  benchmark: string
  /** Bar per tahun, untuk menghitung `range`. */
  barsPerYear: number
  watchlist: string
  outDir: string
  reportDir: string
  /** Ambang likuiditas dalam mata uang kuotasi pasar ini. */
  minValue: number
  /** Format nilai uang untuk string bukti. */
  money(v: number): string
  /** Lapisan pengaya IDX berlaku di pasar ini. */
  hasIdxLayer: boolean
  /** Kolom peringkat yang memang bisa dihasilkan pasar ini. */
  rankColumns: readonly RankColumn[]
}
```

Dua nilai beku:

| Medan | `IDX` | `CRYPTO` |
|---|---|---|
| `toSymbol` | perilaku sekarang | pass-through huruf besar |
| `benchmark` | `^JKSE` | `BTC-USD` |
| `barsPerYear` | 250 | 365 |
| `watchlist` | `watchlist.txt` | `crypto-watchlist.txt` |
| `outDir` | `out` | `out/crypto` |
| `reportDir` | `report` | `report/crypto` |
| `minValue` | `5e9` (IDR) | `10e6` (USD) |
| `money` | `Rp x,xx M` | `$x.xx M` |
| `hasIdxLayer` | `true` | `false` |
| `rankColumns` | `trend, rs60, rvol, asing` | `trend, rs60, rvol` |

## Keputusan per bagian

### Pemetaan simbol

`toSymbol` dipanggil dari satu tempat saja (`yahoo.ts:122`), jadi perubahannya bersih.
Tanda tangannya jadi `toSymbol(code, market = IDX)`. Nilai bawaan `IDX` menjaga
pemanggil dan tes yang sudah ada tetap hijau tanpa disentuh. Penjaga awalan `^`
dipertahankan.

### Patokan dan `range`

`scan.ts` memakai `market.benchmark` dan
`ceil((days + WARMUP_BARS) / market.barsPerYear) + 1`.

Dengan `barsPerYear: 250`, hasilnya **identik** dengan sekarang untuk IDX
(`(250+200)/250 → 2`, `+1 → 3y`). Untuk crypto, 365 mencegah riwayat diambil kurang
~30%.

### Gerbang pengaya

Tidak ada mesin baru. `scan.ts:73-80` sudah punya cabang pengaya-kosong di balik
`--tanpa-idx`. Kalau `market.hasIdxLayer` bernilai `false`, ambil cabang yang sama
dengan catatan berbeda. Cabang itu sudah teruji, jadi crypto mewarisi perilaku yang
sudah jalan.

## Dua temuan yang mengubah desain

Keduanya ketemu saat memeriksa kode, bukan saat merancang di atas kertas.

### 1. Bendera `degraded` akan menyala terus

`RANK_COLUMNS` (`report.ts:23`) memuat `asing`, dan `degraded` dihitung
`used.length < RANK_COLUMNS.length` (`report.ts:140`). Crypto tidak akan pernah bisa
menghasilkan `asing`, jadi **setiap baris crypto ditandai degraded dan Excel mencetak
spanduk `PERINGATAN — peringkat TERDEGRADASI` di setiap run** — peringatan yang benar
berubah jadi derau permanen yang lama-lama diabaikan.

Perbaikan: `buildRow` menerima himpunan kolom yang diharapkan dari `options`
(bawaannya keempatnya, demi kompatibilitas), dan `degraded` dibandingkan terhadap
himpunan itu. Run crypto lengkap dengan 3 dari 3 jadi **tidak** degraded; koin yang
benar-benar kehilangan RS60 tetap ditandai. `xlsx.ts:57-62` memakai himpunan yang sama.

### 2. Nama berkas laporan bertabrakan

Laporan dinamai `scan-${tanggal}.csv`. Run crypto akan **menimpa** laporan IDX pada
tanggal yang sama, tanpa suara. Karena itu `outDir`/`reportDir` per pasar bukan
kenyamanan, melainkan syarat kebenaran — dan itu alasan kedua medan itu ada di
deskriptor.

## Mata uang di keluaran

`analyzeLiquidity` menerima parameter `money`, bawaannya formatter rupiah.
`analysis/flow.ts` dibiarkan memakai `Rp` karena aliran asing memang khas IDX.

`COLUMNS` jadi `columnsFor(market)` supaya header `NILAI_HARIAN_RP` bisa terbaca
`NILAI_HARIAN_USD` untuk crypto. Ini perubahan mekanis terbesar dalam desain — tiga
tempat pemanggilan (tabel terminal, CSV, Excel) — tapi CSV yang melabeli dolar sebagai
rupiah adalah jenis kesalahan diam yang justru ingin dihindari.

## CLI

`--market idx|crypto`, bawaannya `idx` sehingga tidak ada perilaku lama yang berubah.
Pasar memasok bawaan untuk watchlist, kedua direktori keluaran, dan `minValue`; flag
eksplisit tetap menang. `render.ts:345` memakai simbol hasil resolusi, bukan
`${code}.JK`.

## Rencana pengujian

TDD per modul:

| Berkas | Yang diuji |
|---|---|
| `market.test.ts` | Pemetaan simbol dua pasar, hitungan `range`, medan deskriptor |
| `yahoo.test.ts` | `BTC-USD` lewat tanpa sufiks; `bbca` tetap `BBCA.JK` |
| `liquidity.test.ts` | Formatter disuntikkan; ambang USD |
| `report.test.ts` | `degraded` terhadap himpunan kolom terbatas |
| `cli-args.test.ts` | `--market`, bawaan per pasar, nilai tak dikenal ditolak |

### Pagar regresi — syarat lulus

Sebelum refactor: simpan hasil scan beberapa emiten IDX.
Sesudah refactor: jalankan ulang, lalu `diff`.

**Diff kosong adalah syarat lulus.** Kalau jalur IDX bergeser sedikit pun, refactornya
salah — berhenti, jangan ditutupi.

## Risiko yang tidak ditutup-tutupi

- **VPA dan Wyckoff di pasar 24/7.** Keduanya dibangun di atas pasar bersesi — dorongan
  pembukaan, lelang penutupan, celah antar sesi. Crypto tidak punya penutupan dan tidak
  punya celah. Kodenya jalan dan mengeluarkan putusan; apakah putusannya berarti sama
  adalah soal lain. Dipertahankan, tapi diperlakukan sebagai keyakinan rendah sampai
  grafiknya diperiksa mata.
- **BTC dipatok terhadap dirinya sendiri** memberi RS60 ≈ 0 untuk baris BTC, secara
  konstruksi. Kosmetik, tapi akan terlihat aneh.
- **`minValue: 10e6` USD masih terkaan.** Yahoo menunjukkan BTC ~$28–36 miliar/hari dan
  SOL ~$3,5–4 miliar/hari, jadi $10 juta/hari menyaring microcap tanpa menyentuh yang
  nyata. Perlu disetel setelah run pertama.
- **Volume crypto Yahoo adalah agregat lintas bursa**, bukan buku satu bursa. Cukup
  untuk RVOL dan tren; lebih lemah dari feed Binance kalau nanti butuh presisi.

## Yang TIDAK dikerjakan

- Klien bursa (Binance/CoinGecko) — Yahoo sudah terbukti jalan untuk keperluan ini
- Pemilihan semesta otomatis per kapitalisasi pasar — watchlist tangan dulu
- Funding rate, open interest, order book — di luar lingkup metrik yang ada
- Pasangan IDR (`BTC-IDR`) — semesta USD dulu
- Bar intraday — harian dulu, sama seperti IDX

---

## Addendum — hasil implementasi (2026-10-01)

Desain di atas bertahan, tapi menjalankan kodenya menemukan hal yang tidak
terlihat saat merancang. Dicatat di sini supaya dokumen ini tidak basi.

### Temuan yang mengubah kebenaran, bukan kerapian

**Konvensi `volume` Yahoo BERBEDA antar pasar.** Untuk saham, `volume` adalah
jumlah LEMBAR, jadi nilai transaksi = `close x volume`. Untuk crypto, `volume`
SUDAH dalam USD. Memakai rumus saham menghasilkan nilai harian BTC sebesar
**$2,55 kuadriliun per hari** — gerbang likuiditas berubah jadi gerbang yang
meloloskan apa saja.

Buktinya aritmetis: volume harian BTC di Yahoo ~28 miliar. Kalau itu jumlah BTC,
berarti 28 miliar BTC diperdagangkan sehari, sementara pasokan maksimalnya 21
juta. Setelah diperbaiki: BTC $31,17 miliar/hari, SOL $3,92 miliar/hari — seukuran
angka sebenarnya.

Ditangani lewat `Market.dailyValue(bar)`.

**MA volume dibagi 100 di tiga tempat** (`render.ts`), mengikuti konvensi lot IDX.
Untuk crypto garis MA-nya akan jatuh 100x di bawah batangnya. Ditangani lewat
`Market.toDisplayVolume(v)`.

### Medan yang bertambah dari rancangan awal

Rancangan menyebut sembilan medan; implementasinya butuh tujuh lagi, semuanya
karena keluaran harus jujur soal satuan: `moneyCompact`, `currencyCode`,
`codeWidth`, `exchangeLabel`, `volumeUnit`, `toDisplayVolume`, `dailyValue`,
ditambah `minValueScale`/`minValueUnit` supaya `--min-likuiditas 5` tidak berarti
"$5 miliar" di crypto.

`SHARES_PER_LOT` dipindah dari `yahoo.ts` ke `market.ts` — konvensi perdagangan,
bukan detail API Yahoo — sekaligus memutus impor melingkar antara keduanya.

### Pagar regresi — hasil

| Perbandingan | Hasil |
|---|---|
| Scan IDX `--tanpa-idx`, CSV + JSON | **Byte-identik** |
| Grafik IDX, SVG penuh | **Byte-identik** |
| Scan IDX dengan lapisan IDX, 28 kolom deterministik | **Identik** |
| Scan IDX dengan lapisan IDX, 5 kolom `ASING*`/`SKOR` | Tidak bisa dibandingkan |

Kolom `ASING*` disuapi data IDX yang MASIH BERUBAH: jendela `--hari-idx` memuat
tanggal hari ini, dan cache `raw/idx` bertambah tiap run. Dibuktikan dengan
menjalankan **kode asli dua kali**: hasilnya berbeda satu sama lain
(`ASING20_LEMBAR` BBCA: −28.901.600 lalu −48.604.500). Jadi kolom itu memang tidak
deterministik, terlepas dari refactor. Logika peringkat/`degraded`-nya ditutup
oleh tes unit, bukan oleh diff.

### Yang masih menggantung

- `analyzeLiquidity` kini menerima 5 parameter posisional. Parameter berikutnya
  harus memicu perubahan ke objek opsi.
- Bukti free float di crypto masih berbunyi "butuh data IDX", padahal free float
  memang tidak berlaku di sana. Menunggu perubahan ke objek opsi di atas.
- 12 koin (UNI, SUI, APT, PEPE, POL, ...) 404 di sufiks `-USD`; Yahoo memakai
  ticker berangka untuk yang bentrok dengan saham. Dikeluarkan dari watchlist,
  bukan ditebak.
