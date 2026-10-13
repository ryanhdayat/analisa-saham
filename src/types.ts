/** Satu bar harian. Harga dalam rupiah, volume dalam LEMBAR (bukan lot). */
export interface Bar {
  /** ISO `YYYY-MM-DD` di zona waktu bursa (Asia/Jakarta). */
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Satu baris profil volume. */
export interface ProfileBin {
  /** Batas bawah bin, dalam harga. */
  low: number
  /** Batas atas bin. */
  high: number
  /** Volume teraproksimasi yang jatuh di bin ini. */
  volume: number
  /** Bagian volume dari hari yang ditutup naik (close >= open). */
  upVolume: number
  /** Bagian dari hari yang ditutup turun. upVolume + downVolume === volume. */
  downVolume: number
  /** volume / totalVolume, 0..1. */
  share: number
}

export interface VolumeProfile {
  bins: ProfileBin[]
  totalVolume: number
  /** Indeks bin bervolume terbesar — point of control. */
  pocIndex: number
}

/** Semua yang dibutuhkan render untuk menggambar satu emiten. */
export interface ChartInput {
  code: string
  /**
   * Simbol Yahoo hasil resolusi, apa adanya — `BBCA.JK`, `BTC-USD`.
   *
   * Dipisah dari `code` karena footer grafik menyebut SUMBER datanya: menempelkan
   * `.JK` ke simbol yang sudah lengkap membuat footer itu berbohong.
   */
  symbol: string
  /** Nama panjang emiten untuk legenda. */
  name: string
  /** Bar yang benar-benar digambar (sudah dipotong ke jendela tampil). */
  bars: Bar[]
  /** MA harga, sejajar indeks dengan `bars`. Kunci = periode. */
  priceMA: Map<number, Array<number | null>>
  /** MA volume, sejajar indeks dengan `bars`. */
  volumeMA: Array<number | null>
  profile: VolumeProfile
  /** Jumlah baris profil, untuk ditulis di legenda. */
  profileRows: number
}
