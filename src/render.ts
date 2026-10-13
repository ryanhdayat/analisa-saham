import { MA_PERIODS, VOLUME_MA_PERIOD } from './chart.ts'
import { IDX, type Market } from './market.ts'
import type { ChartInput } from './types.ts'

/** Tema gelap TradingView, diambil dari BBCA.png. */
const C = {
  bg: '#131722',
  grid: '#1e222d',
  axis: '#2a2e39',
  text: '#b2b5be',
  textDim: '#787b86',
  up: '#26a69a',
  down: '#ef5350',
  volMA: '#2196f3',
  ma: new Map<number, string>([
    [10, '#e91e63'],
    [20, '#ff9800'],
    [50, '#cddc39'],
    [100, '#4caf50'],
    [200, '#2962ff'],
  ]),
}

const L = {
  w: 2000,
  h: 880,
  padL: 20,
  padR: 92,
  priceTop: 18,
  priceH: 582,
  gap: 12,
  volH: 178,
  dateH: 40,
  /** Bagian lebar plot yang dipakai candle; sisanya ruang kosong tempat profil digambar. */
  candleShare: 0.76,
  /** Lebar maksimum batang profil, diukur dari tepi kanan plot. */
  profileW: 430,
}

/** Ukuran kanvas, dipakai pemanggil untuk mengatur viewport penangkap PNG. */
export const CANVAS = { width: L.w, height: L.h } as const

/** Batas vertikal panel volume, dipakai untuk menahan label di dalamnya. */
export const VOLUME_PANEL = {
  top: L.priceTop + L.priceH + L.gap,
  bottom: L.priceTop + L.priceH + L.gap + L.volH,
} as const

const FONT = "'Trebuchet MS', Helvetica, Arial, sans-serif"

/** Volume dalam lot, seperti TradingView: 721574 → "721.57K". */
export function formatVolume(lots: number): string {
  const trim = (n: number) => String(Number(n.toFixed(2)))
  if (Math.abs(lots) >= 1e9) return `${trim(lots / 1e9)}B`
  if (Math.abs(lots) >= 1e6) return `${trim(lots / 1e6)}M`
  if (Math.abs(lots) >= 1e3) return `${trim(lots / 1e3)}K`
  return trim(lots)
}

/** Harga bergaya TradingView: pemisah ribuan koma, desimal hanya kalau perlu. */
export function formatPrice(price: number): string {
  const decimals = Number.isInteger(price) ? 0 : 2
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const n2 = (v: number) => Math.round(v * 100) / 100

/** Langkah sumbu yang enak dibaca: 1, 2, 2,5 atau 5 dikali pangkat sepuluh. */
function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * mag) return m * mag
  }
  return 10 * mag
}

/**
 * Geser label sumbu kanan yang bertindihan supaya semuanya terbaca, sambil menjaga
 * urutannya. Tanpa ini, MA yang nilainya berdekatan menumpuk jadi satu blok gelap.
 */
function declutter<T extends { y: number }>(items: T[], minGap: number, top: number, bottom: number): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  if (sorted.length === 0) return sorted

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    if (cur.y - prev.y < minGap) cur.y = prev.y + minGap
  }

  // Geser seluruh blok — bukan tiap label sendiri-sendiri — supaya jarak yang baru
  // dibuka tadi tidak langsung tertutup lagi oleh penjepitan ke tepi panel.
  const overflow = sorted[sorted.length - 1]!.y - bottom
  if (overflow > 0) for (const item of sorted) item.y -= overflow
  const underflow = top - sorted[0]!.y
  if (underflow > 0) for (const item of sorted) item.y += underflow

  // Kalau labelnya lebih banyak daripada ruang yang ada, tumpukan tidak terhindarkan;
  // yang penting semuanya tetap di dalam panel.
  for (const item of sorted) item.y = Math.min(bottom, Math.max(top, item.y))

  return sorted
}

/**
 * Gambar satu emiten sebagai SVG mandiri — tanpa font eksternal, tanpa skrip, tanpa
 * gambar tertaut — supaya bisa dibuka langsung maupun ditangkap jadi PNG.
 */
export function renderSvg(input: ChartInput, market: Market = IDX): string {
  const { bars, priceMA, volumeMA, profile } = input
  const count = bars.length
  if (count === 0) throw new Error(`Tidak ada bar untuk digambar pada ${input.code}.`)

  const plotL = L.padL
  const plotR = L.w - L.padR
  const candleR = plotL + (plotR - plotL) * L.candleShare
  const priceBot = L.priceTop + L.priceH
  const volTop = priceBot + L.gap
  const volBot = volTop + L.volH

  // Skala harga mencakup candle DAN seluruh MA, supaya garis tidak terpotong tepi panel.
  let lo = Math.min(...bars.map((b) => b.low))
  let hi = Math.max(...bars.map((b) => b.high))
  for (const values of priceMA.values()) {
    for (const v of values) {
      if (v == null) continue
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  }
  const pad = (hi - lo) * 0.06 || Math.max(1, hi * 0.01)
  lo -= pad
  hi += pad

  const y = (price: number) => L.priceTop + ((hi - price) / (hi - lo)) * L.priceH
  const step = (candleR - plotL) / count
  const x = (i: number) => plotL + (i + 0.5) * step
  const bodyW = Math.max(1, Math.min(14, step * 0.64))

  const lots = bars.map((b) => market.toDisplayVolume(b.volume))
  const volMax = Math.max(...lots, 1)
  const vy = (v: number) => volBot - (v / volMax) * L.volH

  const parts: string[] = []

  // ── Latar dan grid harga ────────────────────────────────────────────────────
  parts.push(`<rect width="${L.w}" height="${L.h}" fill="${C.bg}"/>`)

  const priceStep = niceStep(hi - lo, 9)
  const priceTicks: number[] = []
  for (let p = Math.ceil(lo / priceStep) * priceStep; p <= hi; p += priceStep) priceTicks.push(p)
  for (const p of priceTicks) {
    const py = n2(y(p))
    parts.push(`<line x1="${plotL}" y1="${py}" x2="${plotR}" y2="${py}" stroke="${C.grid}"/>`)
    parts.push(
      `<text x="${plotR + 8}" y="${n2(py + 4)}" fill="${C.textDim}" font-size="13">${formatPrice(p)}</text>`,
    )
  }

  // ── Grid vertikal dan sumbu tanggal, satu garis tiap pergantian bulan ───────
  const monthTicks: Array<{ i: number; label: string }> = []
  for (let i = 0; i < count; i++) {
    const cur = bars[i]!.date.slice(0, 7)
    const prev = i > 0 ? bars[i - 1]!.date.slice(0, 7) : null
    if (prev === cur) continue
    const [yy, mm] = cur.split('-') as [string, string]
    const month = Number(mm)
    monthTicks.push({ i, label: month === 1 || prev === null ? yy : MONTHS[month - 1]! })
  }
  for (const t of monthTicks) {
    const tx = n2(x(t.i))
    parts.push(`<line x1="${tx}" y1="${L.priceTop}" x2="${tx}" y2="${volBot}" stroke="${C.grid}"/>`)
    parts.push(
      `<text x="${tx}" y="${volBot + 26}" fill="${C.textDim}" font-size="13" text-anchor="middle">${t.label}</text>`,
    )
  }

  // ── Volume ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < count; i++) {
    const b = bars[i]!
    const up = b.close >= b.open
    const top = n2(vy(lots[i]!))
    parts.push(
      `<rect class="vol" x="${n2(x(i) - bodyW / 2)}" y="${top}" width="${n2(bodyW)}" height="${n2(Math.max(1, volBot - top))}" fill="${up ? C.up : C.down}" opacity="0.55"/>`,
    )
  }
  const volMaPoints = volumeMA
    .map((v, i) => (v == null ? null : `${n2(x(i))},${n2(vy(market.toDisplayVolume(v)))}`))
    .filter((p): p is string => p !== null)
    .join(' ')
  if (volMaPoints) {
    parts.push(
      `<polyline class="vol-ma" points="${volMaPoints}" fill="none" stroke="${C.volMA}" stroke-width="1.6"/>`,
    )
  }

  // ── Profil volume, menempel di tepi kanan dan tumbuh ke kiri ───────────────
  const binMax = Math.max(...profile.bins.map((b) => b.volume), 1)
  for (const [i, bin] of profile.bins.entries()) {
    const top = y(bin.high)
    const bottom = y(bin.low)
    const h = Math.max(1, bottom - top - 1)
    const w = (bin.volume / binMax) * L.profileW
    if (w <= 0) continue
    const downW = bin.volume > 0 ? (bin.downVolume / bin.volume) * w : 0
    const isPoc = i === profile.pocIndex
    parts.push(
      `<rect class="vp-bin vp-down" x="${n2(plotR - w)}" y="${n2(top)}" width="${n2(downW)}" height="${n2(h)}" fill="${C.down}" opacity="${isPoc ? 0.6 : 0.42}"/>`,
    )
    parts.push(
      `<rect class="vp-bin vp-up" x="${n2(plotR - w + downW)}" y="${n2(top)}" width="${n2(w - downW)}" height="${n2(h)}" fill="${C.up}" opacity="${isPoc ? 0.6 : 0.42}"/>`,
    )
  }

  // ── Candle ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < count; i++) {
    const b = bars[i]!
    const up = b.close >= b.open
    const color = up ? C.up : C.down
    const cx = n2(x(i))
    const top = n2(y(Math.max(b.open, b.close)))
    const bottom = n2(y(Math.min(b.open, b.close)))
    parts.push(
      `<line class="wick" x1="${cx}" y1="${n2(y(b.high))}" x2="${cx}" y2="${n2(y(b.low))}" stroke="${color}" stroke-width="1"/>`,
    )
    parts.push(
      `<rect class="candle" x="${n2(cx - bodyW / 2)}" y="${top}" width="${n2(bodyW)}" height="${n2(Math.max(1, bottom - top))}" fill="${color}"/>`,
    )
  }

  // ── MA harga ───────────────────────────────────────────────────────────────
  for (const period of MA_PERIODS) {
    const values = priceMA.get(period) ?? []
    const points = values
      .map((v, i) => (v == null ? null : `${n2(x(i))},${n2(y(v))}`))
      .filter((p): p is string => p !== null)
      .join(' ')
    if (!points) continue
    parts.push(
      `<polyline class="ma ma-${period}" points="${points}" fill="none" stroke="${C.ma.get(period)}" stroke-width="1.6"/>`,
    )
  }

  // ── Label nilai terakhir di sumbu kanan ────────────────────────────────────
  const last = bars[count - 1]!
  const badges: Array<{ y: number; text: string; fill: string; text_: string }> = []
  for (const period of MA_PERIODS) {
    const v = priceMA.get(period)?.[count - 1]
    if (v == null) continue
    badges.push({ y: y(v), text: formatPrice(Math.round(v)), fill: C.ma.get(period)!, text_: '#ffffff' })
  }
  badges.push({
    y: y(last.close),
    text: formatPrice(last.close),
    fill: last.close >= last.open ? C.up : C.down,
    text_: '#ffffff',
  })
  for (const b of declutter(badges, 20, L.priceTop + 9, priceBot - 9)) {
    parts.push(
      `<rect x="${plotR + 2}" y="${n2(b.y - 9)}" width="74" height="18" rx="2" fill="${b.fill}"/>`,
      `<text x="${plotR + 8}" y="${n2(b.y + 4)}" fill="${b.text_}" font-size="12.5">${b.text}</text>`,
    )
  }

  // Volume harian dan MA-nya sering berimpit — di emiten yang volumenya rata,
  // keduanya jatuh di piksel yang sama dan labelnya saling menelan. Dorong sama
  // seperti label harga, dan tahan di dalam panel volume.
  const lastLots = lots[count - 1]!
  const lastVolMA = volumeMA[count - 1]
  const volBadges: Array<{ y: number; text: string; fill: string; cls: string }> = []
  if (lastVolMA != null) {
    volBadges.push({
      y: vy(market.toDisplayVolume(lastVolMA)),
      text: formatVolume(market.toDisplayVolume(lastVolMA)),
      fill: C.volMA,
      cls: 'vol-ma-badge',
    })
  }
  volBadges.push({
    y: vy(lastLots),
    text: formatVolume(lastLots),
    fill: last.close >= last.open ? C.up : C.down,
    cls: 'vol-badge',
  })
  for (const b of declutter(volBadges, 20, volTop + 9, volBot - 9)) {
    parts.push(
      `<rect class="${b.cls}" x="${plotR + 2}" y="${n2(b.y - 9)}" width="74" height="18" rx="2" fill="${b.fill}"/>`,
      `<text x="${plotR + 8}" y="${n2(b.y + 4)}" fill="#ffffff" font-size="12.5">${b.text}</text>`,
    )
  }

  // ── Legenda ────────────────────────────────────────────────────────────────
  const prevClose = count > 1 ? bars[count - 2]!.close : last.open
  const change = last.close - prevClose
  const pct = prevClose === 0 ? 0 : (change / prevClose) * 100
  const changeColor = change >= 0 ? C.up : C.down
  const sign = change >= 0 ? '+' : '−'

  let ly = L.priceTop + 18
  parts.push(
    `<text x="${plotL + 6}" y="${ly}" font-size="15" fill="${C.text}">` +
      `${esc(input.name)}, 1D, ${esc(market.exchangeLabel)}  ` +
      `<tspan fill="${C.textDim}">O</tspan><tspan fill="${changeColor}">${formatPrice(last.open)}</tspan>  ` +
      `<tspan fill="${C.textDim}">H</tspan><tspan fill="${changeColor}">${formatPrice(last.high)}</tspan>  ` +
      `<tspan fill="${C.textDim}">L</tspan><tspan fill="${changeColor}">${formatPrice(last.low)}</tspan>  ` +
      `<tspan fill="${C.textDim}">C</tspan><tspan fill="${changeColor}">${formatPrice(last.close)}</tspan>  ` +
      `<tspan fill="${changeColor}">${sign}${formatPrice(Math.abs(change))} (${sign}${Math.abs(pct).toFixed(2)}%)</tspan>` +
      `</text>`,
  )
  ly += 22
  parts.push(
    `<text x="${plotL + 6}" y="${ly}" font-size="14" fill="${C.text}">VPVR (Number Of Rows, ${input.profileRows}, Up/Down) — aproksimasi dari bar harian</text>`,
  )
  for (const period of MA_PERIODS) {
    ly += 22
    const v = priceMA.get(period)?.[count - 1]
    const shown = v == null ? 'n/a' : formatPrice(Math.round(v))
    parts.push(
      `<text x="${plotL + 6}" y="${ly}" font-size="14" fill="${C.ma.get(period)}">MA (${period}, close, 0)  ${shown}</text>`,
    )
  }

  parts.push(
    `<text x="${plotL + 6}" y="${volTop + 18}" font-size="14" fill="${C.text}">Volume (${VOLUME_MA_PERIOD}) — ${esc(market.volumeUnit)}  ${formatVolume(lastLots)}</text>`,
  )

  // ── Garis pemisah panel dan catatan kaki ──────────────────────────────────
  parts.push(
    `<line x1="${plotL}" y1="${volTop - L.gap / 2}" x2="${plotR}" y2="${volTop - L.gap / 2}" stroke="${C.axis}"/>`,
    `<line x1="${plotR}" y1="${L.priceTop}" x2="${plotR}" y2="${volBot}" stroke="${C.axis}"/>`,
    `<line x1="${plotL}" y1="${volBot}" x2="${plotR}" y2="${volBot}" stroke="${C.axis}"/>`,
  )
  parts.push(
    `<text x="${plotL + 6}" y="${L.h - 14}" font-size="12.5" fill="${C.textDim}">` +
      `Profil volume adalah APROKSIMASI: volume tiap hari disebar rata pada rentang low–high hari itu, ` +
      `karena bar harian tidak membawa distribusi intraday. Menunjukkan area konsolidasi, bukan level presisi. ` +
      `Sumber: Yahoo Finance ${esc(input.symbol)} · ${bars[0]!.date} s.d. ${last.date} (${count} bar).` +
      `</text>`,
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}" ` +
    `viewBox="0 0 ${L.w} ${L.h}" font-family="${FONT}">\n${parts.join('\n')}\n</svg>`
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
