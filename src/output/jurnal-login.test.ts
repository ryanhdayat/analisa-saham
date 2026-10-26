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
        addEventListener(type: string, fn: () => Promise<void>) { this.listeners[type] = fn }, replaceChildren() { this.innerHTML = '' }, setAttribute() {} }
      nodes.set(tag[1]!, node)
    }
    let config: Record<string, unknown> = {}
    const google = { accounts: { id: { initialize(c: Record<string, unknown>) { config = c }, renderButton(node: { innerHTML: string }) { node.innerHTML = 'Masuk dengan Google' }, disableAutoSelect() {} } } }
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.includes('konfigurasi')) return Response.json({ mode, clientId: 'tes', nonce: 'tes' })
      if (url.includes('keluar')) return new Response(null, { status: 204 })
      if (url.includes('jenis=real')) return Response.json({ snapshot: null, warning: 'Stockbit Real belum dihubungkan.' })
      if (url.includes('jenis=virtual')) return Response.json({ snapshot: { jenis: 'virtual', syncedAt: '2026-10-26T08:00:00Z', balance: 100000,
        unrealized: 1000, positions: [{ kode: 'ABCD', lot: 2, average: 1000, market: 1005, marketValue: 201000, pnl: 1000 }],
        orders: [{ kode: 'EFGH', side: 'BUY', status: 'REJECTED', lot: 1, matchedLot: 0, price: 500 }] }, warning: 'Data terakhir tetap ditampilkan.' })
      if (url.endsWith('hasil.json')) return Response.json({ pasar: [] })
      if (init?.method === 'GET') return Response.json({ entri: [] })
      throw new Error('Permintaan tidak diharapkan')
    }
    runInNewContext(script, { document: { getElementById: (id: string) => nodes.get(id) }, window: { google, location: { origin: 'https://situs.tes', search: '' } }, google, crypto, fetch: fetcher, Intl, Date, URLSearchParams, AbortController, setTimeout, clearTimeout })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(nodes.get('keluar')!.hidden).toBe(false)
    expect(nodes.get('judul-porto')!).toHaveProperty('textContent', 'Stockbit Virtual')
    expect(nodes.get('posisi-stockbit')!.innerHTML).toContain('ABCD')
    expect(nodes.get('order-stockbit')!.innerHTML).toContain('REJECTED')
    expect(nodes.get('order-stockbit')!.innerHTML).toContain('terisi 0 lot')
    expect(nodes.get('waktu-stockbit')!).toHaveProperty('textContent', expect.stringContaining('Terakhir sinkron'))
    expect(nodes.get('peringatan-stockbit')!.hidden).toBe(false)
    await nodes.get('akun-real')!.listeners.click!()
    expect(nodes.get('posisi-stockbit')!.innerHTML).toBe('')
    expect(nodes.get('stats-stockbit')!.innerHTML).toBe('')
    expect(nodes.get('peringatan-stockbit')!).toHaveProperty('textContent', 'Stockbit Real belum dihubungkan.')
    await nodes.get('akun-virtual')!.listeners.click!()
    expect(nodes.get('posisi-stockbit')!.innerHTML).toContain('ABCD')
    await nodes.get('keluar')!.listeners.click!()
    expect(nodes.get('masuk')!.hidden).toBe(false)
    expect(nodes.get('porto')!.hidden).toBe(true)
    expect(nodes.get('posisi-stockbit')!.innerHTML).toBe('')
    expect(nodes.get(mode === 'google' ? 'google-masuk' : 'kunci-masuk')!.hidden).toBe(false)
    if (mode === 'google') {
      expect(nodes.get('google-masuk')!.innerHTML).toBe('Masuk dengan Google')
      expect(config.ux_mode).toBe('redirect')
      expect(config.login_uri).toBe('https://situs.tes/api/jurnal?aksi=google')
      expect(config.callback).toBeUndefined()
    }
  }
})
