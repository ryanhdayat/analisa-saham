# Rencana Harian Pemula + Perombakan Tampilan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a beginner "Rencana hari ini" (buy price, lots, cut loss, target, rupiah) to `/idx/`. Add an automatic, realistic Rp100 juta simulation with a pass rule to `/hasil/`. Restyle all four pages for beginners on phone and laptop.

**Architecture:** All arithmetic lives in two pure, tested modules: `src/rencana/rencana.ts` (prices, lots, fees) and `src/rencana/catatan.ts` (risk labels). The screener page embeds the daily plan computed in TypeScript. The browser recomputes only lots when the user changes capital, using a marked copy of the lot formula that a test checks against the module. `/hasil/` gets an IDX fill model (`judgeIdx`) and a simulation summary. A shared theme and nav (`src/output/tema.ts`) are injected into every page; the landing page becomes a generated template.

**Tech Stack:** Bun 1.4.2, TypeScript, `bun:test`, single-file HTML templates with inline CSS/JS (no bundler, no framework), static site on Vercel via `deploy/vercel/rakit.sh`.

**Spec:** `docs/superpowers/specs/2026-10-23-rencana-pemula-design.md`

## Global Constraints

- Fork only (`ryanhdayat/analisa-saham`, branch `feat/rencana-pemula`). Do not open a PR to upstream.
- No login, no database, no server/API, no Stockbit automation. Static files only.
- Default capital `100_000_000` (Rp). `/hasil/` always uses this default.
- Risk per stock 1% of capital. Position cap 20% of capital per stock. 1 lot = `SHARES_PER_LOT` (100) shares.
- Fees: buy `0.0015`, sell `0.0025` of transaction value. Named constants, with a comment saying the values must be checked against Stockbit's current tariff.
- Cut loss = `cutLoss(entry, stop)` from `src/hasil/nilai.ts`, then floored to the BEI price step. Target is floored to the BEI price step too. Entry = close (already a valid step).
- Pass rule: at least `30` finished IDX trades (target or cut) with mean net % return > 0. Statuses: `kurang-data` / `belum-lulus` / `lulus`.
- Labels: `bersih` | `hati-hati`. Old picks without a label count as `tanpa-label`.
- IDX only for plan, lots, rupiah, labels in `/hasil/`, fill model. Crypto keeps today's percent-based judging and plain views.
- Every page: light and dark themes, works at 360px wide with no horizontal scroll in the top layer, shared nav (Beranda · Rencana (IDX) · Crypto · Hasil).
- `localStorage` reads and writes wrapped in try/catch; the page works without storage.
- Copy is Indonesian, plain language for beginners. Technical terms appear only in detail layers.
- Every user-visible plan says this is simulation and not a buy instruction.
- Load the `frontend-design:frontend-design` skill before Task 7 and keep it in force for Tasks 7–10.

## Review Focus

- Capital input empty, zero, negative, non-numeric, or huge → fall back to the default or show "modal terlalu kecil", never `NaN`/`Infinity`. Pinned in Task 8.
- Plan where the 1% rule or the 20% cap gives 0 lots (expensive stock, small capital) → shows "modal terlalu kecil untuk saham ini". Pinned in Task 1.
- A day with no passing IDX rows → plan section says "Tidak ada rencana hari ini", with no empty table or broken layout. Pinned in Task 8.
- Mixed history: old `pilihan-*.json` without `label`, plus crypto picks → IDX groups them as `tanpa-label`, and crypto judging is unchanged. Pinned in Tasks 4–5.
- First bar after the scan opens below the cut loss → `dilewati`, never "filled then cut". Pinned in Task 4.

---

### Task 1: Price step floor, fees, and the plan calculator

**Files:**
- Modify: `src/analysis/levels.ts` (next to `roundToTick`)
- Create: `src/rencana/rencana.ts`
- Test: `src/analysis/levels.test.ts`, `src/rencana/rencana.test.ts`

**Interfaces:**
- Produces:
  - `floorToTick(price: number): number`. Largest valid BEI step ≤ price, with the step chosen by `idxTickSize(price)`.
  - `MODAL_BAWAAN = 100_000_000`, `RISIKO_PER_SAHAM = 0.01`, `BATAS_PER_SAHAM = 0.2`, `BIAYA_BELI = 0.0015`, `BIAYA_JUAL = 0.0025`.
  - `interface Rencana { beli: number; jualRugi: number; jualUntung: number; lot: number; nilai: number; rugiRp: number; untungRp: number }`. `nilai` = lot × 100 × beli. Both Rp values are net of fees: rugiRp < 0, untungRp > 0.
  - `rencanaIdx(entry: number, stop: number, target: number, modal?: number): Rencana`.
  - `hitungLot(beli: number, jualRugi: number, modal: number): number`. Returns 0 for invalid or too-small capital.
  - `biaya(beli: number, jual: number, lot: number): number`.
  - `returnBersih(beli: number, jual: number): number`. Fraction after fees = `(jual × (1 − BIAYA_JUAL)) / (beli × (1 + BIAYA_BELI)) − 1`.

- [ ] **Step 1: Write failing tests**

```ts
// levels.test.ts
test('floorToTick membulatkan ke bawah ke fraksi BEI', () => {
  expect(floorToTick(10552)).toBe(10550)   // fraksi 25
  expect(floorToTick(1083.2)).toBe(1080)   // fraksi 5
  expect(floorToTick(4929.33)).toBe(4920)  // fraksi 10
  expect(floorToTick(2100)).toBe(2100)
})
// rencana.test.ts — angka nyata 23 Okt
test('rencanaIdx ULTJ: cut loss dijepit −5%, lot dibatasi 20% modal', () => {
  const r = rencanaIdx(2100, 2022.543, 2190)
  expect(r).toMatchObject({ beli: 2100, jualRugi: 1995, jualUntung: 2190, lot: 95 })
})
test('rencanaIdx AADI: lot dari aturan rugi 1%', () => {
  expect(rencanaIdx(11375, 10560, 11700).lot).toBe(12)
})
test('rugi dan untung rupiah sudah dipotong biaya', () => {
  const r = rencanaIdx(2100, 2022.543, 2190)
  expect(r.rugiRp).toBeCloseTo(95 * 100 * (1995 - 2100) - biaya(2100, 1995, 95), 6)
  expect(r.untungRp).toBeCloseTo(95 * 100 * (2190 - 2100) - biaya(2100, 2190, 95), 6)
})
test('modal terlalu kecil → lot 0', () => {
  expect(rencanaIdx(11375, 10560, 11700, 1_000_000).lot).toBe(0)
})
test('hitungLot menolak modal tidak sah', () => {
  for (const m of [0, -5, NaN, Infinity]) expect(hitungLot(2100, 1995, m)).toBe(0)
})
test('returnBersih memotong biaya beli dan jual', () => {
  expect(returnBersih(1000, 1000)).toBeCloseTo(0.9975 / 1.0015 - 1, 9)
})
```

- [ ] **Step 2:** Run `bun test src/analysis/levels.test.ts src/rencana/rencana.test.ts`. Expected: FAIL (exports missing).
- [ ] **Step 3:** Implement the exports above. `rencanaIdx` uses `cutLoss` from `src/hasil/nilai.ts` and `SHARES_PER_LOT` from `src/market.ts`. `hitungLot = min(floor(modal × RISIKO / ((beli − jualRugi) × 100)), floor(modal × BATAS / (beli × 100)))`, clamped to ≥ 0. It returns 0 when modal is not finite or ≤ 0, or when `beli ≤ jualRugi`.
- [ ] **Step 4:** Run `bun test` and `bun run typecheck`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(rencana): hitungan harga beli, lot, dan biaya`.

### Task 2: Risk labels from `ScanRow`, in plain language

**Files:**
- Create: `src/rencana/catatan.ts`
- Modify: `src/output/screener.ts` (replace the local `catatan()` and its sets; `CATATAN` comes from the new module)
- Test: `src/rencana/catatan.test.ts`, update `src/output/screener.test.ts` (three `CATATAN` tests)

**Interfaces:**
- Produces:
  - `interface Catatan { teknis: string; awam: string; kind: 'bad' | 'warn' }`
  - `catatanRisiko(row: ScanRow): Catatan[]`. Same rules as today's `catatan()`. `teknis` keeps today's exact strings (e.g. `R:R 1:0,51`, `Wyckoff distribusi`, `no-demand 10-23`).
  - `type Label = 'bersih' | 'hati-hati'`. `labelRisiko(c: Catatan[]): Label`.
  - Screener row field `CATATAN: Catatan[]`, plus `LABEL: Label`.

- [ ] **Step 1: Write failing tests.** Each rule produces its `teknis` string and a non-empty `awam` string. Fixed `awam` copy:
  - `R:R < 1` → `potensi untung lebih kecil dari risiko rugi`
  - `rally-lemah` → `naiknya tanpa dukungan volume`
  - `tekanan-jual` → `turun dengan volume besar`
  - `no-demand` → `pembeli sepi saat harga naik`
  - `upthrust` → `sempat naik lalu ditolak turun`
  - `Wyckoff distribusi`/`markdown` → `pola grafik cenderung turun`
  - `rebound` → `naik sesaat di tren turun`
  - `OBV bearish` → `aliran volume melemah`

  A clean `row()` gives `[]` and `labelRisiko([]) === 'bersih'`. Update the screener tests to `expect(rows[0].CATATAN).toContainEqual(expect.objectContaining({ teknis: 'R:R 1:0,51', kind: 'warn' }))`, plus `rows[0].LABEL === 'hati-hati'`.
- [ ] **Step 2:** Run `bun test src/rencana src/output/screener.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `catatanRisiko` from `row.metrics` (wyckoff phase, vpa latest signal/date, structure daily phase, filters obvDivergence, volume classification, riskReward ratio). Use `screener.ts`'s `idNum` formatting for the ratio. In `tableRow`, set `CATATAN` and `LABEL` from `row`. In the template, `r.flags` now maps `c => [c.teknis, c.kind]` so the old views still render.
- [ ] **Step 4:** Run `bun test` and `bun run typecheck`. Expected: pass.
- [ ] **Step 5:** Commit `refactor(catatan): label risiko dari ScanRow, dengan bahasa awam`.

### Task 3: Record the label in each pick

**Files:**
- Modify: `src/hasil/nilai.ts` (`Pilihan`, `pilihanFromRows`)
- Test: `src/hasil/nilai.test.ts` (`describe('pilihanFromRows')`)

**Interfaces:**
- Consumes: `catatanRisiko`, `labelRisiko`, `Label` (Task 2).
- Produces: `Pilihan.label?: Label`. `pilihanFromRows` sets it for every row.

- [ ] **Step 1:** Write two failing tests. A passing row with R:R 0.5 gets `label: 'hati-hati'`. A clean passing row gets `label: 'bersih'`.
- [ ] **Step 2:** Run `bun test src/hasil/nilai.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun test` and `bun run typecheck`. Expected: pass.
- [ ] **Step 5:** Commit `feat(hasil): catat label bersih/hati-hati di pilihan`.

### Task 4: IDX fill model in `/hasil/`

**Files:**
- Modify: `src/hasil/nilai.ts` (`Status`, `Hasil`, new `judgeIdx`, `buildPicks`)
- Modify: `src/hasil.ts` (pass the market)
- Test: `src/hasil/nilai.test.ts` (`describe('judgeIdx')`, extend `describe('buildPicks')`)

**Interfaces:**
- Consumes: `rencanaIdx` (Task 1).
- Produces:
  - `type Status = 'target' | 'cut' | 'open' | 'dilewati' | 'tidak-terbeli'`
  - `Hasil.isi: number | null`, the fill price. `ret` is measured from `isi` when filled, and is 0 for `dilewati`/`tidak-terbeli`.
  - `judgeIdx(p: Pilihan, bars: Bar[]): Hasil`. `cut` and `target` are the floored plan prices from `rencanaIdx(p.entry, p.stop, p.target)`.
  - `buildPicks(scans: Pilihan[], barsByCode: Map<string, Bar[]>, market?: Market)`. Use `judgeIdx` only when `market?.id === 'idx'`, else `judge`. Omitting `market` keeps today's behaviour for existing tests; `hasil.ts` passes it explicitly.

The rules come from the spec ("Keputusan perancang" 2). The first bar after `p.date` is the order day:

```
open ≥ target or open ≤ cut         → dilewati, settled = that date
else low > entry                    → tidak-terbeli, settled = that date
else isi = min(open, entry); then on that same bar apply the existing
     target/cut check (both touched → cut), then continue on later bars.
     Exit and ret are based on isi.
no bar after p.date                 → open, isi null, days 0
```

- [ ] **Step 1: Write failing tests.** Use `bar(date, low, high, close, open)`.
  - The first bar opens at or above the target → `dilewati`, `isi` null, `ret` 0.
  - The first bar opens below the cut loss → `dilewati`.
  - The first bar's low stays above the entry → `tidak-terbeli`.
  - Opens below the entry and above the cut loss → `isi === open`, status `open` at the latest close.
  - Filled and the cut loss is touched on the same bar → `cut`, `exit = min(open, cut)`.
  - `cut`/`target` equal `floorToTick` of the raw values (`entry 11375, stop 10560, target 11700` → `cut 10550`).
  - `buildPicks` with market IDX: a `dilewati` pick on D lets a scan dated D open a new pick.
  - `buildPicks` without a market leaves crypto/old behaviour unchanged (existing tests still pass).
- [ ] **Step 2:** Run `bun test src/hasil/nilai.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `judgeIdx` and the market switch. In `src/hasil.ts`, call `buildPicks(scans, barsByCode, market)`. Update `summarize`: `dilewati`/`tidak-terbeli` are excluded from `dinilai`, and get counts `dilewati`, `tidakTerbeli` added to `Ringkasan`.
- [ ] **Step 4:** Run `bun test` and `bun run typecheck`. Expected: pass.
- [ ] **Step 5:** Commit `feat(hasil): simulasi Buy limit pagi berikutnya untuk IDX`.

### Task 5: Rupiah simulation summary and the pass rule

**Files:**
- Create: `src/rencana/simulasi.ts`
- Modify: `src/hasil.ts`, `src/output/hasil-page.ts` (`HasilPasar.simulasi?`)
- Test: `src/rencana/simulasi.test.ts`, `src/output/hasil-page.test.ts`

**Interfaces:**
- Consumes: `Hasil` (Task 4), `rencanaIdx`, `returnBersih`, `biaya` (Task 1), `Label` (Task 2).
- Produces:
  - `MIN_TRANSAKSI = 30`
  - `interface PosisiSim { lot: number; rp: number; retBersih: number }`
  - `posisi(h: Hasil): PosisiSim | null`. Null unless filled. Lot comes from `rencanaIdx(h.entry, h.stop, h.target).lot`. `rp = lot × 100 × (keluar − isi) − biaya(isi, keluar, lot)`, where keluar = exit, or the latest close while open.
  - `interface Kelompok { n: number; target: number; cut: number; rataBersih: number | null }`
  - `interface RingkasanSimulasi { modal: number; selesai: number; totalRp: number; rataBersih: number | null; dilewati: number; tidakTerbeli: number; status: 'kurang-data' | 'belum-lulus' | 'lulus'; perLabel: Record<'bersih' | 'hati-hati' | 'tanpa-label', Kelompok> }`
  - `ringkasSimulasi(picks: Hasil[]): RingkasanSimulasi`. Only finished trades (`target`/`cut`) count toward `selesai`, `rataBersih`, and `status`. `totalRp` includes open positions at their latest close.
  - `HasilPasar.simulasi?: RingkasanSimulasi`, set for IDX only. `Hasil` objects for IDX carry `sim?: PosisiSim`.

- [ ] **Step 1: Write failing tests.**
  - 29 finished trades → `kurang-data`.
  - 30 with a positive mean → `lulus`.
  - 30 with a negative mean → `belum-lulus`.
  - Open picks excluded from `selesai`.
  - A pick without `label` lands in `tanpa-label`.
  - `rp` of a target hit equals the hand-computed value.
  - `buildHasilPage` embeds `simulasi` for IDX and omits it for crypto.
- [ ] **Step 2:** Run `bun test src/rencana src/output/hasil-page.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. In `hasil.ts`, for the IDX market, attach `sim` per pick and `simulasi` per market.
- [ ] **Step 4:** Run `bun test` and `bun run typecheck`. Expected: pass.
- [ ] **Step 5:** Commit `feat(hasil): ringkasan simulasi Rp100 juta dan aturan lulus`.

### Task 6: Daily plan data in the screener page

**Files:**
- Modify: `src/output/screener.ts` (`tableRow`, `buildScreener` meta)
- Test: `src/output/screener.test.ts`

**Interfaces:**
- Consumes: `rencanaIdx`, `MODAL_BAWAAN` (Task 1), `LABEL` (Task 2).
- Produces:
  - Row field `RENCANA: Rencana | null`. Only for IDX rows with `GERBANG === 'lolos'` and an available plan; null otherwise and always null for crypto.
  - Meta field `modal: MODAL_BAWAAN`.

- [ ] **Step 1: Write failing tests.**
  - An IDX passing row → `RENCANA.jualRugi === floorToTick(CUT_LOSS)`, and `lot` matches `rencanaIdx`.
  - A failing row → `RENCANA === null`.
  - A crypto row → `RENCANA === null`.
  - `meta.modal === 100_000_000`.
  - A run with zero passing rows → every `RENCANA` null. This is the input for the "no plan today" view.
- [ ] **Step 2:** Run `bun test src/output/screener.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun test`. Expected: pass.
- [ ] **Step 5:** Commit `feat(screener): data rencana harian per emiten lolos`.

### Task 7: Shared theme, nav, and data-freshness badge

Load `frontend-design:frontend-design` first. Keep the existing visual language: Archivo / IBM Plex Sans / IBM Plex Mono, up/down/warn tokens, light and dark themes.

**Files:**
- Create: `src/output/tema.ts`
- Modify: `src/output/screener.ts`, `src/output/hasil-page.ts` (inject placeholders)
- Test: `src/output/tema.test.ts`

**Interfaces:**
- Produces:
  - `TEMA_CSS: string`. Tokens and base styles shared by all pages.
  - `navHtml(aktif: 'beranda' | 'idx' | 'crypto' | 'hasil', akar: string): string`. Links are relative to `akar` (`'../'` on section pages, `''` on the landing page).
  - `SKRIP_BASI: string`. An inline script defining `dataBasi(tanggal: string, pasar: 'idx' | 'crypto', now: Date): boolean`, wrapped in the markers `/*<dataBasi>*/ … /*</dataBasi>*/`.
  - Templates get placeholders `/*__TEMA__*/`, `<!--__NAV__-->`, `/*__BASI__*/`, replaced by function (not string) in the build functions.

Freshness rule (spec, "Keputusan perancang" 5), evaluated in the browser at view time:
- IDX: the expected date is the latest weekday strictly before today in WIB. If it is a weekday at or after 16:15 WIB, the expected date is today.
- Crypto: the expected date is yesterday in UTC.
- Stale = `tanggal < expected`. The copy says "mungkin karena libur bursa" for IDX.

- [ ] **Step 1: Write failing tests.** `tema.test.ts` extracts `dataBasi` from `SKRIP_BASI` via the markers and evaluates it with `new Function`. Cases:
  - IDX `2026-10-22` at `2026-10-23T00:15Z` (Fri 07:15 WIB) → false.
  - IDX `2026-10-22` at `2026-10-26T00:15Z` (Mon) → true.
  - IDX `2026-10-23` at `2026-10-26T00:15Z` → false.
  - Crypto `2026-10-22` at `2026-10-23T05:00Z` → false; at `2026-10-24T05:00Z` → true.
  - `navHtml('hasil','../')` marks the Hasil link `aria-current="page"` and links `../idx/`.
  - `buildScreener` and `buildHasilPage` output contain no `__TEMA__`, `__NAV__`, or `__BASI__`.
- [ ] **Step 2:** Run `bun test src/output`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire into both build functions. The header on each section page shows the data date, the publish time (from `terbit.json` when served, else the build stamp), and a "data mungkin basi" badge when `dataBasi` is true.
- [ ] **Step 4:** Run `bun test` and `bun run typecheck`. Expected: pass.
- [ ] **Step 5:** Commit `feat(tampilan): tema, navigasi, dan tanda data basi bersama`.

### Task 8: `/idx/` and `/crypto/` page redesign

**Files:**
- Modify: `src/output/screener-template.html`
- Test: `src/output/screener-rencana.test.ts`

**Interfaces:**
- Consumes: row fields `RENCANA`, `CATATAN`, `LABEL`, `CUT_LOSS`; meta `modal` (Tasks 2, 6); `TEMA_CSS`, `navHtml`, `SKRIP_BASI` (Task 7).
- Produces: in-template `hitungLot(beli, jualRugi, modal)` between the markers `/*<hitungLot>*/ … /*</hitungLot>*/`, behaviour-identical to Task 1's `hitungLot`.

Layout follows the spec section "Tampilan → /idx/":
1. Header, with a "Masa simulasi" pill.
2. **Rencana hari ini**: capital input (`id="modal"`, default from meta, saved under `localStorage['rencana-modal']`). Cards at < 760px, a table at ≥ 760px. `bersih` first, then `hati-hati` with its `awam` reasons. Each card shows "Lihat grafik & alasan", which opens the existing drawer. Empty state: "Tidak ada rencana hari ini — tidak ada saham yang lolos. Itu wajar; jangan memaksa beli."
3. Collapsible "Cara memasang di Stockbit Virtual Trading" with the 4 steps from the spec.
4. Collapsible "Semua hasil screening", holding the existing tabs, filters, table, and the technical banners rewritten in plain words.

Drawer: a plain-language summary first (why it passed in 2–3 points, and the plan with the same numbers as the card). The chart stays. Per-metric verdicts move into a collapsed "Detail teknis". The crypto page (no `RENCANA`) shows the header, nav, and section 4 expanded by default.

Changing capital recomputes `lot`, `nilai`, `rugiRp`, and `untungRp` per card with `hitungLot` and the fee constants. Invalid input shows the default and a short hint. 0 lots shows "modal terlalu kecil untuk saham ini".

- [ ] **Step 1: Write failing tests** in `screener-rencana.test.ts`:
  - Extract `hitungLot` from the template by its markers.
  - For a grid of `(beli, jualRugi, modal)` cases, the extracted function must equal Task 1's `hitungLot`. Grid: `[2100,1995,1e8]`, `[11375,10550,1e8]`, `[11375,10550,1e6]`, `[50,47,5e6]`, `[2100,1995,0]`, `[2100,1995,NaN]`, `[2100,1995,-1]`.
  - The template contains the empty-state copy.
  - The template contains a simulation disclaimer.
- [ ] **Step 2:** Run `bun test src/output/screener-rencana.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Rebuild the template per the layout above. The fee constants in the template carry the same marker convention, and a test asserts they equal `BIAYA_BELI`/`BIAYA_JUAL`.
- [ ] **Step 4:** Run `bun test`. Then build locally: `RAKIT_IDX="BBCA BSSR ULTJ MARK AADI BDMN" RAKIT_CRYPTO="BTC-USD ETH-USD" deploy/vercel/rakit.sh`. Serve `situs/` (`python3 -m http.server -d situs 8787`). Screenshot `/idx/`, `/idx/#BSSR`, and `/crypto/` at 360, 390, and 1280 widths, in light and dark, with the Playwright script from `/tmp/shots/shot.ts` adapted to localhost. Check: no horizontal scroll in the top layer, and the capital input recomputes lots.
- [ ] **Step 5:** Commit `feat(tampilan): halaman screener untuk pemula dengan rencana hari ini`.

### Task 9: `/hasil/` page redesign

**Files:**
- Modify: `src/output/hasil-template.html`
- Test: `src/output/hasil-page.test.ts`

**Interfaces:**
- Consumes: `HasilPasar.simulasi`, `Hasil.sim`, `Hasil.isi`, the new statuses (Tasks 4–5); theme, nav, and freshness badge (Task 7).

Layout follows the spec section "Tampilan → /hasil/":
1. Header and nav.
2. **Simulasi Rp100 juta**: total Rp, mean net %, a pass-status card with progress ("12 dari 30 transaksi · rata-rata −0,6%"), and counts for dilewati / tidak terbeli.
3. **Bersih vs hati-hati (vs tanpa label)** comparison.
4. Open and finished lists. Cards on phone, table on laptop. Add the lot, Rp, and label columns, and badges for `dilewati`/`tidak-terbeli`.
5. Updated "Cara menilai": Buy limit next morning, skip rule, fill rule, floored prices, fees, independent sizing (no shared cash), and the pass rule.

The crypto tab keeps percent views and hides sections 2–3.

- [ ] **Step 1: Write failing tests.**
  - `buildHasilPage` output contains the pass-status labels `Belum cukup data`, `Belum lulus`, and `Lulus`.
  - It contains the "Cara menilai" lines for the skip and fill rules.
  - It contains no leftover placeholders.
- [ ] **Step 2:** Run `bun test src/output/hasil-page.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Rebuild the template.
- [ ] **Step 4:** Run `bun test`. Then run `bun run src/hasil.ts` against a temp `report/` seeded with a copy of the `data` branch (`git show origin/data:report/pilihan-2026-10-23.json`). Screenshot at 360 and 1280 widths, light and dark.
- [ ] **Step 5:** Commit `feat(tampilan): halaman hasil dengan simulasi dan aturan lulus`.

### Task 10: Generated landing page

**Files:**
- Create: `src/output/beranda-template.html`, `src/output/beranda.ts`, `src/beranda.ts` (CLI: writes `index.html` to a given path)
- Modify: `deploy/vercel/rakit.sh` (generate the landing page instead of `cp deploy/vercel/index.html`)
- Delete: `deploy/vercel/index.html`
- Test: `src/output/beranda.test.ts`

**Interfaces:**
- Consumes: `TEMA_CSS`, `navHtml` (Task 7).
- Produces: `buildBeranda(template: string): string`. Data loads at view time from `idx/terbit.json`, `crypto/terbit.json`, `hasil/terbit.json`, and `hasil/hasil.json` (for the simulation status line).

Content follows the spec section "Tampilan → Beranda": one primary call to action, "Lihat rencana hari ini" → `idx/`; crypto and hasil cards; a simulation status line; schedule text "tiap hari pukul 07.15 WIB"; a disclaimer.

- [ ] **Step 1: Write failing tests.**
  - `buildBeranda` output has nav with Beranda current.
  - It has a link `href="idx/"` with the call-to-action copy.
  - It has no placeholders.
- [ ] **Step 2:** Run `bun test src/output/beranda.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `rakit.sh` runs `bun run src/beranda.ts "$STAGE/index.html"` and fails the build if it errors.
- [ ] **Step 4:** Run `bun test`, then the Task 8 local build. Screenshot `/` at 360 and 1280 widths.
- [ ] **Step 5:** Commit `feat(tampilan): beranda dibangun dari template bersama`.

### Task 11: Docs, end-to-end check, preview, PR

**Files:**
- Modify: `docs/terbit-vercel.md` (landing is generated, plan section, simulation), `README.md` (short "Rencana hari ini" and "Simulasi" notes under the HTML-page section)

- [ ] **Step 1:** Run `bun test` and `bun run typecheck`. Expected: all pass. Report the counts.
- [ ] **Step 2:** Run a full local `rakit.sh` with small codes, then a preview deploy: `mkdir -p situs/.vercel && cp .vercel/project.json situs/.vercel/ && (cd situs && vercel deploy)`, then `rm -rf situs/.vercel`. Probe every route with `vercel curl`.
- [ ] **Step 3:** Update the docs. Commit `docs: rencana harian dan simulasi`.
- [ ] **Step 4:** Push the branch. Open a PR **in the fork** (`gh pr create -R ryanhdayat/analisa-saham --base main`) with the screenshots listed and the preview URL. Wait for CI. Merging is the owner's call.
