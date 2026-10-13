import { expect, test, describe } from 'bun:test'
import { formatVolume, formatPrice, renderSvg, VOLUME_PANEL } from './render.ts'
import { buildChartInput } from './chart.ts'
import type { Bar } from './types.ts'
import { CRYPTO, IDX } from './market.ts'

describe('formatVolume', () => {
  test('ribuan lot pakai K dengan dua desimal', () => {
    // "721.57K" persis seperti badge volume di BBCA.png.
    expect(formatVolume(721574)).toBe('721.57K')
  })

  test('jutaan lot pakai M', () => {
    expect(formatVolume(1210000)).toBe('1.21M')
  })

  test('nilai bulat tidak menyisakan desimal nol', () => {
    expect(formatVolume(16000000)).toBe('16M')
    expect(formatVolume(4000000)).toBe('4M')
  })

  test('di bawah seribu ditulis apa adanya', () => {
    expect(formatVolume(940)).toBe('940')
  })

  test('nol tetap nol', () => {
    expect(formatVolume(0)).toBe('0')
  })
})

describe('formatPrice', () => {
  test('ribuan dipisah koma seperti TradingView', () => {
    expect(formatPrice(6350)).toBe('6,350')
    expect(formatPrice(9000)).toBe('9,000')
  })

  test('harga pecahan dibulatkan ke dua desimal', () => {
    expect(formatPrice(1234.567)).toBe('1,234.57')
  })
})

describe('renderSvg', () => {
  function bars(count: number): Bar[] {
    return Array.from({ length: count }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 1000 + i,
      high: 1010 + i,
      low: 990 + i,
      close: 1005 + i,
      volume: 1_000_000 + i,
    }))
  }
  const input = buildChartInput({ name: 'Uji Tbk.', symbol: 'UJI.JK', bars: bars(300) }, 250, 24)
  const svg = renderSvg(input)

  test('menghasilkan SVG berukuran tetap', () => {
    expect(svg).toStartWith('<svg')
    expect(svg).toContain('width="2000"')
    expect(svg).toContain('</svg>')
  })

  test('satu badan candle per bar yang digambar', () => {
    const bodies = svg.match(/class="candle"/g) ?? []
    expect(bodies).toHaveLength(250)
  })

  test('kelima MA harga digambar sebagai polyline', () => {
    for (const p of [10, 20, 50, 100, 200]) {
      expect(svg).toContain(`class="ma ma-${p}"`)
    }
  })

  test('MA volume digambar', () => {
    expect(svg).toContain('class="vol-ma"')
  })

  test('profil volume digambar terbelah naik/turun per bin, seperti Up/Down TradingView', () => {
    expect(svg.match(/class="vp-bin vp-up"/g) ?? []).toHaveLength(24)
    expect(svg.match(/class="vp-bin vp-down"/g) ?? []).toHaveLength(24)
  })

  test('legenda memuat nama emiten dan OHLC bar terakhir', () => {
    expect(svg).toContain('Uji Tbk.')
    expect(svg).toContain('1,304') // close bar terakhir: 1005 + 299
  })

  test('gambar memberi label bahwa profil volume adalah aproksimasi', () => {
    expect(svg.toLowerCase()).toContain('aproksimasi')
  })

  test('volume ditulis dalam lot, bukan lembar', () => {
    expect(svg).toContain('lot')
  })

  test('emiten tanpa riwayat cukup untuk MA 200 tetap bisa digambar', () => {
    const short = buildChartInput({ name: 'Baru Tbk.', symbol: 'BARU.JK', bars: bars(30) }, 250, 24)
    expect(() => renderSvg(short)).not.toThrow()
  })
})

describe('label nilai terakhir pada panel volume', () => {
  /** Volume rata membuat MA volume jatuh persis di volume hari terakhir. */
  function flatVolume(count: number): Bar[] {
    return Array.from({ length: count }, (_, i) => ({
      date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 1000,
      high: 1010,
      low: 990,
      close: 1005,
      volume: 5_000_000,
    }))
  }

  test('badge volume dan badge MA volume tidak saling tindih', () => {
    const input = buildChartInput(
      { name: 'Rata Tbk.', symbol: 'RATA.JK', bars: flatVolume(120) },
      100,
      24,
    )
    const svg = renderSvg(input)
    const ys = [...svg.matchAll(/class="(vol-badge|vol-ma-badge)"[^>]*\by="([-\d.]+)"/g)].map((m) =>
      Number(m[2]),
    )
    expect(ys).toHaveLength(2)
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(18)
  })

  test('badge volume tetap di dalam panel volume', () => {
    const input = buildChartInput(
      { name: 'Rata Tbk.', symbol: 'RATA.JK', bars: flatVolume(120) },
      100,
      24,
    )
    const svg = renderSvg(input)
    const ys = [...svg.matchAll(/class="(vol-badge|vol-ma-badge)"[^>]*\by="([-\d.]+)"/g)].map((m) =>
      Number(m[2]),
    )
    for (const yy of ys) {
      expect(yy).toBeGreaterThanOrEqual(VOLUME_PANEL.top)
      expect(yy + 18).toBeLessThanOrEqual(VOLUME_PANEL.bottom)
    }
  })
})

describe('footer sumber data', () => {
  const bars = (n = 30): Bar[] =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 100, high: 105, low: 95, close: 100 + i, volume: 1_000_000,
    }))

  test('emiten IDX tetap dicetak dengan sufiks .JK', () => {
    const input = buildChartInput({ symbol: 'BBCA.JK', name: 'Bank Central Asia Tbk.', bars: bars() }, 30, 24)
    expect(renderSvg(input)).toContain('Yahoo Finance BBCA.JK')
  })

  test('pasangan crypto TIDAK dicetak dengan sufiks .JK', () => {
    // Simbolnya sudah lengkap; menempelkan .JK membuat footer berbohong soal sumbernya.
    const input = buildChartInput({ symbol: 'BTC-USD', name: 'Bitcoin USD', bars: bars() }, 30, 24)
    const svg = renderSvg(input)
    expect(svg).toContain('Yahoo Finance BTC-USD')
    expect(svg).not.toContain('BTC-USD.JK')
  })
})

describe('panel volume mengikuti satuan pasar', () => {
  const bars30 = (): Bar[] =>
    Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 100, high: 105, low: 95, close: 100 + i, volume: 1_000_000,
    }))

  test('IDX membagi volume jadi lot dan menyebutnya lot', () => {
    const svg = renderSvg(buildChartInput({ symbol: 'BBCA.JK', name: 'BCA', bars: bars30() }, 30, 24), IDX)
    expect(svg).toContain('— lot')
    expect(svg).toContain('10K') // 1.000.000 lembar = 10.000 lot
  })

  test('crypto memakai volume USD apa adanya, bar dan MA satu skala', () => {
    // Kalau MA volume masih dibagi 100 sementara batangnya tidak, garisnya jatuh
    // 100x di bawah batang — salah yang langsung terlihat begitu digambar.
    const svg = renderSvg(buildChartInput({ symbol: 'BTC-USD', name: 'Bitcoin USD', bars: bars30() }, 30, 24), CRYPTO)
    expect(svg).toContain('— USD')
    expect(svg).toContain('1M')
    expect(svg).not.toContain('10K')
  })

  test('judul memakai label bursa pasarnya', () => {
    const idx = renderSvg(buildChartInput({ symbol: 'BBCA.JK', name: 'BCA', bars: bars30() }, 30, 24), IDX)
    const coin = renderSvg(buildChartInput({ symbol: 'BTC-USD', name: 'Bitcoin USD', bars: bars30() }, 30, 24), CRYPTO)
    expect(idx).toContain('1D, IDX')
    expect(coin).toContain('1D, CRYPTO')
    expect(coin).not.toContain('1D, IDX')
  })
})
