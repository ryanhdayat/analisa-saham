import { expect, test, describe } from 'bun:test'
import { catatanRisiko, labelRisiko } from './catatan.ts'
import type { ScanRow } from '../analysis/report.ts'

const m = (value: unknown) => ({ value, verdict: '', confidence: 'sedang' as const, evidence: [], available: true })

/** Baris lolos tanpa satu pun sinyal buruk. */
function row(over: Partial<Record<string, unknown>> = {}): ScanRow {
  const v = { wyckoff: 'markup', vpa: 'spring', phase: 'pullback', obv: null, volume: 'netral', rr: 1.5, ...over }
  return {
    metrics: {
      wyckoff: m({ phase: v.wyckoff }),
      vpa: m({ latest: v.vpa ? { signal: v.vpa, date: '2026-10-23' } : null, events: [] }),
      structure: m({ daily: { phase: v.phase } }),
      filters: m({ obvDivergence: v.obv }),
      volume: m({ classification: v.volume }),
      riskReward: m({ ratio: v.rr }),
    },
  } as unknown as ScanRow
}

describe('catatanRisiko', () => {
  test('baris bersih → tanpa catatan, label bersih', () => {
    expect(catatanRisiko(row())).toEqual([])
    expect(labelRisiko([])).toBe('bersih')
  })

  const kasus: [Record<string, unknown>, string, string, 'bad' | 'warn'][] = [
    [{ rr: 0.51 }, 'R:R 1:0,51', 'potensi untung lebih kecil dari risiko rugi', 'warn'],
    [{ volume: 'rally-lemah' }, 'rally-lemah', 'naiknya tanpa dukungan volume', 'warn'],
    [{ volume: 'tekanan-jual' }, 'tekanan-jual', 'turun dengan volume besar', 'warn'],
    [{ vpa: 'no-demand' }, 'no-demand 10-23', 'pembeli sepi saat harga naik', 'bad'],
    [{ vpa: 'upthrust' }, 'upthrust 10-23', 'sempat naik lalu ditolak turun', 'bad'],
    [{ wyckoff: 'distribusi' }, 'Wyckoff distribusi', 'pola grafik cenderung turun', 'bad'],
    [{ wyckoff: 'markdown' }, 'Wyckoff markdown', 'pola grafik cenderung turun', 'bad'],
    [{ phase: 'rebound' }, 'rebound dlm downtrend', 'naik sesaat di tren turun', 'warn'],
    [{ obv: 'bearish' }, 'OBV bearish', 'aliran volume melemah', 'warn'],
  ]
  for (const [over, teknis, awam, kind] of kasus) {
    test(`${teknis} → "${awam}"`, () => {
      const c = catatanRisiko(row(over))
      expect(c).toEqual([{ teknis, awam, kind }])
      expect(labelRisiko(c)).toBe('hati-hati')
    })
  }

  test('metrik tidak tersedia tidak menghasilkan catatan', () => {
    const r = row({ rr: 0.4 })
    ;(r.metrics.riskReward as any).available = false
    expect(catatanRisiko(r)).toEqual([])
  })
})
