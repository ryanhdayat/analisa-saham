import { expect, test, describe } from 'bun:test'
import { analyzeVpa } from './vpa.ts'
import type { Level, LevelsRead } from './levels.ts'
import type { Bar } from '../types.ts'

let day = 0
function nextDate(): string {
  day++
  return new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString().slice(0, 10)
}

function make(
  count: number,
  fn: (i: number) => { o: number; h: number; l: number; c: number; v: number },
): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const { o, h, l, c, v } = fn(i)
    return { date: nextDate(), open: o, high: h, low: l, close: c, volume: v }
  })
}

/** Dasar tenang: harga 1.000, rentang 20, volume 1 juta. */
const tenang = (count: number) =>
  make(count, () => ({ o: 1000, h: 1010, l: 990, c: 1000, v: 1_000_000 }))

const level = (price: number): Level => ({
  price,
  score: 0.8,
  touches: 5,
  volumeShare: 0.2,
  lastTouchDate: '2026-01-01',
  barsSinceTouch: 3,
  isRound: true,
})
const levels = (supports: number[], resistances: number[] = []): LevelsRead => ({
  supports: supports.map(level),
  resistances: resistances.map(level),
})

describe('analyzeVpa', () => {
  test('selling climax: volume raksasa, low menembus, close di sepertiga atas', () => {
    const bars = [
      ...tenang(25),
      ...make(5, (i) => ({ o: 1000 - i * 20, h: 1005 - i * 20, l: 985 - i * 20, c: 990 - i * 20, v: 1_200_000 })),
      ...make(1, () => ({ o: 900, h: 910, l: 820, c: 902, v: 5_000_000 })),
    ]
    // Support sengaja ditaruh DI BAWAH low bar ini (820), supaya yang diuji climax,
    // bukan spring — bar yang menembus support lalu pulih diklasifikasi sebagai spring.
    const events = analyzeVpa(bars, levels([800])).value!.events
    expect(events.some((e) => e.signal === 'stopping-volume')).toBe(true)
  })

  test('no supply: bar turun, spread sempit, volume kering, di atas support', () => {
    const bars = [...tenang(25), ...make(1, () => ({ o: 1000, h: 1002, l: 996, c: 997, v: 300_000 }))]
    const events = analyzeVpa(bars, levels([950])).value!.events
    expect(events.some((e) => e.signal === 'no-supply')).toBe(true)
  })

  test('no demand: bar naik tapi volumenya kering', () => {
    const bars = [...tenang(25), ...make(1, () => ({ o: 1000, h: 1012, l: 999, c: 1008, v: 250_000 }))]
    const events = analyzeVpa(bars, levels([950])).value!.events
    expect(events.some((e) => e.signal === 'no-demand')).toBe(true)
  })

  test('upthrust: menembus high sebelumnya lalu ditutup di sepertiga bawah', () => {
    const bars = [...tenang(25), ...make(1, () => ({ o: 1005, h: 1080, l: 1000, c: 1010, v: 2_500_000 }))]
    const events = analyzeVpa(bars, levels([950], [1015])).value!.events
    expect(events.some((e) => e.signal === 'upthrust')).toBe(true)
  })

  test('spring: menembus support lalu ditutup kembali di atasnya', () => {
    const bars = [...tenang(25), ...make(1, () => ({ o: 1000, h: 1005, l: 930, c: 985, v: 2_200_000 }))]
    const events = analyzeVpa(bars, levels([960])).value!.events
    expect(events.some((e) => e.signal === 'spring')).toBe(true)
  })

  test('pasar tenang tanpa apa-apa tidak memunculkan sinyal', () => {
    expect(analyzeVpa(tenang(40), levels([900])).value!.events).toHaveLength(0)
  })

  test('tiap kejadian membawa tanggal dan RVOL-nya, bukan cuma nama sinyal', () => {
    const bars = [...tenang(25), ...make(1, () => ({ o: 1000, h: 1002, l: 996, c: 997, v: 300_000 }))]
    const e = analyzeVpa(bars, levels([950])).value!.events[0]!
    expect(e.date).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(typeof e.rvol).toBe('number')
  })

  test('keyakinan tidak pernah tinggi — ini aturan heuristik, bukan vonis', () => {
    const bars = [...tenang(25), ...make(1, () => ({ o: 1000, h: 1005, l: 930, c: 985, v: 2_200_000 }))]
    expect(analyzeVpa(bars, levels([960])).confidence).not.toBe('tinggi')
  })

  test('bar terlalu sedikit menghasilkan available false', () => {
    expect(analyzeVpa(tenang(5), levels([900])).available).toBe(false)
  })
})
