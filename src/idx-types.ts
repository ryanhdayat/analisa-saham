// Tipe balasan IDX, disalin dari 01-app1/src/types.ts pada 2026-09-16.
// Hanya yang dipakai idx-client.ts.

/**
 * Bentuk mentah satu baris dari
 * GET https://www.idx.co.id/primary/TradingSummary/GetStockSummary?date=YYYYMMDD
 *
 * Catatan penting:
 * - `WeightForIndex` = jumlah saham yang dipakai IDX untuk pembobotan indeks,
 *   yaitu jumlah saham yang sudah disesuaikan free float. INI kunci perhitungan
 *   kontribusi poin. Bukan `ListedShares`.
 * - `Close` bernilai 0 kalau saham tidak ditransaksikan / disuspend hari itu.
 * - `ForeignBuy` / `ForeignSell` dalam LEMBAR, bukan rupiah. Diverifikasi pada data
 *   2026-09-11: dari 828 emiten yang ditransaksikan, nol yang `ForeignBuy > Volume`,
 *   dan rasio `ForeignBuy/Volume` wajar (BBCA 0,379; ASII 0,759). Kalau satuannya
 *   rupiah, angkanya akan jauh melampaui `Volume`. Nilai rupiahnya diestimasi
 *   memakai VWAP di `computeContributions`.
 * - `NonRegularValue` = nilai transaksi pasar negosiasi + tunai (crossing).
 */
export interface RawStockSummary {
  IDStockSummary: number
  StockCode: string
  StockName: string
  Date: string
  Remarks: string
  Previous: number
  OpenPrice: number
  FirstTrade: number
  High: number
  Low: number
  Close: number
  Change: number
  Volume: number
  Value: number
  Frequency: number
  IndexIndividual: number
  Offer: number
  OfferVolume: number
  Bid: number
  BidVolume: number
  ListedShares: number
  TradebleShares: number
  WeightForIndex: number
  ForeignSell: number
  ForeignBuy: number
  DelistingDate: string
  NonRegularVolume: number
  NonRegularValue: number
  NonRegularFrequency: number
}

export interface StockSummaryResponse {
  draw: number
  recordsTotal: number
  recordsFiltered: number
  data: RawStockSummary[]
}

/** Satu baris dari GET /primary/home/GetIndexList (semua angka dikirim sebagai string). */
export interface RawIndexListItem {
  IndexCode: string
  Closing: string
  Change: string
  Percent: string
  Current: string
}

/**
 * Satu baris dari GET /primary/TradingSummary/GetIndexSummary?date=YYYYMMDD.
 * Satu panggilan mengembalikan 45 indeks sekaligus — IHSG dan 11 indeks sektor ada
 * di dalamnya. Hari non-bursa mengembalikan 0 baris.
 *
 * Perhatikan: TIDAK ADA field `Open`. Yang ada `Previous` (penutupan hari sebelumnya).
 * Jangan pakai `Previous` sebagai pengganti `Open` — pada hari yang gapping itu
 * mengarang data. Panel harga memakai bar rentang High–Low + penanda Close.
 */
export interface RawIndexSummary {
  IndexCode: string
  Date: string
  Previous: number
  Highest: number
  Lowest: number
  Close: number
  Change: number
  /** Jumlah konstituen menurut IDX. Cocok persis dengan hitungan per `Sektor` kita. */
  NumberOfStock: number
  Volume: number
  Value: number
  Frequency: number
  MarketCapital: number
}

/** Satu bar harian satu indeks, hasil penyederhanaan `RawIndexSummary`. */
export interface IndexBar {
  /** YYYYMMDD, waktu Asia/Jakarta. */
  date: string
  indexCode: string
  previous: number
  high: number
  low: number
  close: number
  /** Volume lembar seluruh konstituen indeks pada hari itu. */
  volume: number
  /** Nilai transaksi rupiah seluruh konstituen indeks. */
  value: number
}

/**
 * Satu baris dari GET /primary/ListedCompany/GetCompanyProfiles?length=9999.
 * Satu-satunya sumber klasifikasi sektor yang bisa dibaca mesin — endpoint konstituen
 * indeks (`/primary/StockData/GetIndexConstituent`) hanya mengembalikan daftar PDF.
 *
 * `Sektor` memakai taksonomi IDX-IC (11 nilai, berbahasa Indonesia) dan per 2026-09-12
 * mencakup 962/962 emiten — nol konstituen IHSG tanpa sektor. Field lain ada di respons
 * tapi tidak dipakai di sini.
 */
export interface RawCompanyProfile {
  KodeEmiten: string
  NamaEmiten: string
  Sektor: string
  SubSektor: string
  Industri: string
  SubIndustri: string
  PapanPencatatan: string
}

/** Klasifikasi sektor satu emiten, hasil penyederhanaan `RawCompanyProfile`. */
export interface SectorInfo {
  sector: string
  subSector: string
}
