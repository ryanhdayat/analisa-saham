/**
 * Jurnal pribadi: catatan transaksi pemilik situs, disimpan di Upstash Redis.
 * Satu-satunya bagian situs yang tidak publik — tanpa kunci tidak ada yang
 * terbaca. Halamannya (jurnal/) statis; datanya hanya lewat fungsi ini.
 *
 *   POST   /api/jurnal?aksi=masuk   {kunci}  → cookie sesi
 *   POST   /api/jurnal?aksi=keluar  {}
 *   GET    /api/jurnal                       → {entri: Entri[]}
 *   PUT    /api/jurnal              {entri}       → catat beli (entri baru)
 *   PATCH  /api/jurnal              {id, jual}    → catat jual, sekali per entri
 *   DELETE /api/jurnal              {id}
 *
 * Disalin apa adanya ke situs/api/jurnal.ts oleh deploy/vercel/rakit.sh dan
 * dijalankan Vercel Functions tanpa langkah install, jadi berkas ini berdiri
 * sendiri: tanpa impor dari repo dan tanpa dependensi.
 *
 * Env: JURNAL_KUNCI (minimal 32 karakter, acak), KV_REST_API_URL dan
 * KV_REST_API_TOKEN dari integrasi Upstash di Vercel (UPSTASH_REDIS_REST_*
 * juga diterima).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface Entri {
  /** Dibuat peramban (crypto.randomUUID). */
  id: string
  kode: string
  /** Tanggal rencana di situs yang diikuti; null kalau beli di luar rencana. */
  rencana: string | null
  beli: { tanggal: string; harga: number; lot: number }
  jual: { tanggal: string; harga: number } | null
  catatan: string
}

type Env = Record<string, string | undefined>

// Satu hash, satu field per entri. Beli hanya membuat entri baru (HSETNX) dan jual
// hanya mengisi entri yang ada dan belum dijual, jadi tab lama di laptop tidak bisa
// menghidupkan entri yang sudah dihapus atau menimpa jual yang dicatat dari HP.
const KEY = 'jurnal:entri'
const COOKIE = 'jurnal_sesi'
const UMUR_SESI = 180 * 86400
const ID = /^[a-z0-9-]{8,40}$/

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}
const gagal = (status: number, pesan: string) => json({ pesan }, status)

/**
 * Sesi tanpa status: cookie berisi HMAC dari kunci. Ganti JURNAL_KUNCI di
 * Vercel = semua sesi lama batal.
 * ponytail: keluar hanya menghapus cookie di peramban itu; cookie yang tersalin
 * tetap sah sampai kunci diganti. Simpan token per login di Redis kalau perlu
 * mencabut satu perangkat.
 */
const tokenSesi = (kunci: string) => createHmac('sha256', kunci).update('jurnal-sesi-v1').digest('base64url')

function sama(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function cookieSesi(req: Request): string | null {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`))
  return m?.[1] ?? null
}

const setCookie = (nilai: string, umur: number) =>
  `${COOKIE}=${nilai}; Path=/api/jurnal; Max-Age=${umur}; HttpOnly; Secure; SameSite=Strict`

function tanggalSah(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const bulat = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max

/** Entri yang sah dengan hanya field yang dikenal, atau null. */
export function validasi(x: unknown): Entri | null {
  if (typeof x !== 'object' || x === null) return null
  const e = x as Record<string, unknown>
  const beli = e.beli as Record<string, unknown> | undefined
  const jual = e.jual as Record<string, unknown> | null | undefined
  if (typeof e.id !== 'string' || !ID.test(e.id)) return null
  if (typeof e.kode !== 'string' || !/^[A-Z]{4}$/.test(e.kode)) return null
  if (e.rencana !== null && !tanggalSah(e.rencana)) return null
  if (!beli || !tanggalSah(beli.tanggal) || !bulat(beli.harga, 1, 1e7) || !bulat(beli.lot, 1, 1e6)) return null
  if (jual != null && (!tanggalSah(jual.tanggal) || !bulat(jual.harga, 1, 1e7) || jual.tanggal < beli.tanggal)) return null
  if (typeof e.catatan !== 'string' || e.catatan.length > 500) return null
  return {
    id: e.id,
    kode: e.kode,
    rencana: e.rencana as string | null,
    beli: { tanggal: beli.tanggal, harga: beli.harga, lot: beli.lot },
    jual: jual == null ? null : { tanggal: jual.tanggal as string, harga: jual.harga as number },
    catatan: e.catatan,
  }
}

/** Satu perintah lewat REST Upstash. Gagal = lempar, supaya tidak tampil sebagai jurnal kosong. */
async function redis(env: Env, fetcher: typeof fetch, perintah: (string | number)[]): Promise<unknown> {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('penyimpanan belum disambungkan')
  const res = await fetcher(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(perintah),
  })
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string }
  if (!res.ok || body.error) throw new Error(`Redis: ${body.error ?? res.status}`)
  return body.result
}

export async function tangani(req: Request, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<Response> {
  const kunci = env.JURNAL_KUNCI
  // Tanpa batas percobaan masuk: kunci acak 32+ karakter tidak bisa ditebak lewat jaringan.
  if (!kunci || kunci.length < 32) return gagal(503, 'JURNAL_KUNCI belum disetel di Vercel.')

  // Tulis hanya dengan JSON: form dari situs lain tidak bisa mengirim jenis ini
  // tanpa preflight, lapis kedua di samping SameSite=Strict.
  let body: Record<string, unknown> = {}
  if (req.method !== 'GET') {
    if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return gagal(415, 'Harus JSON.')
    const isi = await req.json().catch(() => null)
    if (typeof isi !== 'object' || isi === null || Array.isArray(isi)) return gagal(400, 'JSON rusak.')
    body = isi as Record<string, unknown>
  }

  const aksi = new URL(req.url).searchParams.get('aksi')
  if (req.method === 'POST' && aksi === 'masuk') {
    if (typeof body.kunci !== 'string' || !sama(body.kunci, kunci)) return gagal(401, 'Kunci salah.')
    return new Response(null, { status: 204, headers: { 'set-cookie': setCookie(tokenSesi(kunci), UMUR_SESI) } })
  }
  if (req.method === 'POST' && aksi === 'keluar') {
    return new Response(null, { status: 204, headers: { 'set-cookie': setCookie('', 0) } })
  }

  const sesi = cookieSesi(req)
  if (!sesi || !sama(sesi, tokenSesi(kunci))) return gagal(401, 'Belum masuk.')

  try {
    if (req.method === 'GET') {
      const flat = ((await redis(env, fetcher, ['HGETALL', KEY])) ?? []) as string[]
      const entri: Entri[] = []
      for (let i = 1; i < flat.length; i += 2) entri.push(JSON.parse(flat[i]!) as Entri)
      entri.sort((a, b) => b.beli.tanggal.localeCompare(a.beli.tanggal) || a.kode.localeCompare(b.kode))
      return json({ entri })
    }
    if (req.method === 'PUT') {
      const e = validasi(body.entri)
      if (!e || e.jual) return gagal(400, 'Isian tidak sah.')
      // 0 = id sudah ada: kiriman ulang dari form yang sama, bukan entri kedua.
      const baru = await redis(env, fetcher, ['HSETNX', KEY, e.id, JSON.stringify(e)])
      return json({ entri: e }, baru === 1 ? 201 : 409)
    }
    if (req.method === 'PATCH') {
      if (typeof body.id !== 'string' || !ID.test(body.id)) return gagal(400, 'id tidak sah.')
      const lama = (await redis(env, fetcher, ['HGET', KEY, body.id])) as string | null
      if (!lama) return gagal(404, 'Entri sudah dihapus.')
      const e = JSON.parse(lama) as Entri
      if (e.jual) return gagal(409, 'Jual sudah dicatat.')
      const dijual = validasi({ ...e, jual: body.jual })
      if (!dijual?.jual) return gagal(400, 'Isian tidak sah.')
      // ponytail: HGET lalu HSET tidak atomik; satu pemilik, jadi tabrakan antarperangkat diabaikan.
      await redis(env, fetcher, ['HSET', KEY, dijual.id, JSON.stringify(dijual)])
      return json({ entri: dijual })
    }
    if (req.method === 'DELETE') {
      if (typeof body.id !== 'string' || !ID.test(body.id)) return gagal(400, 'id tidak sah.')
      await redis(env, fetcher, ['HDEL', KEY, body.id])
      return new Response(null, { status: 204 })
    }
  } catch (err) {
    return gagal(502, err instanceof Error ? err.message : 'Penyimpanan gagal.')
  }
  return gagal(405, 'Metode tidak didukung.')
}

const handler = (req: Request) => tangani(req)
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
