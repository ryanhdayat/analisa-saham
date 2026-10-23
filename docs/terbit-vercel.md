# Publishing to Vercel (saham.ryanhdayat.biz.id)

_Fork-only setup. Upstream keeps its own cron + nginx flow (`deploy/terbit.sh`)._

## How it runs

One GitHub Actions run per day, `.github/workflows/terbit.yml`, at 07:15 WIB
(00:15 UTC). It can also be started by hand from the Actions tab
(`workflow_dispatch`).

1. Check out `main` and run `typecheck` + `bun test`. Code that fails its tests
   never publishes.
2. Restore the track record from the `data` branch into `report/`.
3. `deploy/vercel/rakit.sh` scans IDX, scans crypto, scores the track record,
   and assembles a static site in `.vercel/output/` (Build Output API v3).
4. Commit the new `report/pilihan-*.json` and `report/terbit-*.txt` to `data`.
5. `vercel deploy --prebuilt --prod`.

IDX uses yesterday's final close. Crypto drops the daily candle that is still
open (Yahoo dates it by UTC day), so it uses the candle that closed at 00:00 UTC.
The IDX enrichment layer (Chrome scraping behind Cloudflare) is off: `--tanpa-idx`.

## Code vs data

| What | Where | Changes when |
|---|---|---|
| Code | `main` | You merge a verified branch |
| Track record (`pilihan-*.json`) and last published data dates | `data` branch | Every daily run |
| Published site | Vercel deployments | Every successful daily run |

## When something fails

`rakit.sh` refuses to publish, and nothing is deployed, if any section:

- did not write its page,
- had more than 5% of tickers fail to download (`MAKS_GAGAL_PERSEN`), or
- has a data date older than the last published one (stale data from Yahoo).

The previous Vercel deployment stays live. That is the last valid snapshot.

## Rollback

- **Site:** `vercel rollback` or Instant Rollback in the Vercel dashboard.
- **Code:** revert the commit on `main`. The next run publishes the reverted code.
- **Track record:** `git revert` on the `data` branch.

## Test locally

```bash
RAKIT_IDX="BBCA BSSR" RAKIT_CRYPTO="BTC-USD" deploy/vercel/rakit.sh
vercel deploy --prebuilt          # needs `vercel link` once
```

With explicit codes the scan does not write `pilihan-*.json`, so a test run
cannot touch the track record.

## One-time setup

- Repo variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (set).
- Repo secret `VERCEL_TOKEN`: a token from vercel.com/account/tokens scoped to
  `ryanhdayats-projects`.
- Actions enabled on the fork (scheduled workflows are off by default in forks).
- Domain: `vercel domains add saham.ryanhdayat.biz.id analisa-saham`, plus a
  `CNAME saham → cname.vercel-dns.com` record at the DNS provider of
  `ryanhdayat.biz.id`.
