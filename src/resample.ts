import type { Bar } from './types.ts'

/**
 * Kunci pekan ISO (Senin sebagai hari pertama) dalam bentuk `YYYY-Www`.
 * Dipakai untuk mengelompokkan, bukan untuk ditampilkan.
 */
function isoWeekKey(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  // UTC supaya zona waktu mesin tidak menggeser hari.
  const t = new Date(Date.UTC(y, m - 1, d))
  const day = t.getUTCDay() || 7 // Minggu 0 → 7
  t.setUTCDate(t.getUTCDate() + 4 - day) // geser ke Kamis pekan itu
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Bar mingguan dari bar harian, untuk timeframe kedua pada analisis struktur.
 * Diresample dari deret yang sudah ada — tidak ada permintaan jaringan tambahan.
 *
 * Bar mingguan diberi tanggal **hari bursa pertama** pekan itu, bukan Senin kalender,
 * supaya tanggalnya selalu menunjuk hari yang benar-benar diperdagangkan.
 */
export function toWeekly(daily: Bar[]): Bar[] {
  const weeks = new Map<string, Bar[]>()
  for (const bar of daily) {
    const key = isoWeekKey(bar.date)
    const group = weeks.get(key)
    if (group) group.push(bar)
    else weeks.set(key, [bar])
  }

  return [...weeks.values()].map((group) => ({
    date: group[0]!.date,
    open: group[0]!.open,
    high: Math.max(...group.map((b) => b.high)),
    low: Math.min(...group.map((b) => b.low)),
    close: group[group.length - 1]!.close,
    volume: group.reduce((a, b) => a + b.volume, 0),
  }))
}
