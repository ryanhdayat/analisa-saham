import { expect, test } from 'bun:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { tangani } from './api.ts'

const env = { JURNAL_KUNCI: 'rahasia-tes-012345678901234567890123', GOOGLE_CLIENT_ID: 'contoh.apps.googleusercontent.com', JURNAL_EMAIL: 'pemilik@example.com' }
const url = 'https://situs.tes/api/jurnal'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'tes', alg: 'RS256' }
const fetcher = (async (input: string | URL | Request) => {
  if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] })
  throw new Error('Login tidak boleh menyentuh Redis')
}) as typeof fetch
const req = (method: string, query = '', body?: unknown, cookie?: string, origin = 'https://situs.tes') => new Request(url + query, {
  method, headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})
async function persiapan() {
  const r = await tangani(req('GET', '?aksi=konfigurasi'), env, fetcher)
  expect(r.status).toBe(200)
  expect(r.headers.get('cache-control')).toBe('no-store')
  const config = await r.json() as { mode: string; clientId: string; nonce: string }
  expect(config.mode).toBe('google')
  expect(config.clientId).toBe(env.GOOGLE_CLIENT_ID)
  return { ...config, cookie: r.headers.get('set-cookie')!.split(';')[0]! }
}
async function credential(nonce: string, claims: Record<string, unknown> = {}, key = privateKey) {
  return new SignJWT({ email: env.JURNAL_EMAIL, email_verified: true, nonce, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'tes' }).setIssuer('https://accounts.google.com')
    .setAudience(env.GOOGLE_CLIENT_ID).setSubject('google-user-123').setIssuedAt().setExpirationTime('5m').sign(key)
}
test('akun pemilik mendapat sesi; akun lain dan email belum terverifikasi ditolak', async () => {
  for (const [claims, status] of [[{}, 204], [{ email: 'orang-lain@example.com' }, 403], [{ email_verified: false }, 403]] as const) {
    const c = await persiapan()
    const r = await tangani(req('POST', '?aksi=google', { credential: await credential(c.nonce, claims) }, c.cookie), env, fetcher)
    expect(r.status).toBe(status)
    if (status === 204) {
      const cookie = r.headers.get('set-cookie')!
      expect(cookie).toContain('jurnal_sesi=')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('SameSite=Strict')
      // Sesi sah mencapai penyimpanan (belum dikonfigurasi pada fixture).
      expect((await tangani(req('GET', '', undefined, cookie.split(';')[0]), env, fetcher)).status).toBe(502)
      expect((await tangani(req('GET', '', undefined, cookie.split(';')[0]), { ...env, JURNAL_EMAIL: 'baru@example.com' }, fetcher)).status).toBe(401)
    } else expect(r.headers.get('set-cookie')).toBeNull()
  }
})
test('nonce, signature, audience, issuer dan masa berlaku Google wajib sah', async () => {
  const c = await persiapan()
  const other = await generateKeyPair('RS256')
  const tokens = [
    await credential('nonce-lain'),
    await credential(c.nonce, {}, other.privateKey),
    await new SignJWT({ email: env.JURNAL_EMAIL, email_verified: true, nonce: c.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'tes' }).setIssuer('https://accounts.google.com').setAudience('aplikasi-lain').setSubject('123').setIssuedAt().setExpirationTime('5m').sign(privateKey),
    await new SignJWT({ email: env.JURNAL_EMAIL, email_verified: true, nonce: c.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'tes' }).setIssuer('https://penipu.tes').setAudience(env.GOOGLE_CLIENT_ID).setSubject('123').setIssuedAt().setExpirationTime('5m').sign(privateKey),
    await new SignJWT({ email: env.JURNAL_EMAIL, email_verified: true, nonce: c.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'tes' }).setIssuer('https://accounts.google.com').setAudience(env.GOOGLE_CLIENT_ID).setSubject('123').setIssuedAt().setExpirationTime(1).sign(privateKey),
  ]
  for (const token of tokens) expect((await tangani(req('POST', '?aksi=google', { credential: token }, c.cookie), env, fetcher)).status).toBe(401)
})
test('login tanpa challenge, dari origin asing dan kunci lama ditolak', async () => {
  const c = await persiapan()
  const body = { credential: await credential(c.nonce) }
  expect((await tangani(req('POST', '?aksi=google', body), env, fetcher)).status).toBe(401)
  expect((await tangani(req('POST', '?aksi=google', body, c.cookie, 'https://penipu.tes'), env, fetcher)).status).toBe(403)
  expect((await tangani(req('POST', '?aksi=masuk', { kunci: env.JURNAL_KUNCI }), env, fetcher)).status).toBe(401)
})
test('konfigurasi Google setengah lengkap gagal tertutup', async () => {
  expect((await tangani(req('GET'), { ...env, GOOGLE_CLIENT_ID: undefined }, fetcher)).status).toBe(503)
  expect((await tangani(req('GET'), { ...env, JURNAL_EMAIL: undefined }, fetcher)).status).toBe(503)
})

test('sesi kedaluwarsa, sesi challenge, dan cookie login kunci lama bukan sesi Google', async () => {
  const { createHmac } = await import('node:crypto')
  const c = await persiapan()
  const expired = await new SignJWT({ email: env.JURNAL_EMAIL }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('jurnal').setAudience('jurnal-sesi').setSubject('123').setIssuedAt().setExpirationTime(1)
    .sign(new TextEncoder().encode(env.JURNAL_KUNCI))
  const old = createHmac('sha256', env.JURNAL_KUNCI).update('jurnal-sesi-v1').digest('base64url')
  for (const token of [expired, old, c.cookie.split('=')[1]!]) {
    expect((await tangani(req('GET', '', undefined, `jurnal_sesi=${token}`), env, fetcher)).status).toBe(401)
  }
})

test('redirect Google memverifikasi form dan CSRF lalu mengembalikan sesi ke jurnal', async () => {
  const c = await persiapan()
  const body = new URLSearchParams({ credential: await credential(c.nonce), g_csrf_token: 'csrf-browser' })
  const request = (cookie: string, csrf = 'csrf-browser') => new Request(url + '?aksi=google', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://accounts.google.com' },
    body: new URLSearchParams({ ...Object.fromEntries(body), g_csrf_token: csrf }),
  })
  const r = await tangani(request(c.cookie + '; g_csrf_token=csrf-browser'), env, fetcher)
  expect(r.status).toBe(303)
  expect(r.headers.get('location')).toBe('/jurnal/')
  expect(r.headers.get('set-cookie')).toContain('jurnal_sesi=')
  expect(r.headers.get('cache-control')).toBe('no-store')
  for (const requestSalah of [request(c.cookie), request(c.cookie + '; g_csrf_token=csrf-browser', 'palsu'), request('g_csrf_token=csrf-browser')]) {
    const gagal = await tangani(requestSalah, env, fetcher)
    expect(gagal.status).toBe(303)
    expect(gagal.headers.get('location')).toBe('/jurnal/?login=ulang')
    expect(gagal.headers.get('set-cookie')).toBeNull()
  }
})

test('cookie challenge terkirim pada POST lintas situs Google, cookie sesi tetap Strict', async () => {
  const r = await tangani(req('GET', '?aksi=konfigurasi'), env, fetcher)
  expect(r.headers.get('set-cookie')).toContain('SameSite=None')
  expect(r.headers.get('set-cookie')).toContain('HttpOnly; Secure')
})
