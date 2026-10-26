import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export type JenisStockbit = 'virtual' | 'real'
type Sesi = { access: string; refresh: string; expiresAt: number }
type Redis = (cmd: (string | number)[]) => Promise<unknown>
export const kunciStockbit = (jenis: JenisStockbit) => ({
  session: `jurnal:stockbit:${jenis}:sesi`, snapshot: `jurnal:stockbit:${jenis}:snapshot`, lock: `jurnal:stockbit:${jenis}:lock`,
})
export const STOCKBIT_KEYS = kunciStockbit('virtual')
const key = (secret: string) => createHash('sha256').update('jurnal-stockbit-v1:' + secret).digest()

export function segelSesi(secret: string, sesi: Sesi, jenis: JenisStockbit = 'virtual'): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from(jenis))
  const data = Buffer.concat([cipher.update(JSON.stringify(sesi)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
}
export function bukaSesi(secret: string, sealed: string, jenis: JenisStockbit = 'virtual'): Sesi {
  const b = Buffer.from(sealed, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key(secret), b.subarray(0, 12))
  decipher.setAAD(Buffer.from(jenis)); decipher.setAuthTag(b.subarray(12, 28))
  const s = JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString())
  if (typeof s.access !== 'string' || !s.access || typeof s.refresh !== 'string' || !s.refresh || !Number.isFinite(s.expiresAt)) throw Error('Sesi tidak sah')
  return s
}

type Obj = Record<string, any>
const obj = (v: unknown): Obj => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Format Stockbit berubah')
  return v as Obj
}
const angka = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v :
  typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v)) ? Number(v) : null
const wajib = (v: unknown) => { const n = angka(v); if (n === null) throw Error('Angka Stockbit tidak terbaca'); return n }
const teks = (v: unknown) => { if (typeof v !== 'string' && typeof v !== 'number') throw Error('Teks Stockbit tidak terbaca'); return String(v) }
const payload = (v: unknown) => {
  const b = obj(v)
  if (b.error || b.error_type || b.success === false) throw Error('Stockbit menolak permintaan')
  const d = b.data
  if (d && !Array.isArray(d) && typeof d === 'object' && 'data' in d) return payload(d)
  return d
}
function tokenDalam(v: unknown, kind: 'access' | 'refresh', depth = 0): Obj | undefined {
  if (!v || typeof v !== 'object' || depth > 8) return
  for (const [k, child] of Object.entries(v)) {
    if ([kind, kind + '_token', kind + 'Token'].includes(k)) {
      if (typeof child === 'string' && child) return { token: child }
      if (child && typeof child === 'object' && typeof (child as Obj).token === 'string') return child as Obj
    }
    const nested = tokenDalam(child, kind, depth + 1)
    if (nested) return nested
  }
}
const rows = (v: unknown): Obj[] => {
  const xs = Array.isArray(v) ? v : obj(v).list ?? obj(v).result ?? obj(v).results
  if (!Array.isArray(xs)) throw Error('Daftar Stockbit tidak terbaca')
  return xs.map(obj)
}
export type SnapshotStockbit = ReturnType<typeof normalisasi>
function normalisasi(jenis: JenisStockbit, porto: unknown, orders: unknown, summary: unknown, now: number) {
  const p = payload(porto)
  const totals = jenis === 'virtual' ? obj(p) : obj(payload(summary)).aggregated_portfolio_summary ?? obj(payload(summary))
  const positions = rows(jenis === 'virtual' ? obj(p).result : p).map((r) => {
    const virtual = jenis === 'virtual'
    const kode = teks(r.symbol ?? r.stock_code)
    if (!/^[A-Z0-9.-]{2,15}$/.test(kode)) throw Error('Kode Stockbit tidak terbaca')
    const lot = wajib(virtual ? r.balance_lot : r.qty?.balance?.lot ?? r.lot)
    if (lot < 0) throw Error('Lot Stockbit tidak sah')
    return { kode, lot, average: angka(virtual ? r.price?.average : r.price?.average?.price),
      market: angka(virtual ? r.price?.market : r.price?.latest),
      marketValue: angka(virtual ? r.unrealized?.market_value : r.asset?.unrealised?.market_value),
      pnl: angka(virtual ? r.unrealized?.profit_loss : r.asset?.unrealised?.profit_loss) }
  })
  const os = rows(payload(orders)).map((r) => ({
    id: teks(r.id ?? r.order_id), kode: teks(r.symbol ?? r.stock_code),
    side: teks(jenis === 'virtual' ? r.action : r.side ?? r.action), status: teks(r.status_text ?? r.status),
    lot: angka(jenis === 'virtual' ? r.total : r.qty?.lot_total ?? r.lot),
    // Prefer explicit Carina lot quantities; legacy done is shares. Never infer fills from status.
    matchedLot: jenis === 'virtual' ? angka(r.done) : angka(r.qty?.lot_done) ?? (angka(r.done) === null ? null : wajib(r.done) / 100),
    price: angka(jenis === 'virtual' ? r.price : r.price?.order ?? r.price),
    createdAt: typeof r.time_utc?.order === 'string' ? r.time_utc.order : typeof r.time?.created === 'string' ? r.time.created : typeof r.created_at === 'string' ? r.created_at : null,
  }))
  const balance = angka(jenis === 'virtual' ? totals.trading_balance : totals.trading?.balance)
  const unrealized = angka(jenis === 'virtual' ? totals.profit_loss?.unrealized : totals.profit_loss?.unrealised)
  if (balance === null && unrealized === null) throw Error('Ringkasan Stockbit tidak terbaca')
  return { jenis, syncedAt: new Date(now).toISOString(), balance, unrealized,
    realized: angka(jenis === 'virtual' ? totals.profit_loss?.realized : totals.profit_loss?.realised), positions, orders: os }
}

/** Only fixed, read-only account routes and credential renewal. No order writes. */
export async function sinkronStockbit(redis: Redis, secret: string, fetcher: typeof fetch = fetch, now = Date.now(), jenis: JenisStockbit = 'virtual') {
  const keys = kunciStockbit(jenis)
  const saved = await redis(['GET', keys.snapshot]) as string | null
  const snapshot = saved ? JSON.parse(saved) as SnapshotStockbit : null
  const result = (warning: string | null) => ({ snapshot, warning })
  if (snapshot && now - Date.parse(snapshot.syncedAt) < 60000) return result(null)
  const lock = randomBytes(24).toString('hex')
  if (await redis(['SET', keys.lock, lock, 'NX', 'PX', 45000]) !== 'OK') return result('Sinkronisasi sedang berjalan. Coba muat ulang sebentar lagi.')
  try {
    const sealed = await redis(['GET', keys.session]) as string | null
    if (!sealed) return result(`Stockbit ${jenis === 'real' ? 'Real' : 'Virtual'} belum dihubungkan.`)
    let sesi = bukaSesi(secret, sealed, jenis)
    const origin = jenis === 'virtual' ? 'https://exodus.stockbit.com' : 'https://carina.stockbit.com'
    const request = async (path: string, token: string, refresh = false) => {
      const res = await fetcher(origin + path, { method: refresh ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { accept: 'application/json', 'accept-language': 'en-US,en;q=0.9',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
          origin: 'https://stockbit.com', referer: 'https://stockbit.com/', authorization: `Bearer ${token}`,
          ...(refresh && jenis === 'real' ? { 'content-type': 'application/json' } : {}) },
        ...(refresh && jenis === 'real' ? { body: JSON.stringify({ refresh_token: token }) } : {}) })
      if (!res.ok) throw Error('Stockbit tidak merespons')
      return res.json()
    }
    if (sesi.expiresAt <= now / 1000 + 60) {
      const d = obj(payload(await request(jenis === 'virtual' ? '/login/refresh' : '/auth/refresh', sesi.refresh, true)))
      const a = tokenDalam(d, 'access')
      const access = teks(a?.token ?? d.token)
      const refresh = teks(tokenDalam(d, 'refresh')?.token ?? sesi.refresh)
      const expiry = d.expired_at ?? d.expires_at ?? a?.expired_at ?? a?.expires_at
      const exp = angka(expiry) ?? (typeof expiry === 'string' ? Date.parse(expiry) / 1000 : null) ?? angka(JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString()).exp)
      if (!exp || !Number.isFinite(exp) || exp <= now / 1000) throw Error('Masa sesi tidak terbaca')
      sesi = { access, refresh, expiresAt: exp }
      // Rotation consumes the old refresh token. Persist before any account request.
      await redis(['SET', keys.session, segelSesi(secret, sesi, jenis)])
    }
    const [porto, orders, summary] = await Promise.all([
      request(jenis === 'virtual' ? '/virtualtrading/portfolio' : '/portfolio/v2/list', sesi.access),
      request(jenis === 'virtual' ? '/virtualtrading/order' : '/order/v2/list', sesi.access),
      jenis === 'real' ? request('/portfolio/v2/summary', sesi.access) : Promise.resolve(null),
    ])
    const fresh = normalisasi(jenis, porto, orders, summary, now)
    await redis(['SET', keys.snapshot, JSON.stringify(fresh)])
    return { snapshot: fresh, warning: null }
  } catch {
    return result('Stockbit belum bisa disinkronkan. Coba lagi; jika tetap gagal, sambungkan ulang sesi Stockbit. Data terakhir tetap ditampilkan.')
  } finally {
    await redis(['EVAL', 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, keys.lock, lock])
  }
}
