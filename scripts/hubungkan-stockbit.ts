/** Local setup only. Never bundled into the site. Credentials stay out of stdout. */
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { kunciStockbit, segelSesi, sinkronStockbit } from '../src/jurnal/stockbit.ts'

const jenis = process.argv.includes('--real') ? 'real' : 'virtual'
const root = process.env.STOCKBIT_MCP_ROOT ?? join(homedir(), '.stockbit-mcp/node_modules/stockbit-mcp')
// Separate login family: the journal must not rotate the laptop MCP credential.
process.env.STOCKBIT_STORE_DIR = join(homedir(), '.stockbit-jurnal-cloud')
process.env.STOCKBIT_FORCE_FILE_STORE = '1'
process.env.STOCKBIT_NO_UPDATE_CHECK = '1'
if (process.argv.includes('--login')) {
  const result = spawnSync(process.env.STOCKBIT_NODE ?? '/opt/homebrew/bin/node', [join(root, 'dist/bin/stockbit-auth.js'),
    ...(jenis === 'real' ? ['trading-login'] : ['login', '--fresh-profile'])], { env: process.env, stdio: 'inherit' })
  if (result.status !== 0) throw Error('Login belum selesai. Ulangi perintah ini.')
}
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const secret = (process.env.JURNAL_KUNCI !== '[SENSITIVE]' ? process.env.JURNAL_KUNCI : '') || spawnSync('security', ['find-generic-password', '-s', 'analisa-saham JURNAL_KUNCI', '-w'], { encoding: 'utf8' }).stdout?.trim()
if (!url || !token || !secret || secret.length < 32) throw Error('Konfigurasi Redis atau kunci jurnal belum tersedia.')
const redis = async (cmd: (string | number)[]) => {
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(8000) })
  const body = await res.json() as { result?: unknown; error?: unknown }
  if (!res.ok || body.error) throw Error('Penyimpanan jurnal belum bisa dihubungi.')
  return body.result
}
const domain = jenis === 'virtual' ? 'main' : 'securities'
const { getStore } = await import(join(root, 'dist/src/auth/store.js'))
const { ensureFresh } = await import(join(root, 'dist/src/auth/session.js'))
if (!getStore(domain).get()) throw Error(`Sesi cloud ${jenis} belum ada. Jalankan dengan --login${jenis === 'real' ? ' --real' : ''}.`)
const keys = kunciStockbit(jenis)
const lock = randomBytes(24).toString('hex')
if (await redis(['SET', keys.lock, lock, 'NX', 'PX', 90000]) !== 'OK') throw Error('Sinkronisasi sedang berjalan. Coba lagi sebentar.')
try {
  const access = await ensureFresh(domain)
  const refresh = getStore(domain).get()
  const expiresAt = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString()).exp
  if (!refresh || !Number.isFinite(expiresAt)) throw Error('Sesi cloud tidak terbaca.')
  await redis(['SET', keys.session, segelSesi(secret, { access, refresh, expiresAt }, jenis)])
} finally {
  await redis(['EVAL', 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end', 1, keys.lock, lock])
}
const result = await sinkronStockbit(redis, secret, fetch, Date.now(), jenis)
console.log(JSON.stringify({ jenis, terhubung: !!result.snapshot, jumlahPosisi: result.snapshot?.positions.length, warning: result.warning }))
// The cloud now owns refresh rotation. Re-login before importing again.
