# Jurnal Stockbit implementation plan

> Execute inline using superpowers:executing-plans and test-driven-development; request one final independent review.

**Goal:** Jurnal reads the owner's Stockbit Virtual and Real portfolio and orders on the server, usable from a phone while the laptop is off. Virtual/Real balances, positions, orders, sessions and status stay separate.
**Architecture:** Keep Google owner authentication and existing manual records. A separate Stockbit module reads only fixed virtual endpoints, caches a normalized snapshot, and serializes refresh-token rotation using Redis. Credentials are AES-GCM sealed server-side, never part of browser responses, git, or build output.
**Tech stack:** Existing TypeScript/Bun, Node crypto, Vercel Functions and Redis REST.
**Spec:** User-approved conversation: portfolio and orders come from Stockbit Virtual, private per user; existing Google login and manual data remain intact.

## Constraints and review focus
- This release connects the current owner's account; public multiuser registration requires separate Stockbit credentials per user and is not enabled by this connection.
- No trading/order mutation routes. No passwords or PINs in journal UI.
- Failed or malformed upstream responses retain the previous snapshot with a visible warning and original sync timestamp.
- Refresh rotation is locked; persist rotated credentials before subsequent portfolio/order requests; do not retry ambiguous refresh POSTs.
- An open/rejected order is never presented as a filled trade. A holding is not a complete transaction history.

## Task 1: Server sync
Files: `src/jurnal/stockbit.ts`, `stockbit.test.ts`, `api.ts`.
- [x] Write failing tests for normalized portfolio/orders, cache hits, expired-token rotation, concurrent refresh lock, malformed upstream preservation, and absence of secrets in results.
- [x] Implement `sinkronStockbit(redis, secret, fetcher)` returning `{snapshot, warning}`; fixed origins/routes; eight-second network timeout per request; sixty-second snapshot cache. Separate authenticated data with `jenis=virtual|real`.
- [x] Expose an authenticated `GET /api/jurnal?aksi=stockbit` using the existing owner restriction and no-store response.

## Task 2: Journal UI
Files: `src/output/jurnal-template.html`, existing output tests.
- [x] Test real template script renders Stockbit positions, order statuses, cache warning and sync timestamp without treating manual entries as the portfolio. Account switch and logout clear account-specific display.
- [x] Make portfolio primary, retain manual entries in a clearly labeled optional section, add refresh action, display fees and order-price semantics correctly. Latest site plan is explicitly a comparator, not an inferred purchase link.

## Task 3: Connection and release
Files: `scripts/hubungkan-stockbit.ts`, `docs/terbit-vercel.md`.
- [ ] Connect a dedicated cloud Stockbit login, seal credentials in Redis without logging them; preserve the laptop MCP credential.
- [ ] Run full tests, typecheck, bundle smoke check and independent review.
- [ ] Publish through existing main → Terbit harian → site flow, verify authenticated browser portfolio and orders and unauthenticated 401.
- [ ] Verify cloud refresh/GET from Vercel; if the upstream blocks datacenter access, report the concrete blocker without presenting cached data as live.

## Verification notes
- Local Safari fixture: Virtual holdings visible; switching to disconnected Real removes Virtual balance and positions. Fixture uses DEMO data, never production assets.
- Independent reviewer found an HTTP-200 application-error handling issue; added failing regression, then rejection guard. Structural Real refresh parsing tested with separate bearer/body and persistence before reads.
- Live Real login/renewal remains unverified: no securities session stored. Dedicated cloud login window opened; waiting for the owner to complete login.
