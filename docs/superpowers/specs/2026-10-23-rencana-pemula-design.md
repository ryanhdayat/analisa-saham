# Rencana harian untuk pemula + perombakan tampilan — desain

Tanggal: 2026-10-23
Status: draf, menunggu persetujuan
Berlaku untuk: fork `ryanhdayat/analisa-saham`, situs `saham.ryanhdayat.biz.id`.
Tidak diajukan ke upstream.

## Untuk siapa dan kenapa

Pemilik situs pemula di saham dan tidak mau banyak berpikir. Yang dia mau: buka
situs, lihat daftar saham hari ini, tahu harus **beli di harga berapa, berapa lot,
jual rugi di mana, jual untung di mana**. Dia memakai situs dari **HP (sambil
membuka Stockbit) dan laptop**, jadi dua-duanya harus nyaman.

Uji ulang 2 tahun milik screener ini sendiri menunjukkan rata-rata hasil per
transaksi masih sedikit minus (sekitar −0,8%, sebelum biaya). Karena itu tahap ini
adalah **masa simulasi**: dia latihan memasang order di **Stockbit Demo Virtual
Trading** (modal virtual Rp100 juta), sementara situs mensimulasikan semua rencana
secara otomatis dan menunjukkan kapan simulasi "lulus".

Sukses = setiap pagi dia bisa membuka situs di HP, dan dalam satu layar tahu apa
yang dipasang di Stockbit Virtual. Setelah 1–2 bulan, `/hasil/` menjawab dengan
angka: rencana ini menghasilkan uang atau tidak, dan apakah tanda "hati-hati"
penting.

## Tujuan

1. **Rencana hari ini** di halaman `/idx/`: daftar saham lolos dengan harga beli,
   lot, batas jual rugi, target jual untung, perkiraan rugi/untung dalam rupiah,
   dan langkah memasangnya di Stockbit Virtual.
2. **Simulasi otomatis** di `/hasil/`: setiap rencana dihitung dalam rupiah dengan
   modal Rp100 juta, dipotong biaya, dipisah per kelompok bersih/hati-hati, dengan
   aturan lulus.
3. **Perombakan tampilan** keempat halaman (beranda, `/idx/`, `/crypto/`,
   `/hasil/`) untuk pemula, HP dan laptop.

## Bukan tujuan

- Login, akun, database. Tidak ada data pribadi yang disimpan di server.
- Otomasi Stockbit dalam bentuk apa pun: tidak ada MCP Stockbit, API tidak resmi,
  atau order otomatis.
- Rencana untuk crypto (Stockbit tidak memperdagangkan crypto). Halaman `/crypto/`
  ikut dirapikan tampilannya saja.
- Mengubah aturan gerbang, metrik, atau cara memilih saham.

## Yang tidak boleh terjadi (anti-tujuan)

- Situs terbaca seperti **perintah beli** atau janji untung. Setiap rencana
  menyebut ini masa simulasi, dan peringatan "hati-hati" tidak boleh tersembunyi.
- Angka di "Rencana hari ini" berbeda dengan angka yang dinilai `/hasil/` atau
  disimulasikan. Satu sumber hitungan untuk keduanya.
- Harga yang tidak bisa diketik di Stockbit (bukan fraksi harga BEI).
- Pemula harus menggeser tabel ke samping di HP untuk tahu apa yang dibeli.
- Kehilangan fitur lama untuk yang mau mendalami: tabel lengkap, filter, grafik,
  dan bukti tiap metrik tetap ada, hanya pindah ke lapisan "detail".

## Yang sudah diputuskan pemilik

- Tampilkan **semua saham yang lolos** (pilihan A). Yang bersih di urutan atas;
  yang punya catatan diberi label "hati-hati" beserta alasannya dalam bahasa awam.
  Hari tanpa saham lolos menampilkan "Tidak ada rencana hari ini", dan itu wajar.
- Latihan di Stockbit Virtual dilakukan **manual oleh pemilik**. Situs hanya
  memberi angka dan langkah.
- Hosting tetap seperti sekarang: situs statis di Vercel, terbit harian lewat
  GitHub Actions (`docs/terbit-vercel.md`).
- HP dan laptop sama-sama dipakai.

## Aturan hitungan

### Rencana per saham (hanya IDX, hanya baris lolos)

| Isian | Aturan |
|---|---|
| Harga beli | `ENTRY` = close terakhir (sudah fraksi sah). Dipasang sebagai Buy limit. |
| Jual rugi di | Cut loss evaluasi yang sama dengan `/hasil/` (`cutLoss` di `src/hasil/nilai.ts`: stop dijepit 5–10% di bawah entry), **dibulatkan ke bawah** ke fraksi harga BEI. |
| Jual untung di | `TARGET`, **dibulatkan ke bawah** ke fraksi harga BEI, supaya target tidak lebih jauh dari hitungan. |
| Lot | `min(lot_risiko, lot_batas)`. `lot_risiko = floor(modal × 1% / ((beli − jual_rugi) × 100))`. `lot_batas = floor(modal × 20% / (beli × 100))`. Kalau hasilnya 0: tampilkan "modal terlalu kecil untuk saham ini". |
| Perkiraan rugi/untung | `lot × 100 × (jual_rugi − beli)` dan `lot × 100 × (jual_untung − beli)`, keduanya dikurangi biaya beli+jual. |
| Biaya | Beli 0,15%, jual 0,25% dari nilai transaksi. Satu konstanta bernama, dengan catatan bahwa angkanya perlu dicocokkan ke tarif Stockbit. |

Fraksi harga BEI sudah ada: `idxTickSize` / `roundToTick` di
`src/analysis/levels.ts`. Butuh varian "bulatkan ke bawah".

**Satu sumber hitungan:** semua aturan di atas berada di satu modul TypeScript
murni yang bisa dites, dipakai oleh halaman screener dan oleh `/hasil/`. Halaman
hanya mengulang hitungan lot di browser saat pemilik mengubah modal, memakai rumus
yang sama dan diuji dengan angka yang sama.

### Modal

- Bawaan **Rp100.000.000** (sama dengan modal Stockbit Virtual).
- Bisa diubah di halaman. Disimpan di `localStorage` browser saja, dengan
  try/catch; tanpa penyimpanan pun halaman tetap jalan dengan bawaan.
- `/hasil/` selalu memakai Rp100 juta supaya angkanya stabil dan bisa dibandingkan.

### Label bersih / hati-hati

- Sama dengan catatan risiko yang sekarang dihitung `catatan()` di
  `src/output/screener.ts`: Wyckoff distribusi/markdown, VPA upthrust/no-demand,
  fase rebound, OBV bearish, baca volume tekanan-jual/rally-lemah, R:R < 1.
- Harus bisa dihitung dari `ScanRow` (bukan dari baris tabel HTML), supaya
  `pilihanFromRows` bisa ikut mencatatnya.
- Teks label diterjemahkan ke bahasa awam. Contoh: "rally-lemah" → "naiknya tanpa
  dukungan volume"; "R:R 1:0,4" → "potensi untung lebih kecil dari risiko rugi".
  Istilah aslinya tetap muncul di bagian detail.

### Simulasi di `/hasil/`

- Setiap pilihan (aturan satu pilihan per emiten tetap) mendapat lot dengan aturan
  di atas, modal Rp100 juta, dari `entry` dan `stop` di catatan pilihannya.
  Hasil rupiah = `lot × 100 × (harga_keluar − entry)` − biaya. Pilihan terbuka
  dinilai di close terakhir dan ditandai "belum selesai".
- Setiap pilihan dihitung sendiri-sendiri; tidak ada batasan kas bersama antar
  pilihan yang terbuka bersamaan. Ini disebut terang di halaman.
- Ringkasan: total rupiah, rata-rata % per transaksi setelah biaya, jumlah
  transaksi yang sudah selesai, dipecah **bersih / hati-hati / tanpa label**.
- `pilihan-<tanggal>.json` mendapat medan baru `label: "bersih" | "hati-hati"`
  (opsional, demi kompatibilitas). Catatan lama tanpa medan itu masuk kelompok
  "tanpa label".
- **Aturan lulus:** minimal 30 transaksi selesai (kena target atau cut loss) dan
  rata-rata hasil setelah biaya > 0. Ditampilkan sebagai kemajuan
  ("12 dari 30 transaksi · rata-rata −0,6%") dengan status: belum cukup data /
  belum lulus / lulus.

## Tampilan

Arah: tetap memakai bahasa visual yang ada (Archivo, IBM Plex Sans/Mono, warna
naik/turun, tema terang/gelap). Ini perombakan susunan dan bahasa, bukan ganti
merek. Skill `frontend-design` dipakai untuk eksekusinya.

Prinsip:
- Layar pertama di HP menjawab "apa yang saya lakukan hari ini".
- Bahasa awam di lapisan atas; istilah teknis (VPA, Wyckoff, RVOL, ATR, R:R,
  skor) hanya di lapisan detail, dengan penjelasan singkat saat ditekan atau
  disorot.
- Satu navigasi yang sama di keempat halaman: Beranda · Rencana (IDX) · Crypto ·
  Hasil. Saat ini halaman screener tidak bisa kembali ke beranda.
- Tanggal data dan waktu terbit selalu terlihat di atas. Kalau data lebih tua dari
  hari bursa terakhir yang diharapkan, beri tanda.
- Tidak ada geser-samping untuk informasi utama di HP. Tabel lengkap boleh tetap
  bisa digeser di lapisan detail.

### `/idx/`

1. Kepala: judul, tanggal data, waktu terbit, tanda "Masa simulasi".
2. **Rencana hari ini**: isian modal, lalu satu kartu per saham di HP (tabel di
   laptop). Kartu: kode + nama, label bersih/hati-hati + alasan awam, harga beli,
   lot (dan nilai rupiahnya), jual rugi (dengan %), jual untung (dengan %),
   perkiraan rugi/untung rupiah. Tombol "Lihat grafik & alasan" membuka laci yang
   sudah ada.
3. **Cara memasang di Stockbit Virtual**: 4 langkah (pasang Buy limit sebelum
   09:00; lewati kalau harga buka sudah di atas target atau di bawah batas rugi;
   lihat sekilas orderbook; jual saat batas rugi atau target tersentuh), bisa
   dilipat.
4. **Semua hasil screening** (tabel, tab, filter yang sekarang) dalam bagian yang
   bisa dibuka, untuk yang mau mendalami. Spanduk teknis (gerbang, terdegradasi)
   pindah ke sini dengan bahasa yang lebih sederhana.

Laci emiten: bagian atas berisi ringkasan awam (kenapa lolos, dalam 2–3 poin;
rencana dengan angka yang sama dengan kartu); grafik tetap; vonis tiap metrik
masuk "Detail teknis" yang terlipat.

### `/crypto/`

Susunan dan gaya sama dengan bagian 4 halaman `/idx/`, dengan navigasi dan kepala
baru. Tanpa rencana dan tanpa lot.

### `/hasil/`

1. Kepala dan navigasi.
2. **Simulasi Rp100 juta**: total rupiah, rata-rata per transaksi setelah biaya,
   status aturan lulus dengan kemajuannya.
3. **Bersih vs hati-hati**: dua kolom pembanding (jumlah, % kena target, rata-rata
   setelah biaya).
4. Tabel/kartu pilihan terbuka dan selesai seperti sekarang, ditambah kolom lot dan
   rupiah, plus label.
5. "Cara menilai" (sudah ada) diperbarui dengan aturan lot, biaya, dan aturan lulus.

### Beranda

Satu ajakan utama: "Lihat rencana hari ini" → `/idx/`. Kartu crypto dan hasil
tetap ada. Kartu hasil menampilkan status simulasi (contoh: "12 dari 30 transaksi
· rata-rata −0,6%").

## Batasan

- Situs statis; semua data dibuat saat terbit harian. Tidak ada server atau API
  baru.
- Template HTML adalah satu berkas berisi CSS dan JS sebaris, seperti sekarang;
  tanpa bundler dan framework. Pustaka eksternal hanya kalau benar perlu, dengan
  versi tersemat.
- Dua tema (terang/gelap) tetap jalan.
- HP sempit 360px tanpa geser-samping di lapisan atas.
- Semua hitungan baru dites (`bun test`) sebelum ditampilkan; tes yang ada tetap
  lulus.
- Perombakan template membuat fork makin jauh dari upstream. Itu disadari:
  perbaikan umum tetap diajukan terpisah, dan sinkron dari upstream lewat PR yang
  bisa memunculkan konflik di template.

## Keputusan perancang (bukan dari pemilik — periksa)

1. **`/hasil/` menilai dengan harga yang sama dengan rencana.** Untuk IDX,
   `judge()` memakai jual-rugi dan target yang sudah dibulatkan ke bawah ke
   fraksi BEI, persis angka di kartu rencana. Karena rekam jejak dihitung ulang
   tiap run, hasil lama ikut bergeser beberapa rupiah. Saat ini baru ada 4
   pilihan, jadi dampaknya nol. Crypto tetap memakai harga mentah.
2. **Simulasi meniru order Buy limit yang dipasang pagi berikutnya** (IDX):
   - Hari bursa pertama setelah scan: kalau harga buka ≥ target atau ≤ jual-rugi,
     pilihan berstatus **dilewati**. Ini sesuai langkah 2 di "Cara memasang".
   - Kalau tidak dilewati, order terisi hanya bila low hari itu ≤ harga beli.
     Harga terisi = min(harga buka, harga beli), karena buka di bawah limit
     langsung match di harga buka.
   - Kalau tidak terisi di hari itu: **tidak terbeli** (order dianggap batal).
   - Dilewati dan tidak terbeli tidak dihitung sebagai transaksi, tapi jumlahnya
     ditampilkan.
   - Setelah terisi, aturan target/cut loss yang ada berlaku mulai hari itu juga.
     Kalau di hari yang sama, low menyentuh jual-rugi setelah terisi tetap
     dihitung cut loss, dengan aturan konservatif yang sudah ada.
   - Pilihan yang dilewati atau tidak terbeli langsung selesai, jadi emiten yang
     sama boleh membuka pilihan baru di scan berikutnya.
   - Ini juga menutup temuan audit bahwa entry di close hari scan terlalu optimis.
     Crypto tetap memakai aturan lama.
3. **Simulasi rupiah, label, dan aturan lulus hanya untuk IDX.** Crypto di
   `/hasil/` tetap seperti sekarang, dalam persen dan tanpa lot. Hanya dirapikan
   tampilannya.
4. **Aturan lulus memakai semua transaksi IDX yang selesai** (kena target atau cut
   loss, tanpa yang masih terbuka), rata-rata **persen setelah biaya**. Alasannya:
   pemilik mengambil semua pilihan (pilihan A). Kelompok bersih/hati-hati
   ditampilkan sebagai pembanding, tanpa status lulus sendiri.
5. **Tanda data basi memakai hari kerja saja**, tanpa kalender libur. IDX: diberi
   tanda kalau tanggal data lebih tua dari hari kerja sebelumnya, dengan teks
   "mungkin karena libur bursa". Crypto: diberi tanda kalau lebih tua dari
   kemarin (UTC).
6. **Rumus lot di browser** adalah salinan kecil di template, ditandai komentar
   penanda. Ada tes yang mengambil fungsi itu dari template, menjalankannya, dan
   membandingkannya dengan modul TypeScript pada kumpulan angka yang sama. Tidak
   ada bundler.

## Diserahkan ke pelaksana

- Susunan berkas dan nama fungsi baru, selama hitungan ada di satu modul murni.
- Detail visual: jarak, ukuran huruf, ikon, animasi, gaya kartu.
- Cara menampilkan penjelasan istilah (tooltip, `<details>`, atau glosarium kecil).
- Urutan antar saham dalam kelompok yang sama: memakai skor seperti sekarang.
- Teks bahasa awam untuk tiap label, selama artinya setia pada aturan aslinya.
