import { toWeekly } from '../resample.ts'
import { analyzeVolume, type VolumeRead } from './volume.ts'
import { analyzeStructure, type StructureRead } from './structure.ts'
import { findLevels, type LevelsRead } from './levels.ts'
import { analyzeLiquidity, type FreeFloatInput, type LiquidityRead } from './liquidity.ts'
import { analyzeVpa, type VpaRead } from './vpa.ts'
import { analyzeWyckoff, type WyckoffRead } from './wyckoff.ts'
import { analyzeFlow, type FlowRead, type ForeignDay } from './flow.ts'
import { analyzeStrength, type StrengthRead } from './strength.ts'
import { analyzeFilters, type FiltersRead } from './filters.ts'
import { analyzeRiskReward, type RiskRewardRead } from './riskreward.ts'
import { atr } from './volatility.ts'
import { metric, unavailable, type Metric } from './metric.ts'
import type { Bar, VolumeProfile } from '../types.ts'

/**
 * Kolom pemeringkat — HANYA yang terukur.
 *
 * Wyckoff (#7) dan VPA (#6) sengaja TIDAK ada di sini. Keduanya tafsir; kalau ikut
 * dirata-rata, keyakinan yang tidak ditanggung metodenya akan menyusup ke angka
 * yang terlihat presisi.
 */
export const RANK_COLUMNS = ['trend', 'rs60', 'rvol', 'asing'] as const
export type RankColumn = (typeof RANK_COLUMNS)[number]

export const ATR_PERIOD = 14

export interface ScanInput {
  code: string
  name: string
  /** Riwayat penuh termasuk pemanasan MA. */
  bars: Bar[]
  /** Jendela yang digambar dan dianalisis. */
  displayBars: Bar[]
  profile: VolumeProfile
  indexBars: Bar[]
  sectorBars?: Bar[]
  foreignDays?: ForeignDay[]
  foreignStaleness?: { asOf: string; daysOld: number }
  freeFloat?: FreeFloatInput
}

export interface ScanOptions {
  minValue?: number
  minRatio?: number
}

export interface ScanRow {
  code: string
  name: string
  close: number
  date: string
  metrics: {
    volume: Metric<VolumeRead>
    structure: Metric<StructureRead>
    levels: Metric<LevelsRead>
    liquidity: Metric<LiquidityRead>
    vpa: Metric<VpaRead>
    wyckoff: Metric<WyckoffRead>
    flow: Metric<FlowRead>
    strength: Metric<StrengthRead>
    filters: Metric<FiltersRead>
    volatility: Metric<{ atr: number; atrPct: number; suggestedStop: number }>
    riskReward: Metric<RiskRewardRead>
  }
  gates: { passed: boolean; failures: string[] }
  rank: {
    score: number
    columns: Record<RankColumn, number | null>
    used: RankColumn[]
    /** Ada kolom yang hilang — baris ini tidak sebanding dengan run yang lengkap. */
    degraded: boolean
  }
}

export function buildRow(input: ScanInput, options: ScanOptions = {}): ScanRow {
  const { bars, displayBars, profile } = input
  const last = displayBars[displayBars.length - 1] ?? bars[bars.length - 1]!
  const close = last.close

  const atrSeries = atr(bars, ATR_PERIOD)
  const atrNow = atrSeries[atrSeries.length - 1]
  const atrBefore = atrSeries[atrSeries.length - 1 - 20]
  const atrValue = atrNow ?? close * 0.02

  const volatility: ScanRow['metrics']['volatility'] =
    atrNow == null
      ? unavailable<{ atr: number; atrPct: number; suggestedStop: number }>(`Butuh ${ATR_PERIOD} bar untuk ATR.`)
      : metric(
          { atr: atrNow, atrPct: (atrNow / close) * 100, suggestedStop: 2 * atrNow },
          `ATR ${Math.round(atrNow)} (${((atrNow / close) * 100).toFixed(1)}% dari harga) — stop wajar ${Math.round(2 * atrNow)} per lembar`,
          'tinggi',
          [`Derak harian normal ${Math.round(atrNow)}; stop lebih sempit dari itu akan tersapu tanpa sebab.`],
        )

  const volume = analyzeVolume(displayBars)
  const structure = analyzeStructure(displayBars, toWeekly(displayBars))
  const levels = findLevels(displayBars, profile, atrValue)
  const liquidity = analyzeLiquidity(displayBars, options.minValue, input.freeFloat)
  const filters = analyzeFilters(bars)
  const strength = analyzeStrength(bars, input.indexBars, input.sectorBars)

  const emptyLevels: LevelsRead = { supports: [], resistances: [] }
  const vpa = analyzeVpa(displayBars, levels.value ?? emptyLevels)
  const wyckoff = analyzeWyckoff(
    structure.value,
    filters.value,
    vpa.value,
    close,
    atrNow != null && atrBefore != null ? atrNow < atrBefore : false,
  )
  const flow = analyzeFlow(input.foreignDays ?? [], input.foreignStaleness)
  const riskReward: Metric<RiskRewardRead> = levels.value
    ? analyzeRiskReward(close, atrValue, levels.value, options.minRatio)
    : unavailable<RiskRewardRead>('Level belum terbaca, R:R tidak bisa dihitung.')

  // ── Gerbang ────────────────────────────────────────────────────────────────
  const failures: string[] = []
  if (liquidity.value && !liquidity.value.passesGate) failures.push(liquidity.verdict)
  if (!riskReward.available) failures.push(`R:R tidak terukur — ${riskReward.verdict}`)
  else if (riskReward.value && !riskReward.value.passesGate) failures.push(riskReward.verdict)

  // ── Peringkat ──────────────────────────────────────────────────────────────
  const columns: Record<RankColumn, number | null> = {
    trend: filters.value?.trendScore ?? null,
    rs60: strength.value?.rsScore ?? null,
    rvol: volume.value?.confirmationScore ?? null,
    asing: flow.value?.flowScore ?? null,
  }
  const used = RANK_COLUMNS.filter((c) => columns[c] !== null)
  const score = used.length > 0 ? used.reduce((a, c) => a + columns[c]!, 0) / used.length : 0

  return {
    code: input.code,
    name: input.name,
    close,
    date: last.date,
    metrics: { volume, structure, levels, liquidity, vpa, wyckoff, flow, strength, filters, volatility, riskReward },
    gates: { passed: failures.length === 0, failures },
    rank: { score, columns, used: [...used], degraded: used.length < RANK_COLUMNS.length },
  }
}
