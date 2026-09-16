# Scan analisis 12 metrik — desain

Tanggal: 2026-09-16
Status: disetujui, siap implementasi
Lanjutan dari: [pengunduh grafik](./2026-09-16-chart-downloader-design.md)

## Masalah

Grafiknya sudah ada, tapi membacanya masih manual satu per satu. Yang dibutuhkan:
satu perintah yang membaca watchlist, menghitung 12 metrik yang sama untuk tiap
emiten, lalu menyaring dan mengurutkannya supaya tinggal beberapa yang layak dilihat.

Metrik dihitung dari **data OHLCV**, bukan dari piksel PNG-nya.

## Batas ketersediaan data — hasil verifikasi

Diuji 2026-09-16.

| Sumber | Hasil |
|---|---|
| `^JKSE` (IHSG) di Yahoo | **Ada**, 1D, riwayat penuh |
| `^JKFINA`, `^JKBIND` (sektor) di Yahoo | **Tidak terpakai** — HTTP 200 tapi `indicators.quote[0]` KOSONG, tanpa `timestamp`. Hanya `regularMarketPrice` yang hidup. Tidak ada riwayat. |
| Indeks sektor dari IDX `GetIndexSummary` | **Ada**, 45 indeks sekaligus per tanggal |
| Net asing per emiten | Hanya IDX: `ForeignBuy`/`ForeignSell` di `GetStockSummary` |
| Free float per emiten | Hanya IDX: `WeightForIndex` / `ListedShares` (**bukan** `TradebleShares` — lihat di bawah) |
| Net beli/jual per **broker** | **TIDAK ADA** di sumber publik mana pun |

`GetStockSummary?length=9999&date=YYYYMMDD` mengembalikan **seluruh ~900 emiten untuk
satu tanggal**. Jadi riwayat 60 hari bursa = **60 permintaan untuk seluruh watchlist**,
bukan 60 per emiten.

### `TradebleShares` BUKAN free float — dikoreksi setelah melihat data asli

Rancangan awal memakai `TradebleShares / ListedShares`. Diuji terhadap
`stock-summary-20260916` (963 emiten): **`TradebleShares` sama persis dengan
`ListedShares` di 908 dari 963 emiten**, jadi rasionya 100% untuk hampir semua
emiten dan tidak berarti apa-apa.

Yang benar `WeightForIndex` — lembar yang dipakai IDX untuk membobot indeks,
sudah disesuaikan free float. Hasilnya masuk akal:

| Emiten | ListedShares | WeightForIndex | Free float |
|---|---|---|---|
| BBCA | 122.042.299.500 | 38.391.910.182 | 31,5% |
| BBRI | 150.043.411.587 | 63.498.371.784 | 42,3% |
| TLKM | 99.062.216.600 | 40.140.010.166 | 40,5% |
| ASII | 40.483.553.140 | 17.715.602.854 | 43,8% |

### Yang tidak bisa dibuat

**Bandarmology tingkat broker (#8) tidak dapat diwujudkan.** Data broker summary tidak
diterbitkan IDX secara publik; hanya ada di penyedia berbayar. Net asing adalah proksi
parsial, **bukan** pengganti — "akumulasi konsisten oleh beberapa broker" justru sinyal
yang tidak bisa diberikan. Jangan menambal ini dengan tebakan.

## Prinsip: IDX adalah lapisan pengaya, bukan fondasi

Client IDX menyetir Chrome sungguhan karena `fetch`/`curl` kena 403 di lapisan sidik
jari TLS/HTTP2 (lihat `01-app1/src/idx-client.ts`). Scraping di belakang WAF **pasti**
rusak sesekali: tantangan Cloudflare berubah, IDX ganti tata letak, `GetStockSummary`
membalas 503 dari Varnish.

Karena itu:

1. **Kegagalan IDX tidak pernah menggagalkan run.** Dicatat, dilewati, lanjut — persis
   seperti emiten yang gagal diambil pada pengunduh grafik.
2. **Cache dulu.** Tiap tarikan IDX yang berhasil disimpan di `raw/`. Saat gagal,
   dipakai cache terbaru **dengan umurnya dicetak di tiap sel yang terpengaruh**,
   bukan cuma sekali di header: `net asing per 2026-09-12 (4 hari lalu)`.
3. **Degradasi tidak boleh diam-diam.** `foreignPersist` adalah satu dari empat kolom
   pemeringkat. Kalau IDX hilang tanpa jejak, peringkat tersusun ulang dari tiga kolom
   dan baris hari ini tidak lagi sebanding dengan kemarin — karena alasan yang tidak
   ada hubungannya dengan pasar. Maka tiap keluaran **mencantumkan kolom mana yang
   dipakai**, dan tabel memberi spanduk saat berjalan terdegradasi.
4. **Terisolasi.** Seluruh akses IDX di balik satu modul.

9 dari 12 metrik berjalan tanpa IDX sama sekali.

**Terbukti di lapangan pada 2026-09-17.** Saat percobaan pertama, IDX melayani satu
tanggal lalu mengembalikan **HTTP 403 Cloudflare** untuk semua permintaan berikutnya.
Scan tetap selesai: tabel tercetak, CSV/Excel/JSON tertulis, exit code 0, dan
penjaga "tiga gagal beruntun" menghentikan percobaan setelah 3 tanggal alih-alih
menggilir 60. Ini bukan skenario hipotetis.

Yahoo juga tidak resmi dan bisa rusak dengan cara yang sama. Bedanya ia HTTP biasa
tanpa WAF. `yahoo.ts` tetap satu-satunya berkas yang tahu dari mana bar berasal.

## Bentuk keluaran tiap metrik

Tiap modul mengembalikan amplop yang sama, supaya tidak pernah ada angka telanjang
tanpa alasannya:

```ts
interface Metric<T> {
  value: T
  verdict: string          // kalimat Indonesia, siap cetak
  confidence: 'rendah' | 'sedang' | 'tinggi'
  evidence: string[]       // fakta berikut tanggalnya
  available: boolean       // false = sumber datanya tidak ada
  staleness?: { asOf: string; daysOld: number }
}
```

## Metrik

### 1. Volume terhadap harga (effort vs result)

- `RVOL = volume / SMA20(volume)`. Spread relatif = `(high-low) / SMA20(high-low)`.
- Klasifikasi tiap bar:
  - naik & `RVOL >= 1.2` → permintaan sejati
  - naik & `RVOL <= 0.8` → rally lemah, volume mengering
  - turun & `RVOL <= 0.8` → koreksi sehat, tekanan jual rendah
  - turun & `RVOL >= 1.5` → tekanan jual nyata
  - `RVOL >= 1.8` & spread relatif `<= 0.7` → **absorpsi**
- Diringkas atas 10 bar terakhir.

### 2. Struktur dan fase harga

- Pivot fraktal lookback 3: `high[i]` swing high kalau tertinggi di `[i-3, i+3]`.
- Struktur dari dua swing high dan dua swing low terakhir: keduanya naik = uptrend,
  keduanya turun = downtrend, selain itu sideways.
- Fase di dalam struktur: uptrend + harga mundur dari swing high terakhir = **pullback**;
  downtrend + harga naik dari swing low terakhir = **rebound**.
- Dua timeframe: mingguan (diresample dari harian) untuk arah, harian untuk entry.
  Bertentangan → confidence turun.

### 3 & 4. Support dan resistance, dinilai bukan dihitung

Kandidat: swing high/low, POC dan tepi bin bervolume tinggi dari profil volume, serta
angka bulat terdekat. Kandidat dalam toleransi `max(1.5% , 0.5×ATR)` digabung jadi satu
level.

Nilai tiap level, 0..1:

| Komponen | Bobot | Cara |
|---|---|---|
| Jumlah sentuhan | 0,35 | bar yang high/low-nya masuk toleransi |
| Volume di level | 0,35 | `share` bin profil di level itu |
| Kebaruan | 0,20 | peluruhan terhadap jarak bar ke sentuhan terakhir |
| Angka bulat | 0,10 | kelipatan bulat sesuai besaran harga |

Fraksi harga IDX dipakai untuk membulatkan level: `<200` → 1, `200–500` → 2,
`500–2.000` → 5, `2.000–5.000` → 10, `>=5.000` → 25.

Keluaran: 3 support terbaik di bawah harga, 3 resistance terbaik di atas.

### 5. Likuiditas — GERBANG

- `nilaiHarian = rata-rata(close × volume)` 20 bar, rupiah.
- Gerbang: `>= Rp 5 miliar` (bisa diubah `--min-likuiditas`). Gagal = emiten dicoret
  dari daftar, alasannya dicetak.
- Free float = `WeightForIndex / ListedShares` (IDX; boleh tidak tersedia).

### 6. Bar sinyal VPA

- **Stopping volume / selling climax** — `RVOL >= 2`, close di sepertiga atas rentang,
  low menembus terendah N hari, muncul setelah penurunan.
- **No supply / test** — bar turun, `RVOL <= 0,7`, spread sempit, di atas support.
- **No demand / upthrust** — bar naik ber-`RVOL <= 0,7`; atau bar menembus high lalu
  ditutup di sepertiga bawah dengan volume tinggi.
- **Spring / shakeout** — low menembus support lalu close kembali di atasnya dalam 1–3 bar.

Semuanya **aturan heuristik**. Yang dicetak adalah kejadian berikut tanggal dan angkanya,
bukan vonis.

### 7. Fase Wyckoff — paling lemah, sengaja dibatasi

Ditebak dari struktur (#2), kompresi rentang (ATR menurun), perilaku volume, dan ada
tidaknya spring atau climax:

- **akumulasi** — sideways setelah downtrend, volume menyusut, ada spring
- **markup** — uptrend, harga di atas MA50 yang menanjak
- **distribusi** — sideways setelah uptrend, ada upthrust
- **markdown** — downtrend, harga di bawah MA50 yang menurun

`confidence` **dibatasi maksimal `sedang`** kecuali seluruh syarat terpenuhi bersamaan.
**Tidak pernah ikut memengaruhi peringkat.** Alasannya: praktisi berbeda pendapat pada
grafik yang sama; mencetak "Fase: Akumulasi" tanpa syarat mengundang keyakinan yang
tidak ditanggung metodenya.

### 8. Aliran asing (IDX, boleh kosong)

- `netLembar = ForeignBuy - ForeignSell` per hari, dijumlah 5/20/60 hari bursa.
- **`ForeignBuy`/`ForeignSell` satuannya LEMBAR, bukan rupiah** — temuan terverifikasi
  di `01-app1`. Nilai rupiah = `netLembar × close`, dan **wajib dilabeli estimasi**.
- `persistence` = bagian hari bernet positif dalam jendela, 0..1.

### 9. Kekuatan relatif

- Terhadap IHSG (`^JKSE`, Yahoo): selisih return 20 dan 60 hari.
- Terhadap indeks sektor (IDX, boleh kosong): cara yang sama.
- Ditandai khusus kalau return IHSG negatif sementara return emiten `>= 0` —
  permintaan tersembunyi.

### 10. Filter tren

- Susunan MA: `close > MA20 > MA50 > MA200` dengan kemiringan menanjak.
- OBV = kumulatif `sign(Δclose) × volume`.
- A/D = kumulatif `((close-low)-(high-close))/(high-low) × volume`.
- Divergensi: harga mencetak low baru sementara OBV tidak (bullish), dan sebaliknya.

### 11. ATR

ATR Wilder 14. `ATR% = ATR/close`. Saran jarak stop = `2 × ATR`.

### 12. Risk/reward — GERBANG

- entry = close terakhir
- stop = support bernilai terbaik di bawah harga, dikurangi bantalan `0,5 × ATR`
- target = resistance bernilai terbaik di atas harga
- `rasio = (target - entry) / (entry - stop)`
- Gerbang: `>= 2` (bisa diubah `--min-rr`).

## Gerbang dan peringkat

**Gerbang** (gagal = keluar dari daftar, alasannya dicetak): likuiditas (#5) dan R:R (#12).

**Peringkat** adalah jumlah empat kolom terukur, masing-masing dinormalkan 0..1 dan
**ditampilkan sebagai kolom tersendiri** supaya urutannya bisa diaudit:

| Kolom | Dari |
|---|---|
| `trend` | susunan MA (#10) |
| `rs60` | kekuatan relatif 60 hari vs IHSG (#9) |
| `rvol` | mutu konfirmasi volume (#1) |
| `asing` | persistensi aliran asing 20 hari (#8) — boleh kosong |

Skor = rata-rata kolom **yang tersedia**, dan tiap baris membawa daftar kolom yang
dipakai. Wyckoff (#7) dan VPA (#6) tidak pernah masuk hitungan.

## Arsitektur

```
src/analysis/
  volume.ts structure.ts levels.ts liquidity.ts vpa.ts wyckoff.ts
  flow.ts strength.ts filters.ts volatility.ts riskreward.ts
  report.ts        ← susun, jalankan gerbang, hitung peringkat
src/resample.ts    ← bar mingguan dari harian
src/idx.ts         ← salinan IdxClient, satu-satunya pintu ke IDX
src/output/
  table.ts csv.ts xlsx.ts json.ts
src/scan.ts        ← CLI
```

Seluruh berkas di `src/analysis/` **murni** — tanpa jaringan, tanpa berkas — jadi bisa
dites dengan fixture.

Salinan `IdxClient` dipilih dibanding impor lintas proyek: ini dua proyek terpisah, dan
impor lintas direktori membuat keduanya rapuh. Biayanya duplikasi ~300 baris; gantinya
kebenaran proyek ini tidak bergantung pada suntingan di `01-app1`.

## Keluaran

| Permukaan | Berkas | Guna |
|---|---|---|
| Tabel terminal | — | Lihat cepat tiap hari |
| CSV | `out/scan-YYYY-MM-DD.csv` | **Pemisah titik koma**, supaya Excel berlokal Indonesia memecah kolom, bukan menumpuk semua di kolom A |
| Excel | `out/scan-YYYY-MM-DD.xlsx` | Header beku, sel vonis berwarna, satu sheet bukti per emiten |
| JSON | `out/<KODE>.json` | Detail penuh berikut bukti, untuk skrip |

`exceljs` sudah diuji jalan di Bun (workbook sah, header beku, sel berwarna). Ia
menambah 84 paket ke proyek yang sekarang 6 — biaya yang diterima sadar.

## Urutan bangun

1. **Mesin Yahoo** — #1, 2, 3, 4, 6, 7, 9 (vs IHSG), 10, 11, 12, dan #5 bagian nilai.
2. **Lapisan IDX** — #5 free float, #8 aliran asing, #9 vs sektor.

Lingkupnya sama; ini cuma urutan supaya mesinnya terbukti sebelum sumber yang lebih
lambat masuk.

## Pengujian

TDD di seluruh modul murni, dengan fixture yang dibangun tangan:

- deret uptrend sintetis wajib terklasifikasi uptrend
- spring bentukan wajib terdeteksi
- emiten di bawah ambang likuiditas wajib tercoret berikut alasannya
- R:R di bawah ambang wajib tercoret
- IDX tidak tersedia wajib menghasilkan `available: false`, bukan nol diam-diam
- peringkat dengan kolom `asing` hilang wajib mencantumkan kolom mana yang dipakai
- modul heuristik (#6, #7) dites pada **aturannya**, bukan pada kebenaran ramalannya
