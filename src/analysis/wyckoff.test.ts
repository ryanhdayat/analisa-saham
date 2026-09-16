import { expect, test, describe } from 'bun:test'
import { analyzeWyckoff } from './wyckoff.ts'
import type { StructureRead } from './structure.ts'
import type { FiltersRead } from './filters.ts'
import type { VpaRead } from './vpa.ts'

function structure(s: StructureRead['daily']['structure']): StructureRead {
  const tf = { structure: s, phase: 'datar' as const, swingHighs: [], swingLows: [] }
  return { daily: tf, weekly: tf, aligned: true }
}

function filters(over: Partial<FiltersRead> = {}): FiltersRead {
  return {
    ma20: 1000,
    ma50: 980,
    ma200: 950,
    stacked: true,
    trendScore: 1,
    obvDivergence: null,
    adDivergence: null,
    ...over,
  }
}

const vpa = (signals: VpaRead['events'][number]['signal'][]): VpaRead => ({
  events: signals.map((signal) => ({ signal, date: '2026-09-01', index: 10, rvol: 2, note: '' })),
  latest: null,
})

describe('analyzeWyckoff', () => {
  test('uptrend di atas MA 50 yang menanjak adalah markup', () => {
    const m = analyzeWyckoff(structure('uptrend'), filters(), vpa([]), 1000, false)
    expect(m.value!.phase).toBe('markup')
  })

  test('downtrend di bawah MA 50 yang menurun adalah markdown', () => {
    const m = analyzeWyckoff(
      structure('downtrend'),
      filters({ stacked: false, trendScore: 0, ma50: 1100 }),
      vpa([]),
      1000,
      false,
    )
    expect(m.value!.phase).toBe('markdown')
  })

  test('sideways dengan spring dan rentang menyempit adalah akumulasi', () => {
    const m = analyzeWyckoff(
      structure('sideways'),
      filters({ stacked: false, trendScore: 0.4 }),
      vpa(['spring']),
      1000,
      true,
    )
    expect(m.value!.phase).toBe('akumulasi')
  })

  test('sideways dengan upthrust adalah distribusi', () => {
    const m = analyzeWyckoff(
      structure('sideways'),
      filters({ stacked: false, trendScore: 0.4 }),
      vpa(['upthrust']),
      1000,
      false,
    )
    expect(m.value!.phase).toBe('distribusi')
  })

  test('sideways tanpa petunjuk apa pun tidak dipaksa masuk fase', () => {
    const m = analyzeWyckoff(structure('sideways'), filters({ stacked: false }), vpa([]), 1000, false)
    expect(m.value!.phase).toBe('tidak-jelas')
  })

  test('keyakinan TIDAK PERNAH tinggi kecuali seluruh syarat sejalan', () => {
    const lemah = analyzeWyckoff(structure('sideways'), filters({ stacked: false }), vpa([]), 1000, false)
    expect(lemah.confidence).toBe('rendah')
    const sedang = analyzeWyckoff(structure('sideways'), filters({ stacked: false }), vpa(['spring']), 1000, true)
    expect(sedang.confidence).not.toBe('tinggi')
  })

  test('vonis mencantumkan peringatan bahwa fase ini subjektif', () => {
    const m = analyzeWyckoff(structure('uptrend'), filters(), vpa([]), 1000, false)
    expect(m.verdict.toLowerCase()).toMatch(/subjektif|tafsir/)
  })

  test('struktur yang tidak tersedia menghasilkan available false', () => {
    expect(analyzeWyckoff(null, filters(), vpa([]), 1000, false).available).toBe(false)
  })
})
