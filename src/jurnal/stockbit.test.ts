import { expect, test } from 'bun:test'
import { bukaSesi, segelSesi, sinkronStockbit, STOCKBIT_KEYS, kunciStockbit } from './stockbit.ts'

const secret = 'kunci-tes-012345678901234567890123456789'
const now = 1793000000000
const session = { access: 'access-rahasia', refresh: 'refresh-rahasia', expiresAt: now / 1000 + 3600 }
const portfolio = { trading_balance: 120000, profit_loss: { unrealized: 1500, realized: 0 }, result: [
  { symbol: 'ABCD', balance_lot: 2, price: { average: 1002, market: 1010 }, unrealized: { market_value: 202000, profit_loss: 1600, gain: 0.00798 } },
] }
const orders = [{ id: '123', symbol: 'ABCD', action: 'BUY', status: 'MATCH', total: 2, done: 2, price: 1000, price_average: 1002, time: { created: '2026-10-26T03:00:00Z', match: '2026-10-26T03:00:00Z' } },
  { id: '124', symbol: 'EFGH', action: 'BUY', status: 'REJECTED', total: 1, done: 0, price: 500, time: { created: '2026-10-26T03:00:00Z' } }]
function fixture(expired = false) {
  const values = new Map<string, string>([[STOCKBIT_KEYS.session, segelSesi(secret, { ...session, expiresAt: expired ? 1 : session.expiresAt })]])
  const calls: string[] = []
  const redis = async (cmd: (string | number)[]) => {
    const [op, key, value] = cmd
    if (op === 'GET') return values.get(String(key)) ?? null
    if (op === 'SET') {
      if (cmd.includes('NX') && values.has(String(key))) return null
      values.set(String(key), String(value)); return 'OK'
    }
    if (op === 'HSET') { values.set(String(key) + ':' + cmd[2], String(cmd[3])); return 1 }
    if (op === 'HGETALL') return [...values].filter(([k]) => k.startsWith(String(key) + ':')).flatMap(([k, v]) => [k.slice(String(key).length + 1), v])
    if (op === 'EVAL') { if (values.get(String(cmd[3])) === cmd[4]) values.delete(String(cmd[3])); return 1 }
    throw Error('Perintah tak diharapkan: ' + op)
  }
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url))
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('user-agent')).toContain('Mozilla/5.0')
    expect(new Headers(init?.headers).get('accept-language')).toBe('en-US,en;q=0.9')
    if (String(url).endsWith('/login/refresh')) {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer refresh-rahasia')
      return Response.json({ data: { data: { token_data: { access: { token: 'access-baru', expired_at: now / 1000 + 3600 }, refresh: { token: 'refresh-baru' } } } } })
    }
    expect(new Headers(init?.headers).get('authorization')).toBe(expired ? 'Bearer access-baru' : 'Bearer access-rahasia')
    return Response.json({ data: String(url).endsWith('/portfolio') ? portfolio : orders })
  }) as typeof fetch
  return { values, redis, fetcher, calls }
}
test('snapshot porto dan order berasal dari Stockbit, tanpa token dalam respons', async () => {
  const f = fixture()
  const r = await sinkronStockbit(f.redis, secret, f.fetcher, now)
  expect(r.warning).toBeNull()
  expect(r.snapshot?.positions[0]).toMatchObject({ kode: 'ABCD', lot: 2, average: 1002, market: 1010, pnl: 1600 })
  expect(r.snapshot?.orders[1]).toMatchObject({ status: 'REJECTED', matchedLot: 0 })
  expect(r.snapshot?.syncedAt).toBe(new Date(now).toISOString())
  expect(JSON.stringify(r)).not.toMatch(/access-rahasia|refresh-rahasia/)
  await sinkronStockbit(f.redis, secret, f.fetcher, now + 1000)
  expect(f.calls).toHaveLength(2)
})
test('token expired dirotasi satu kali dan disimpan terenkripsi', async () => {
  const f = fixture(true)
  await sinkronStockbit(f.redis, secret, f.fetcher, now)
  expect(f.calls.filter((s) => s.endsWith('/login/refresh'))).toHaveLength(1)
  const sealed = f.values.get(STOCKBIT_KEYS.session)!
  expect(sealed).not.toContain('refresh-baru')
  expect(bukaSesi(secret, sealed).refresh).toBe('refresh-baru')
  expect(() => bukaSesi(secret + 'lain', sealed)).toThrow()
})
test('upstream gagal/rusak mempertahankan snapshot dan waktu sinkron asli', async () => {
  const f = fixture()
  const first = await sinkronStockbit(f.redis, secret, f.fetcher, now)
  for (const response of [new Response('{}', { status: 401 }), Response.json({ data: { result: [] } })]) {
    const r = await sinkronStockbit(f.redis, secret, (async () => response.clone()) as unknown as typeof fetch, now + 61000)
    expect(r.snapshot).toEqual(first.snapshot)
    expect(r.warning).toBeTruthy()
    expect(JSON.stringify(r)).not.toContain('rahasia')
  }
})
test('Real memakai sesi, snapshot dan unit lot sendiri; tidak mengambil Virtual', async () => {
  const f = fixture()
  const virtual = await sinkronStockbit(f.redis, secret, f.fetcher, now)
  const absent = await sinkronStockbit(f.redis, secret, f.fetcher, now, 'real')
  expect(absent.snapshot).toBeNull()
  expect(absent.warning).toContain('Real belum dihubungkan')
  const sealed = segelSesi(secret, session, 'real')
  expect(() => bukaSesi(secret, sealed, 'virtual')).toThrow()
  f.values.set(kunciStockbit('real').session, sealed)
  const fetcher = (async (url: string | URL | Request) => {
    expect(String(url)).toStartWith('https://carina.stockbit.com/')
    if (String(url).endsWith('/summary')) return Response.json({ data: { aggregated_portfolio_summary: { trading: { balance: 800000 }, profit_loss: { unrealised: -2000, realised: 0 } } } })
    if (String(url).includes('/order/')) return Response.json({ data: { list: [{ order_id: 'real123', stock_code: 'EFGH', action: 'BUY', status: 'MATCH', lot: 3, done: 300, price: 1000 }] } })
    return Response.json({ data: { list: [{ stock_code: 'EFGH', qty: { balance: { lot: 3 } }, price: { average: { price: 1000 }, latest: 990 }, asset: { unrealised: { market_value: 297000, profit_loss: -3000 } } }] } })
  }) as typeof fetch
  const real = await sinkronStockbit(f.redis, secret, fetcher, now, 'real')
  expect(real.warning).toBeNull()
  expect(real.snapshot).toMatchObject({ jenis: 'real', balance: 800000, positions: [{ kode: 'EFGH', lot: 3 }], orders: [{ matchedLot: 3 }] })
  expect(JSON.parse(f.values.get(STOCKBIT_KEYS.snapshot)!)).toEqual(virtual.snapshot)
})
test('request bersamaan tidak merotasi credential yang sama', async () => {
  const f = fixture(true)
  const results = await Promise.all([sinkronStockbit(f.redis, secret, f.fetcher, now), sinkronStockbit(f.redis, secret, f.fetcher, now)])
  expect(f.calls.filter((s) => s.endsWith('/login/refresh'))).toHaveLength(1)
  expect(results.some((r) => r.snapshot?.positions.length === 1)).toBe(true)
})
test('tanpa koneksi menampilkan status belum terhubung, bukan porto kosong palsu', async () => {
  const f = fixture(); f.values.clear()
  const r = await sinkronStockbit(f.redis, secret, f.fetcher, now)
  expect(r.snapshot).toBeNull()
  expect(r.warning).toContain('belum dihubungkan')
  expect(f.calls).toHaveLength(0)
})
test('penolakan aplikasi HTTP 200 tidak mengganti snapshot yang sah', async () => {
  const f = fixture()
  const first = await sinkronStockbit(f.redis, secret, f.fetcher, now)
  for (const flag of [{ success: false }, { error: 'ditolak' }, { error_type: 'expired' }]) {
    const broken = (async (url: string | URL | Request) => Response.json({ ...flag, data: String(url).endsWith('/portfolio') ? portfolio : orders })) as typeof fetch
    const r = await sinkronStockbit(f.redis, secret, broken, now + 61000)
    expect(r.warning).toBeTruthy()
    expect(r.snapshot).toEqual(first.snapshot)
  }
})
test('Real refresh menggunakan bearer dan body serta menyimpan token dari envelope bertingkat', async () => {
  const f = fixture()
  const keys = kunciStockbit('real')
  f.values.set(keys.session, segelSesi(secret, { ...session, expiresAt: 1 }, 'real'))
  let refreshed = 0
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/auth/refresh')) {
      refreshed++
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer refresh-rahasia')
      expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'refresh-rahasia' })
      return Response.json({ data: { auth: { access: { token: 'access-real', expires_at: now / 1000 + 3600 }, refresh: { token: 'refresh-real' } } } })
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-real')
    expect(bukaSesi(secret, f.values.get(keys.session)!, 'real').refresh).toBe('refresh-real')
    if (String(url).endsWith('/summary')) return Response.json({ data: { trading: { balance: 0 }, profit_loss: { unrealised: 0, realised: 0 } } })
    return Response.json({ data: { list: [] } })
  }) as typeof fetch
  const r = await sinkronStockbit(f.redis, secret, fetcher, now, 'real')
  expect(refreshed).toBe(1)
  expect(r.warning).toBeNull()
  expect(r.snapshot?.jenis).toBe('real')
})
