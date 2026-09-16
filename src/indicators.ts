import type { Bar, ProfileBin, VolumeProfile } from './types.ts'

/**
 * Rata-rata bergerak sederhana. `null` selama periode belum terpenuhi, supaya
 * pemanggil bisa membedakan "belum ada nilai" dari "nilainya nol".
 *
 * Sengaja menjumlah ulang tiap jendela, bukan rolling sum. Deret di sini paling
 * panjang beberapa ratus bar, jadi biayanya tidak terasa, dan kita terbebas dari
 * hanyutnya float yang muncul kalau angka ditambah lalu dikurangi terus-menerus.
 */
export function movingAverage(values: number[], period: number): Array<number | null> {
  return values.map((_, i) => {
    if (i + 1 < period) return null
    let sum = 0
    for (let j = i + 1 - period; j <= i; j++) sum += values[j]!
    return sum / period
  })
}

/**
 * Profil volume atas seluruh bar yang diberikan — "visible range" di sini berarti
 * persis bar yang digambar, karena pemanggil sudah memotongnya lebih dulu.
 *
 * PERINGATAN: ini APROKSIMASI, bukan profil volume sebenarnya.
 *
 * Profil sungguhan dibangun dari data tick: berapa lembar betul-betul berpindah
 * tangan di tiap level harga. Bar harian tidak membawa informasi itu. Yang bisa
 * dilakukan: sebar volume tiap hari RATA pada rentang `low..high` hari itu.
 * Asumsinya jelas salah — perdagangan tidak seragam di dalam satu hari, biasanya
 * menumpuk di sekitar pembukaan dan penutupan.
 *
 * Konsekuensinya: POC dan bin tebal menunjukkan di rentang harga mana hari-hari
 * bervolume besar KEBETULAN berdagang, bukan di harga mana volume sesungguhnya
 * terjadi. Berguna untuk melihat area konsolidasi; JANGAN diperlakukan sebagai
 * level presisi. Setiap gambar yang menampilkannya wajib memberi label aproksimasi.
 */
export function volumeProfile(bars: Bar[], rows: number): VolumeProfile {
  if (bars.length === 0) return { bins: [], totalVolume: 0, pocIndex: 0 }

  const globalLow = Math.min(...bars.map((b) => b.low))
  const globalHigh = Math.max(...bars.map((b) => b.high))
  const range = globalHigh - globalLow

  // Semua bar terkunci di satu harga (misal suspensi panjang atau ARA/ARB beruntun):
  // tidak ada rentang untuk dibagi, jadi satu bin saja yang jujur.
  const binCount = range > 0 ? rows : 1
  const height = range > 0 ? range / rows : 0

  const acc = Array.from({ length: binCount }, (_, i) => ({
    low: globalLow + i * height,
    high: i === binCount - 1 ? globalHigh : globalLow + (i + 1) * height,
    up: 0,
    down: 0,
  }))

  const indexOf = (price: number): number => {
    if (height === 0) return 0
    const i = Math.floor((price - globalLow) / height)
    return Math.min(binCount - 1, Math.max(0, i))
  }

  for (const b of bars) {
    const up = b.close >= b.open
    const span = b.high - b.low

    if (span <= 0) {
      // Hari tanpa rentang: seluruh volumenya milik satu level harga.
      const slot = acc[indexOf(b.close)]!
      if (up) slot.up += b.volume
      else slot.down += b.volume
      continue
    }

    for (const slot of acc) {
      const overlap = Math.min(b.high, slot.high) - Math.max(b.low, slot.low)
      if (overlap <= 0) continue
      const share = (overlap / span) * b.volume
      if (up) slot.up += share
      else slot.down += share
    }
  }

  const totalVolume = bars.reduce((a, b) => a + b.volume, 0)
  const bins: ProfileBin[] = acc.map((s) => {
    const volume = s.up + s.down
    return {
      low: s.low,
      high: s.high,
      volume,
      upVolume: s.up,
      downVolume: s.down,
      share: totalVolume > 0 ? volume / totalVolume : 0,
    }
  })

  let pocIndex = 0
  for (let i = 1; i < bins.length; i++) {
    if (bins[i]!.volume > bins[pocIndex]!.volume) pocIndex = i
  }

  return { bins, totalVolume, pocIndex }
}
