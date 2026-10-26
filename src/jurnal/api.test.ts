import { describe, expect, test } from 'bun:test'
import { tangani, validasi, type Entri } from './api.ts'

const KUNCI = 'kunci-rahasia-untuk-tes-0123456789'
const ENV = { JURNAL_KUNCI: KUNCI, KV_REST_API_URL: 'https://redis.tes', KV_REST_API_TOKEN: 'tok' }
const URL_API = 'https://situs.tes/api/jurnal'

/** Redis palsu: hash di memori, menjawab perintah REST Upstash. */
function redisPalsu() {
  const hash = new Map<string, string>()
  const fetcher = (async (_url: string, init: RequestInit) => {
    const [op, , ...arg] = JSON.parse(String(init.body)) as string[]
    let result: unknown = null
    if (op === 'HGETALL') result = [...hash].flat()
    if (op === 'HGET') result = hash.get(arg[0]!) ?? null
    if (op === 'HSET') { hash.set(arg[0]!, arg[1]!); result = 1 }
    if (op === 'HSETNX') result = hash.has(arg[0]!) ? 0 : (hash.set(arg[0]!, arg[1]!), 1)
    if (op === 'HDEL') result = hash.delete(arg[0]!) ? 1 : 0
    return new Response(JSON.stringify({ result }))
  }) as unknown as typeof fetch
  let disentuh = 0
  const terhitung = ((u: string, i: RequestInit) => (disentuh++, fetcher(u, i))) as unknown as typeof fetch
  return { hash, fetcher: terhitung, disentuh: () => disentuh }
}

// Angka rekaan, bukan transaksi siapa pun.
const entri: Entri = {
  id: 'a1b2c3d4-0000',
  kode: 'ABCD',
  rencana: '2026-01-05',
  beli: { tanggal: '2026-01-06', harga: 1000, lot: 10 },
  jual: null,
  catatan: 'contoh',
}
const jual = { tanggal: '2026-01-08', harga: 1100 }

const minta = (method: string, opsi: { body?: unknown; cookie?: string; query?: string } = {}) =>
  new Request(URL_API + (opsi.query ?? ''), {
    method,
    headers: {
      ...(opsi.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opsi.cookie ? { cookie: opsi.cookie } : {}),
    },
    body: opsi.body !== undefined ? JSON.stringify(opsi.body) : undefined,
  })

async function masuk(fetcher: typeof fetch): Promise<string> {
  const r = await tangani(minta('POST', { query: '?aksi=masuk', body: { kunci: KUNCI } }), ENV, fetcher)
  expect(r.status).toBe(204)
  const set = r.headers.get('set-cookie')!
  expect(set).toContain('HttpOnly')
  expect(set).toContain('Secure')
  expect(set).toContain('SameSite=Strict')
  return set.split(';')[0]!
}

describe('akses', () => {
  test('tanpa cookie: 401, Redis tidak disentuh', async () => {
    const r = redisPalsu()
    expect((await tangani(minta('GET'), ENV, r.fetcher)).status).toBe(401)
    expect(r.disentuh()).toBe(0)
  })
  test('kunci salah: 401, tanpa cookie', async () => {
    const { fetcher } = redisPalsu()
    const r = await tangani(minta('POST', { query: '?aksi=masuk', body: { kunci: 'salah' } }), ENV, fetcher)
    expect(r.status).toBe(401)
    expect(r.headers.get('set-cookie')).toBeNull()
  })
  test('cookie palsu: 401', async () => {
    const { fetcher } = redisPalsu()
    expect((await tangani(minta('GET', { cookie: 'jurnal_sesi=palsu' }), ENV, fetcher)).status).toBe(401)
  })
  test('ganti kunci membatalkan sesi lama', async () => {
    const { fetcher } = redisPalsu()
    const cookie = await masuk(fetcher)
    const r = await tangani(minta('GET', { cookie }), { ...ENV, JURNAL_KUNCI: KUNCI + '-baru' }, fetcher)
    expect(r.status).toBe(401)
  })
  test('kunci belum disetel atau terlalu pendek: 503', async () => {
    const { fetcher } = redisPalsu()
    expect((await tangani(minta('GET'), { ...ENV, JURNAL_KUNCI: 'x'.repeat(31) }, fetcher)).status).toBe(503)
    expect((await tangani(minta('GET'), { ...ENV, JURNAL_KUNCI: undefined }, fetcher)).status).toBe(503)
  })
  test('tulis tanpa content-type JSON ditolak (form lintas situs)', async () => {
    const { fetcher } = redisPalsu()
    const cookie = await masuk(fetcher)
    const r = await tangani(new Request(URL_API, { method: 'PUT', headers: { cookie }, body: JSON.stringify({ entri }) }), ENV, fetcher)
    expect(r.status).toBe(415)
  })
  test('body JSON bukan objek: 400, bukan crash', async () => {
    const { fetcher } = redisPalsu()
    for (const body of [null, [], 'teks', 5]) {
      expect((await tangani(minta('POST', { query: '?aksi=masuk', body }), ENV, fetcher)).status).toBe(400)
    }
  })
  test('keluar menghapus cookie', async () => {
    const { fetcher } = redisPalsu()
    const r = await tangani(minta('POST', { query: '?aksi=keluar', body: {} }), ENV, fetcher)
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('catat beli, jual, hapus', () => {
  test('alur penuh', async () => {
    const { fetcher, hash } = redisPalsu()
    const cookie = await masuk(fetcher)

    expect((await tangani(minta('PUT', { cookie, body: { entri } }), ENV, fetcher)).status).toBe(201)
    expect((await tangani(minta('PATCH', { cookie, body: { id: entri.id, jual } }), ENV, fetcher)).status).toBe(200)

    const r = await tangani(minta('GET', { cookie }), ENV, fetcher)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(((await r.json()) as { entri: Entri[] }).entri).toEqual([{ ...entri, jual }])

    expect((await tangani(minta('DELETE', { cookie, body: { id: entri.id } }), ENV, fetcher)).status).toBe(204)
    expect(hash.size).toBe(0)
  })
  test('kirim ulang beli yang sama: 409, tetap satu entri', async () => {
    const { fetcher, hash } = redisPalsu()
    const cookie = await masuk(fetcher)
    await tangani(minta('PUT', { cookie, body: { entri } }), ENV, fetcher)
    expect((await tangani(minta('PUT', { cookie, body: { entri: { ...entri, lot: 99 } } }), ENV, fetcher)).status).toBe(409)
    expect(hash.size).toBe(1)
  })
  test('beli tidak bisa membawa jual', async () => {
    const { fetcher } = redisPalsu()
    const cookie = await masuk(fetcher)
    expect((await tangani(minta('PUT', { cookie, body: { entri: { ...entri, jual } } }), ENV, fetcher)).status).toBe(400)
  })
  test('jual dari tab lama: entri terhapus tidak hidup lagi, jual tidak ditimpa', async () => {
    const { fetcher, hash } = redisPalsu()
    const cookie = await masuk(fetcher)
    expect((await tangani(minta('PATCH', { cookie, body: { id: entri.id, jual } }), ENV, fetcher)).status).toBe(404)
    expect(hash.size).toBe(0)

    await tangani(minta('PUT', { cookie, body: { entri } }), ENV, fetcher)
    await tangani(minta('PATCH', { cookie, body: { id: entri.id, jual } }), ENV, fetcher)
    const lagi = await tangani(minta('PATCH', { cookie, body: { id: entri.id, jual: { ...jual, harga: 900 } } }), ENV, fetcher)
    expect(lagi.status).toBe(409)
    expect((JSON.parse(hash.get(entri.id)!) as Entri).jual).toEqual(jual)
  })
  test('jual sebelum tanggal beli: 400', async () => {
    const { fetcher } = redisPalsu()
    const cookie = await masuk(fetcher)
    await tangani(minta('PUT', { cookie, body: { entri } }), ENV, fetcher)
    const r = await tangani(minta('PATCH', { cookie, body: { id: entri.id, jual: { tanggal: '2026-01-01', harga: 1100 } } }), ENV, fetcher)
    expect(r.status).toBe(400)
  })
  test('entri tidak sah: 400, tidak ditulis', async () => {
    const { fetcher, hash } = redisPalsu()
    const cookie = await masuk(fetcher)
    const r = await tangani(minta('PUT', { cookie, body: { entri: { ...entri, kode: 'abcd<script>' } } }), ENV, fetcher)
    expect(r.status).toBe(400)
    expect(hash.size).toBe(0)
  })
  test('Redis gagal: 502, bukan daftar kosong', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 })) as unknown as typeof fetch
    const cookie = await masuk(redisPalsu().fetcher)
    expect((await tangani(minta('GET', { cookie }), ENV, fetcher)).status).toBe(502)
  })
})

describe('validasi', () => {
  test('entri sah lolos, field asing dibuang', () => {
    expect(validasi({ ...entri, asing: 1 })).toEqual(entri)
  })
  test('menolak isian rusak', () => {
    const rusak = [
      { ...entri, kode: 'ABC' },
      { ...entri, id: '../x' },
      { ...entri, rencana: '05-01-2026' },
      { ...entri, beli: { ...entri.beli, harga: -1 } },
      { ...entri, beli: { ...entri.beli, lot: 1.5 } },
      { ...entri, beli: { ...entri.beli, tanggal: '2026-02-30' } },
      { ...entri, jual: { tanggal: '2026-01-01', harga: 1100 } }, // jual sebelum beli
      { ...entri, catatan: 'x'.repeat(501) },
      null,
      'ABCD',
    ]
    for (const x of rusak) expect(validasi(x)).toBeNull()
  })
})
