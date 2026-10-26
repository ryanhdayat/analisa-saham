# Publishing to Vercel (saham.ryanhdayat.biz.id)

_Fork-only setup. Upstream keeps its own cron + nginx flow (`deploy/terbit.sh`)._

Same pattern as the owner's other Vercel projects: the Vercel GitHub integration
deploys on push, and there is no Vercel token in GitHub. The difference is what
gets pushed. The production branch is `site`, which holds the generated static
site, not the code.

## How it runs

`.github/workflows/terbit.yml` runs at 18:30 WIB on trading days (the day's close
is final, so the next day's plan is up the evening before), plus 07:15 and a
08:45 fallback every day. It can also be started by hand from the Actions tab
(`workflow_dispatch`).

1. Check out `main` and run `typecheck` + `bun test`. Code that fails its tests
   never publishes.
2. Restore the track record from the `data` branch into `report/`.
3. `deploy/vercel/rakit.sh` scans IDX, scans crypto, scores the track record,
   generates the landing page (`src/beranda.ts`), and assembles a static site
   plus `vercel.json` in `situs/`.
4. Commit the new `report/pilihan-*.json` and `report/terbit-*.txt` to `data`.
5. Force-push `situs/` as a single orphan commit to `site`. Vercel deploys it to
   production.

IDX uses yesterday's final close. Crypto drops the daily candle that is still
open (Yahoo dates it by UTC day), so it uses the candle that closed at 00:00 UTC.
The IDX enrichment layer (Chrome scraping behind Cloudflare) is off: `--tanpa-idx`.

## Code vs data

| What | Where | Changes when |
|---|---|---|
| Code | `main` | You merge a verified branch |
| Track record (`pilihan-*.json`) and last published data dates | `data` branch | Every daily run |
| Published site | `site` branch, one commit, overwritten daily | Every successful daily run |
| Site history | Vercel deployments list | Every successful daily run |

The root `vercel.json` sets `git.deploymentEnabled: false`, so pushes to `main`
or feature branches never deploy. The `vercel.json` inside `site` turns off the
build and sets headers and redirects.

## When something fails

`rakit.sh` refuses to publish, and nothing is pushed to `site`, if any section:

- did not write its page,
- had more than 5% of tickers fail to download (`MAKS_GAGAL_PERSEN`), or
- has a data date older than the last published one (stale data from Yahoo).

The previous Vercel deployment stays live. That is the last valid snapshot.

## Rollback

- **Site:** Instant Rollback in the Vercel dashboard (or `vercel rollback`).
- **Code:** revert the commit on `main`. The next run publishes the reverted code.
- **Track record:** `git revert` on the `data` branch.

## Test locally

```bash
RAKIT_IDX="BBCA BSSR" RAKIT_CRYPTO="BTC-USD" deploy/vercel/rakit.sh
mkdir -p situs/.vercel && cp .vercel/project.json situs/.vercel/
(cd situs && vercel deploy)     # preview, behind Vercel Authentication
rm -rf situs/.vercel
```

With explicit codes the scan does not write `pilihan-*.json`, so a test run
cannot touch the track record.

## One-time setup

- Vercel project `analisa-saham` connected to `ryanhdayat/analisa-saham`, with
  production branch `site`.
- Actions enabled on the fork (scheduled workflows are off by default in forks).
- Domain `saham.ryanhdayat.biz.id` on the project, plus a
  `CNAME saham → cname.vercel-dns.com` record at the DNS provider of
  `ryanhdayat.biz.id`.

## What the pages show

All four pages share one theme and nav (`src/output/tema.ts`). Each section page
shows its data date and a "data mungkin basi" badge when the data is older than
expected at the time it is viewed. The check counts weekdays only, so a badge
can show on an exchange holiday.

- **`/idx/` Rencana hari ini:** every IDX ticker that passed the gate, with buy
  price, lots, cut loss, and target (`src/rencana/rencana.ts`), plus a plain-language
  risk label (`src/rencana/catatan.ts`). Capital defaults to Rp100 juta. The
  visitor can change it, and the value is stored in their browser only. The full
  screener table is in a collapsed section below.
- **`/hasil/` Hasil simulasi:** IDX picks are judged as a Buy limit placed the
  morning after the scan (`judgeIdx` in `src/hasil/nilai.ts`). It shows the
  Rp100 juta simulation and the pass rule: 30 finished trades, mean return after
  fees above zero (`src/rencana/simulasi.ts`). Results are split into clean,
  caution, and unlabeled picks. Crypto keeps the old percent-based judging.

## Private journal (`/jurnal/`)

The only dynamic part of the site. The page is static; the owner's own trades
live behind `/api/jurnal`, a Vercel Function that `rakit.sh` copies from
`src/jurnal/api.ts` into `situs/api/jurnal.ts`. It has no dependencies, so the
deploy still runs without an install step. Entries are stored in Upstash Redis
(one hash, one field per entry). The page compares each entry with its plan and
with the `/hasil/` simulation, read from `hasil/hasil.json`.

Access is a single secret, `JURNAL_KUNCI`. Signing in sets an HttpOnly,
`SameSite=Strict` cookie that holds an HMAC of the secret and lasts 180 days.
Changing the secret signs every device out.

One-time setup:

```bash
# Upstash for Redis in sin1 (functions run there too, see "regions" in rakit.sh).
# Eviction off, so entries are never dropped; auto-upgrade off, so the free plan never bills.
vercel integration add upstash/upstash-kv --plan free -n jurnal -e production --no-env-pull \
  -m primaryRegion=sin1 -m eviction=false -m autoUpgrade=false -m prodPack=false
K="$(openssl rand -base64 33 | tr -d '\n')"
printf %s "$K" | vercel env add JURNAL_KUNCI production --sensitive
security add-generic-password -U -a "$USER" -s "analisa-saham JURNAL_KUNCI" -w "$K"
```

Then rerun the "Terbit harian" workflow (or wait for the next scheduled run).
The secret cannot be read back from Vercel. Get it from the Keychain with
`security find-generic-password -s "analisa-saham JURNAL_KUNCI" -w`, and keep a
copy in a password manager for the phone.
