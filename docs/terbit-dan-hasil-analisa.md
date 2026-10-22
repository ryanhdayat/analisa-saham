# Publishing to analisa-saham.mhamzah.id and the Hasil Analisa report

_Written 2026-10-22._

The screeners and a track record of their picks are published automatically by
cron to **https://analisa-saham.mhamzah.id**.

| URL | Content | Refreshed |
|---|---|---|
| `/` | Landing page with the data date of each section | on every publish |
| `/idx/` | Latest IDX screener | Tuesday–Saturday 05:00 WIB |
| `/crypto/` | Latest crypto screener | every day 21:00 WIB |
| `/hasil/` | Track record: picks that hit target, hit cut loss, still open | every day 18:00 WIB |

## Schedule

All times live in `deploy/jadwal.conf` (standard cron format, server clock is
Asia/Jakarta / WIB):

```bash
IDX_JADWAL="0 5 * * 2-6"     # previous trading day is final; Friday's close shows all weekend
CRYPTO_JADWAL="0 21 * * *"
HASIL_JADWAL="0 18 * * *"
```

After editing it:

```bash
deploy/pasang-cron.sh        # rewrites only the analisa-saham block in the crontab
```

If you change the times, also update the schedule wording in
`deploy/web/index.html`. It's plain text.

Publish immediately without waiting for the schedule:

```bash
deploy/terbit.sh idx
deploy/terbit.sh crypto
deploy/terbit.sh hasil
```

## How publishing works (`deploy/terbit.sh`)

1. Runs the scan (`src/scan.ts --market <idx|crypto>`) or the results report
   (`src/hasil.ts`).
2. Copies the generated folder to `/var/www/html/analisa-saham/rilis/<name>-<time>/`
   and writes `terbit.json` (data date + publish time) into it.
3. Atomically switches the symlink `/var/www/html/analisa-saham/<name>` to the new
   folder, so visitors never see a half-copied page.
4. Refreshes the landing page and keeps only the two newest releases per name.

Safety:
- **Previous page kept on failure.** If no page was written, or every ticker
  failed to download, the previous page stays up. A few failed tickers is normal,
  and the page still gets published.
- **No overlapping runs.** A lock prevents two runs of the same name at once.
- **Logs** go to `logs/terbit-<name>.log`.

## nginx

- **Site config:** `deploy/nginx/analisa-saham.mhamzah.id.conf`, a copy of what
  is installed in `/etc/nginx/sites-available/`, including the certbot lines.
- **HTTPS:** Let's Encrypt via certbot, which renews automatically. Plain http
  redirects to https.
- **Caching:** `Cache-Control: no-cache`, because file names repeat from day to
  day. `/rilis/` returns 404; releases are only reachable through `/idx`,
  `/crypto` and `/hasil`.

## Hasil Analisa (track record)

### Where the picks come from

Each **full-watchlist, final (non-DRAFT)** scan writes
`report/pilihan-<DATE>.json` (IDX) or `report/crypto/pilihan-<DATE>.json`
(crypto). Each file lists the tickers that passed the gate, with exact
entry/stop/target values. The CSV rounds these to whole numbers, which turns a
$0.0003 coin into 0.

Not recorded:
- **Scans of a few hand-picked codes** (e.g. `scan.ts BBCA`), so they can't
  overwrite that day's record.
- **DRAFT scans** (IDX before 16:15 WIB on a trading day), because the entry
  would be an unfinished close.

> These `pilihan-*.json` files ARE the track record. Don't delete them.

### Scoring rules (`src/hasil/nilai.ts`)

- **One pick per ticker.** A passing ticker opens a pick at that scan's close.
  While the pick is open, passing again doesn't open another. Once it's settled,
  the next pass opens a new one.
- **Target** = the scan's TARGET (the nearest resistance, capped at +10% above
  the entry since 2026-10-22).
- **Cut loss** = the scan's STOP, kept between −5% and −10% below the entry:
  deeper than −10% is tightened to −10%, shallower than −5% is widened to −5%.
- **Hit target** (correct): the day's high reaches TARGET. The exit is the target.
- **Hit cut loss** (wrong): the day's low reaches the cut loss. If the day opens
  below the cut loss (a gap down), the exit is the opening price.
- **Both on the same day** count as cut loss, because daily bars can't show which
  came first.
- **The scan day's own bar is ignored**, because the entry is that day's close.
- **Open picks** are scored at the latest close. **Correct** = price is above the
  entry.
- **Picks with no trading day since the scan** don't count toward % correct or
  the average return yet.
- **Nothing is stored between runs.** Every pick is re-scored from price bars on
  each run, so a missed or repeated run never changes the results.

### The page

- An IDX tab and a crypto tab (the last choice is remembered per browser).
- **Summary:** total picks, hit target, hit cut loss, still open, % correct,
  average return per pick.
- **Open picks table:** entry, target, cut loss, latest price, return, and a
  progress bar ("x% menuju target" when up, "x% menuju cut loss" when down).
- **Settled picks table:** result, settle date, exit price, return, days held.
- A search box to filter by code or name.

Output on disk: `report/hasil-<DATE>/index.html` and `hasil.json`.

## Files

| File | Role |
|---|---|
| `deploy/jadwal.conf` | Schedule, scan options, web root |
| `deploy/pasang-cron.sh` | Installs the schedule into the crontab |
| `deploy/terbit.sh` | Run + atomic publish |
| `deploy/web/index.html` | Landing page |
| `deploy/nginx/analisa-saham.mhamzah.id.conf` | nginx site |
| `src/hasil/nilai.ts` | Pure scoring: cut loss, judge, one-open-pick rule, summary |
| `src/hasil.ts` | CLI: read picks, fetch bars, write the page |
| `src/output/hasil-page.ts`, `hasil-template.html` | Results page |
| `src/scan.ts` | Now also writes `pilihan-<DATE>.json` |

## Gate change (2026-10-22)

The replay test (`src/replay.ts`, 2 years of history) showed the old gate (R:R ≥ 2)
picked far-away targets that rarely got hit before the cut loss (20% IDX, 6% crypto).
The gate is now:

1. Liquidity (≥ Rp5 billion/day, ≥ $10 million/day for crypto).
2. A measurable plan (support below and resistance above).
3. Full MA trend: all 5 conditions (close > MA20 > MA50 > MA200, MA50 and MA200
   rising).
4. Calm volatility: ATR ≤ 5.1% (IDX) / 7.6% (crypto), the replay medians.

The target is capped at +10% above the entry. In the replay, the new gate's picks
rose over 20 days 45.9% of the time on IDX (baseline 40.8%) and 50.2% in crypto
(baseline 37.1%), in both halves of the period. The average trade is still slightly
negative (about −0.8%), because wins are smaller than the cut loss.

Override with `--min-rr`, `--min-tren`, `--maks-atr`, `--target-maks` (see the README).
Picks recorded before this change used the old gate.

## Known limits

- **Thin early history.** The track record starts 2026-10-22 (crypto) and the
  first final IDX scan, so early numbers mean little.
- **Far targets.** Some targets are far away (e.g. +100% or more), and those picks
  can stay open for months unless the cut loss closes them.
- **Crypto 21:00 entries** are the price at that moment, because that day's daily
  candle isn't finished yet.
- **`report/` keeps growing.** It keeps a dated screener folder for every run
  (around 15 MB per IDX day) and nothing cleans it up.
- **Screener pages don't link back.** They have no link to the landing page or to
  each other.
