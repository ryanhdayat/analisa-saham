import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { loadJurnalTemplate } from './jurnal.ts'

// Jalankan script halaman asli; hanya DOM dan layanan eksternal yang diganti.
test('pengguna yang membuka ulang sesi aktif dapat keluar lalu masuk lagi', async () => {
  const html = await loadJurnalTemplate()
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
  for (const mode of ['google', 'kunci']) {
    const nodes = new Map<string, { hidden: boolean; value: string; innerHTML: string; listeners: Record<string, () => Promise<void>>; addEventListener: (type: string, fn: () => Promise<void>) => void; replaceChildren: () => void }>()
    for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const node = { hidden: /\bhidden\b/.test(tag[0]), value: '', innerHTML: '', listeners: {} as Record<string, () => Promise<void>>,
        addEventListener(type: string, fn: () => Promise<void>) { this.listeners[type] = fn }, replaceChildren() { this.innerHTML = '' } }
      nodes.set(tag[1]!, node)
    }
    const google = { accounts: { id: { initialize() {}, renderButton(node: { innerHTML: string }) { node.innerHTML = 'Masuk dengan Google' }, disableAutoSelect() {} } } }
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.includes('konfigurasi')) return Response.json({ mode, clientId: 'tes', nonce: 'tes' })
      if (url.includes('keluar')) return new Response(null, { status: 204 })
      if (url.endsWith('hasil.json')) return Response.json({ pasar: [] })
      if (init?.method === 'GET') return Response.json({ entri: [] })
      throw new Error('Permintaan tidak diharapkan')
    }
    runInNewContext(script, { document: { getElementById: (id: string) => nodes.get(id) }, window: { google }, google, crypto, fetch: fetcher, Intl, Date })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(nodes.get('keluar')!.hidden).toBe(false)
    await nodes.get('keluar')!.listeners.click!()
    expect(nodes.get('masuk')!.hidden).toBe(false)
    expect(nodes.get(mode === 'google' ? 'google-masuk' : 'kunci-masuk')!.hidden).toBe(false)
    if (mode === 'google') expect(nodes.get('google-masuk')!.innerHTML).toBe('Masuk dengan Google')
  }
})
