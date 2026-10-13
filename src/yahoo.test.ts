import { expect, test, describe } from 'bun:test'
import { parseChartResponse, toLots, toSymbol } from './yahoo.ts'
import { CRYPTO, IDX } from './market.ts'

/** Bentuk balasan Yahoo yang dipangkas seperlunya. */
function response(
  timestamp: number[],
  quote: Record<string, Array<number | null>>,
  meta: Record<string, unknown> = {},
) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: 'BBCA.JK', exchangeTimezoneName: 'Asia/Jakarta', ...meta },
          timestamp,
          indicators: { quote: [quote] },
        },
      ],
      error: null,
    },
  }
}

describe('parseChartResponse', () => {
  test('mengubah timestamp jadi tanggal bursa Asia/Jakarta', () => {
    const json = response([1789524000], {
      open: [6350],
      high: [6425],
      low: [6325],
      close: [6325],
      volume: [72157400],
    })
    const { bars } = parseChartResponse(json)
    expect(bars).toHaveLength(1)
    expect(bars[0]).toEqual({
      date: '2026-09-16',
      open: 6350,
      high: 6425,
      low: 6325,
      close: 6325,
      volume: 72157400,
    })
  })

  test('membuang bar yang salah satu medannya null', () => {
    const json = response([1, 2, 3], {
      open: [100, null, 102],
      high: [110, null, 112],
      low: [90, null, 92],
      close: [105, null, 108],
      volume: [1000, null, 1200],
    })
    const { bars } = parseChartResponse(json)
    expect(bars).toHaveLength(2)
    expect(bars.map((b) => b.close)).toEqual([105, 108])
  })

  test('membuang bar yang volumenya saja null', () => {
    const json = response([1, 2], {
      open: [100, 101],
      high: [110, 111],
      low: [90, 91],
      close: [105, 106],
      volume: [1000, null],
    })
    expect(parseChartResponse(json).bars).toHaveLength(1)
  })

  test('mengambil longName untuk legenda, jatuh ke simbol kalau tidak ada', () => {
    const named = response([1789524000], {
      open: [1], high: [1], low: [1], close: [1], volume: [1],
    }, { longName: 'Bank Central Asia Tbk.' })
    expect(parseChartResponse(named).name).toBe('Bank Central Asia Tbk.')

    const unnamed = response([1789524000], {
      open: [1], high: [1], low: [1], close: [1], volume: [1],
    })
    expect(parseChartResponse(unnamed).name).toBe('BBCA.JK')
  })

  test('melempar pesan jelas kalau Yahoo mengembalikan error', () => {
    const json = { chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }
    expect(() => parseChartResponse(json)).toThrow(/delisted/)
  })

  test('melempar kalau tidak ada satu pun bar yang sah', () => {
    const json = response([1, 2], {
      open: [null, null], high: [null, null], low: [null, null],
      close: [null, null], volume: [null, null],
    })
    expect(() => parseChartResponse(json)).toThrow(/tidak ada bar/i)
  })
})

describe('toLots', () => {
  test('volume lembar dibagi 100 jadi lot, seperti tampilan TradingView', () => {
    // BBCA 2026-09-16: Yahoo 72.157.400 lembar = 721.574 lot = "721.57K" di TradingView.
    expect(toLots(72157400)).toBe(721574)
  })
})

describe('toSymbol', () => {
  test('kode emiten IDX diberi sufiks .JK', () => {
    expect(toSymbol('bbca')).toBe('BBCA.JK')
  })

  test('simbol indeks berawalan ^ TIDAK diberi sufiks', () => {
    // ^JKSE.JK tidak ada; menambahkan sufiks membuat IHSG selalu gagal 404.
    expect(toSymbol('^JKSE')).toBe('^JKSE')
  })

  test('kode yang sudah bersufiks dibiarkan', () => {
    expect(toSymbol('BBCA.JK')).toBe('BBCA.JK')
  })

  test('tanpa pasar disebut, perilakunya tetap IDX', () => {
    // Bawaan IDX menjaga pemanggil lama tidak berubah artinya.
    expect(toSymbol('bbca')).toBe(toSymbol('bbca', IDX))
  })

  test('pasar crypto tidak menambah sufiks .JK', () => {
    // BTC-USD.JK tidak ada; inilah satu-satunya penghalang nyata untuk crypto.
    expect(toSymbol('BTC-USD', CRYPTO)).toBe('BTC-USD')
    expect(toSymbol('eth-usd', CRYPTO)).toBe('ETH-USD')
  })
})
