# Pengunduh grafik per emiten — desain

Tanggal: 2026-09-16
Status: disetujui, siap implementasi

## Masalah

`01-app1` menjawab pergerakan **indeks**. Yang belum ada: gambar per **emiten** —
bentuk harga setahun terakhir, di level mana volume menumpuk, dan di mana harga berdiri
relatif terhadap rata-rata bergeraknya.

Keluaran: satu berkas PNG per emiten, mirip tangkapan layar TradingView di `BBCA.png`,
berisi lima hal yang diminta:

1. Harga dengan candle
2. Volume
3. MA volume
4. MA 10, 20, 50, 100, 200 pada harga
5. Volume profile visible range (VPVR)

Panel kosong di tangkapan layar (`Foreign Flow`, `MACD`, `Net Foreign Buy / Sell`,
`Bandar Volume`) **tidak** ikut — tidak ada di daftar permintaan.

## Temuan verifikasi

### Yahoo Finance menyediakan bar harian IDX

```
GET https://query1.finance.yahoo.com/v8/finance/chart/BBCA.JK?interval=1d&range=2y
```

Diuji 2026-09-16, HTTP 200. Metadata: `currency: IDR`, `exchangeName: JKT`,
`exchangeTimezoneName: Asia/Jakarta`. Satu permintaan `range=1y` mengembalikan
249 bar dengan `open`, `high`, `low`, `close`, `volume` lengkap.

Bar terakhir yang dikembalikan:

```
2026-09-16  O 6350  H 6425  L 6325  C 6325  V 72.157.400
```

**Persis sama** dengan legenda di `BBCA.png` (`O6,350 H6,425 L6,325 C6,325`).
Sumber data ini terverifikasi cocok dengan yang dilihat di TradingView.

### Volume Yahoo dalam lembar, TradingView dalam lot

`BBCA.png` menulis volume hari terakhir `721.57K`. Yahoo mengirim `72.157.400`.
Selisihnya tepat **100×** — TradingView menampilkan **lot**, Yahoo mengirim **lembar**.

Konsekuensi: panel volume membagi angka Yahoo dengan 100 supaya angkanya bisa
dibandingkan langsung dengan TradingView. Konstanta `SHARES_PER_LOT = 100`.

### Ada bar null yang harus dibuang

Dari 249 bar `range=1y`, **5 bar** punya `close: null` — hari tanpa perdagangan
(suspensi, atau hari libur yang tetap masuk deret waktu Yahoo).

Bar seperti ini **dibuang**, bukan digambar sebagai nol. Menggambarnya sebagai nol
akan menaruh candle palsu di harga 0 dan merusak skala sumbu harga. Satu bar dianggap
sah hanya kalau `open`, `high`, `low`, `close`, dan `volume` kelimanya bukan null.

### MA 200 butuh pemanasan di luar jendela tampilan

Kalau mengambil 1 tahun dan menggambar 1 tahun, MA 200 baru ada di ~49 candle terakhir.
Di `BBCA.png` garis biru membentang penuh dari kiri.

Karena itu jendela **ambil** = jendela **tampil** + 200 bar. MA dihitung di seluruh
deret, **baru** dipotong ke jendela tampil. Praktiknya: ambil `range=2y`, gambar
250 bar terakhir.

Kalau riwayat emiten lebih pendek dari pemanasan yang dibutuhkan (IPO baru), MA yang
bersangkutan digambar sebagian — bukan error, hanya garis yang mulai belakangan.

### Profil volume tetap aproksimasi

Sama seperti `01-app1/src/chart.ts`. Bar harian tidak membawa distribusi intraday,
jadi profil sungguhan tidak bisa dibangun. Aproksimasi yang dipakai: volume tiap hari
**disebar rata** pada rentang `low..high` hari itu, lalu diakumulasi ke 24 bin harga
(mengikuti `Number Of Rows, 24` di tangkapan layar).

Pembagian naik/turun memakai `close >= open` (berbeda dari `01-app1` yang memakai
`close >= previous`, karena di sini `open` betul-betul tersedia).

**Wajib dilabeli aproksimasi di setiap gambar.** Yang ditunjukkan adalah di rentang
harga mana hari-hari bervolume besar kebetulan berdagang, bukan di harga mana volume
sesungguhnya terjadi. Jangan diperlakukan sebagai level presisi.

## Arsitektur

Bun + TypeScript, mengikuti bentuk `01-app1`.

| Berkas | Tanggung jawab |
|---|---|
| `src/types.ts` | `Bar`, `Series`, `ProfileBin`, `ChartInput` |
| `src/yahoo.ts` | Ambil bar harian, buang bar null, cache mentah ke `raw/` |
| `src/indicators.ts` | Murni: `movingAverage`, `volumeProfile`. Tanpa I/O |
| `src/render.ts` | Bar + indikator → string SVG mandiri, tema gelap |
| `src/png.ts` | Muat SVG di Chrome headless (`playwright-core`), tangkap jadi PNG |
| `src/cli.ts` | Baca `watchlist.txt`, ulang per kode, satu browser untuk seluruh run |
| `watchlist.txt` | Satu kode emiten per baris, `#` untuk komentar |

Aliran data satu arah, tanpa siklus:

```
cli.ts → yahoo.ts → indicators.ts → render.ts → png.ts → out/<KODE>.png
```

`indicators.ts` dan `render.ts` murni — tidak menyentuh jaringan maupun berkas, jadi
bisa dites dengan fixture.

## Antarmuka

```bash
bun run src/cli.ts                      # baca watchlist.txt
bun run src/cli.ts BBCA                 # satu kode, abaikan watchlist
bun run src/cli.ts BBCA BBRI TLKM       # beberapa kode
bun run src/cli.ts BBCA --days 120      # jendela tampil lebih pendek
bun run src/cli.ts BBCA --out charts/   # direktori keluaran lain
```

Kode emiten ditulis tanpa sufiks; `.JK` ditempelkan saat memanggil Yahoo. Argumen
posisional menang atas `watchlist.txt` supaya pencarian sekali jalan tidak perlu
mengedit berkas.

Keluaran: `out/<KODE>.png`, lebar 2000 px (seperti `BBCA.png`).

Satu emiten yang gagal diambil **tidak** menggagalkan seluruh run — kesalahannya
dicatat, kode berikutnya tetap jalan, dan exit code jadi non-nol di akhir kalau ada
yang gagal.

## Tata letak dan warna

Mengikuti `BBCA.png`: latar `#131722`, grid `#1e222d`.

| Elemen | Warna |
|---|---|
| Candle naik | `#26a69a` |
| Candle turun | `#ef5350` |
| MA 10 | `#e91e63` |
| MA 20 | `#ff9800` |
| MA 50 | `#cddc39` |
| MA 100 | `#4caf50` |
| MA 200 | `#2962ff` |
| MA volume (20) | `#2196f3` |
| Bin profil naik | `#26a69a` pada 45% alfa |
| Bin profil turun | `#e91e63` pada 45% alfa |

Panel: harga di atas, volume di bawah, profil volume menempel di sisi kanan panel
harga. Legenda di kiri atas berisi nama emiten, timeframe, dan OHLC bar terakhir —
seperti tangkapan layar. Sumbu harga di kanan, sumbu tanggal di bawah.

## Pengujian

`bun test` atas berkas murni:

- `movingAverage` — nilai yang dihitung tangan; `null` sebelum periode terpenuhi
- pembuangan bar null — deret dengan lubang menghasilkan deret pendek yang rapat
- `volumeProfile` — jumlah volume seluruh bin sama dengan total volume masukan;
  `upVolume + downVolume === volume` di tiap bin; bin mencakup `low..high` global
- konversi lembar → lot

Render diverifikasi dengan mata terhadap `BBCA.png`.
