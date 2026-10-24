import { expect, test, describe } from 'bun:test'
import { idxTickSize, roundToTick, findLevels, recencyWeight, clusterTolerance, floorToTick } from './levels.ts'
import { volumeProfile } from '../indicators.ts'
import { atr } from './volatility.ts'
import type { Bar } from '../types.ts'

describe('idxTickSize', () => {
  test('mengikuti tabel fraksi harga IDX', () => {
    expect(idxTickSize(150)).toBe(1)
    expect(idxTickSize(200)).toBe(2)
    expect(idxTickSize(499)).toBe(2)
    expect(idxTickSize(500)).toBe(5)
    expect(idxTickSize(1999)).toBe(5)
    expect(idxTickSize(2000)).toBe(10)
    expect(idxTickSize(4999)).toBe(10)
    expect(idxTickSize(5000)).toBe(25)
    expect(idxTickSize(9000)).toBe(25)
  })
})

describe('roundToTick', () => {
  test('membulatkan ke fraksi yang sah di harganya', () => {
    expect(roundToTick(6337)).toBe(6325) // fraksi 25
    expect(roundToTick(1003)).toBe(1005) // fraksi 5
  })
})

/** Deret yang memantul berulang di satu harga, lalu berakhir di tengah rentang. */
function bouncing(): Bar[] {
  const bars: Bar[] = []
  let day = 0
  const nextDate = () => {
    day++
    return new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString().slice(0, 10)
  }
  const push = (price: number, vol = 1_000_000) => {
    const prev = bars[bars.length - 1]?.close ?? price
    bars.push({ date: nextDate(), open: prev, high: price + 10, low: price - 10, close: price, volume: vol })
  }
  // Lima kali menguji 5.000 dari bawah lalu mundur — resistance kuat di 5.000.
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const p of [4700, 4850, 4990, 4850, 4700]) push(p, cycle === 2 ? 3_000_000 : 1_000_000)
  }
  // Berakhir di tengah.
  for (const p of [4750, 4800, 4820]) push(p)
  return bars
}

describe('findLevels', () => {
  const bars = bouncing()
  const profile = volumeProfile(bars, 24)
  const a = atr(bars, 14)
  const result = findLevels(bars, profile, a[a.length - 1] ?? 50)

  test('harga yang berulang kali ditolak muncul sebagai resistance', () => {
    const near5000 = result.value!.resistances.find((r) => Math.abs(r.price - 5000) < 60)
    expect(near5000).toBeDefined()
    expect(near5000!.touches).toBeGreaterThanOrEqual(3)
  })

  test('support ada di bawah harga terakhir, resistance di atasnya', () => {
    const close = bars[bars.length - 1]!.close
    for (const s of result.value!.supports) expect(s.price).toBeLessThan(close)
    for (const r of result.value!.resistances) expect(r.price).toBeGreaterThan(close)
  })

  test('paling banyak tiga level tiap arah', () => {
    expect(result.value!.supports.length).toBeLessThanOrEqual(3)
    expect(result.value!.resistances.length).toBeLessThanOrEqual(3)
  })

  test('skor tiap level berada di 0..1 dan terurut menurun', () => {
    for (const list of [result.value!.supports, result.value!.resistances]) {
      for (const l of list) {
        expect(l.score).toBeGreaterThanOrEqual(0)
        expect(l.score).toBeLessThanOrEqual(1)
      }
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1]!.score).toBeGreaterThanOrEqual(list[i]!.score)
      }
    }
  })

  test('tiap level membawa komponen penilaiannya, bukan cuma angka akhir', () => {
    const l = result.value!.resistances[0]!
    expect(l).toHaveProperty('touches')
    expect(l).toHaveProperty('volumeShare')
    expect(l).toHaveProperty('barsSinceTouch')
    expect(l).toHaveProperty('isRound')
  })

  test('level dibulatkan ke fraksi harga IDX yang sah', () => {
    for (const l of [...result.value!.supports, ...result.value!.resistances]) {
      expect(l.price % idxTickSize(l.price)).toBe(0)
    }
  })

  test('bobot kebaruan meluruh: level lama bernilai lebih rendah dari yang baru disentuh', () => {
    expect(recencyWeight(0)).toBeCloseTo(1, 9)
    expect(recencyWeight(2)).toBeGreaterThan(recencyWeight(200))
    expect(recencyWeight(200)).toBeGreaterThan(0)
    expect(recencyWeight(60)).toBeCloseTo(0.5, 2)
  })

  test('bukti menyebut harga level dan jumlah sentuhannya', () => {
    expect(result.evidence.some((e) => /sentuh/i.test(e))).toBe(true)
  })

  test('deret terlalu pendek menghasilkan available false', () => {
    const pendek = bars.slice(0, 5)
    expect(findLevels(pendek, volumeProfile(pendek, 24), 50).available).toBe(false)
  })
})

describe('level tempat harga SEDANG BERDIRI bukan support maupun resistance', () => {
  /** Harga memantul di 1.000 berkali-kali lalu ditutup persis di sana. */
  function berdiriDiLevel(): Bar[] {
    const bars: Bar[] = []
    let day = 0
    const next = () => {
      day++
      return new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString().slice(0, 10)
    }
    const push = (price: number) => {
      const prev = bars[bars.length - 1]?.close ?? price
      bars.push({ date: next(), open: prev, high: price + 12, low: price - 12, close: price, volume: 1_000_000 })
    }
    for (let i = 0; i < 6; i++) for (const p of [940, 1000, 1060, 1000]) push(p)
    push(1000) // ditutup persis di level yang berulang kali diuji
    return bars
  }

  const bars = berdiriDiLevel()
  const profile = volumeProfile(bars, 24)
  const a = atr(bars, 14)
  const atrValue = a[a.length - 1] ?? 20
  const close = bars[bars.length - 1]!.close
  const tol = clusterTolerance(close, atrValue)
  const result = findLevels(bars, profile, atrValue)

  test('tidak ada level yang dilaporkan berada di dalam pita toleransi harga', () => {
    for (const l of [...result.value!.supports, ...result.value!.resistances]) {
      expect(Math.abs(l.price - close)).toBeGreaterThan(tol)
    }
  })

  test('support yang tersisa benar-benar di bawah pita, resistance benar-benar di atas', () => {
    for (const s of result.value!.supports) expect(s.price).toBeLessThan(close - tol)
    for (const r of result.value!.resistances) expect(r.price).toBeGreaterThan(close + tol)
  })

  test('toleransi klaster adalah yang terlebar antara 1,5% harga dan setengah ATR', () => {
    expect(clusterTolerance(1000, 10)).toBeCloseTo(15, 9) // 1,5% menang
    expect(clusterTolerance(1000, 100)).toBeCloseTo(50, 9) // setengah ATR menang
  })
})

describe('floorToTick', () => {
  test('membulatkan ke bawah ke fraksi BEI', () => {
    expect(floorToTick(10552)).toBe(10550) // fraksi 25
    expect(floorToTick(1083.2)).toBe(1080) // fraksi 5
    expect(floorToTick(4929.33)).toBe(4920) // fraksi 10
    expect(floorToTick(2100)).toBe(2100)
  })
})
