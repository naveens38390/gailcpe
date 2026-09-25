# Rollback runbook — Ex Works / Ex Depot release

*One page, meant to be followed under pressure. Each step names what could fail, how to see it, and exactly what to run.*

This release adds a second price list (Ex Depot) on top of the existing Ex Works system. Every rollback
below either reverts a deploy (nothing written yet) or removes only what this feature added, never
anything that existed before it.

---

## 1. Push A fails, or Render won't build

**Nothing has changed in production yet.** Push A only fast-forwards the `main` branch; Render redeploys
from it.

- **Roll back:** in the Render dashboard, redeploy the previous build (or `git push --force-with-lease
  origin <previous-sha>:main` if you must move the branch pointer — prefer the dashboard).
- No database action needed.

## 2. Render deploys, but `/api/health` or `verify-release --stage pre-load` fails

The new API is live but something is wrong with it — still **no depot data exists**, so this is a pure
code rollback.

- **Detect:** `verify-release --stage pre-load` fails, or `/api/health` doesn't return `{"status":"ok"}`.
- **Roll back:** redeploy the previous Render build, same as step 1.
- No database action needed — nothing has been loaded.

## 3. `load-depot --apply` fails partway, or writes the wrong thing

This is the step with actual data risk. `load-depot.ts` is idempotent (a second `--apply` reports
"already loaded, unchanged" for anything already correct), so a **partial** failure is not an emergency —
running it again finishes the job. Use the rollback below only if the loaded data itself needs to come
back out (wrong source file, wrong environment, a client-confirmed error in the circulars).

- **Detect:** `verify-release --stage post-load` fails, or the Bhiwandi Ex Depot figures in
  `docs/release-checklist.md` don't match.
- **Roll back:**
  ```bash
  cd backend/api
  MONGODB_URI=<production URI> npm run rollback-depot            # dry run — read what it would undo
  MONGODB_URI=<production URI> npm run rollback-depot -- --apply # writes
  ```
  This removes every `ex_depot` price entry for the round, clears the depot zone maps it added, clears
  the depot cash-discount rate, and reverts the one works-zone fill (HPL at Bhiwandi) **only if it still
  exactly matches what the loader wrote** — an admin correction made since is never touched. Verified
  2026-09-22: reproduces the exact pre-load database, byte for byte, in rehearsal.
  Restart the API afterwards (see step 5).
- **Known limitation:** if the depot data being rolled back was loaded by `npm run seed` rather than
  `load-depot.ts`, or predates this rollback tool, there is no fill record to revert — the script will
  still remove the price data, depot maps and discount rate, but will not know which works-zone fields
  (if any) were filled by a load versus always present. Check `docs/release-checklist.md`'s Bhiwandi/HPL
  note by hand in that case.
- **Never** run `npm run seed` as a rollback. It replaces master data outright, discarding any hand
  correction an admin has made (R4).

## 4. API restart doesn't pick up the change

The dataset is cached in memory per round.

- **Detect:** Ex Depot still reads "Not published" everywhere right after a successful `--apply`.
- **Fix, not a rollback:** restart the API process again. No data risk either way.

## 5. Push B fails, or the web app breaks

By this point the backend is confirmed working; Push B only affects the web app (Vercel) and the docs.

- **Roll back:** redeploy the previous Vercel build. The API and data are untouched.

## 6. A bad APK gets built or distributed

- **Roll back:** simply don't distribute it; rebuild with the correct version bump
  (`frontend/app.json`: `version` and `versionCode`). Existing devices on the prior build (0.2.5) keep
  working against the new API — verified compatible, since the app only sends `pricingBasis` /
  `basisOverrides` when they differ from the default (deploy-safe requests).

---

# Location fallback release (decision 0010)

*Checklist: `docs/location-fallback/12-deployment-checklist.md`. Every step below was rehearsed on a
local MongoDB from the depot release's data, 2026-09-25.* **Undo data before code**: an older API
reading the new tier strings would show no caveat on an inferred price.

## 7. Any doubt about a fallback price (L1, fastest)

- **Detect:** a Compare card shows an Inferred Location Match / Retained Existing Mapping that looks
  wrong, or `verify-release --stage post-fallback` fails on the workbook check.
- **Act:** set `LOCATION_FALLBACK=false` on the Render service, restart. Every Inferred / Retained
  quote then reads "no published price"; exact and Territory Match quotes are unchanged (rehearsed:
  35 cleared, all others identical). No data changes, fully reversible. Nothing is lost.

## 8. A wrong mapping is live, or M0/M1 wrote the wrong thing (L2)

- **Roll back M1, then M0**, each from the before-image manifest its `--apply` printed:
  ```bash
  cd backend/api
  MONGODB_URI=<production URI> npm run load-equivalence -- --rollback <m1-….json>
  MONGODB_URI=<production URI> npm run fix-hpl-territory -- --rollback <m0-….json>
  ```
  Each restores a field only where its value is still what the migration wrote; a value an admin has
  changed since is reported and left alone. Rehearsed: restored 1,078 then 48, database byte-identical
  to before M0. Restart the API. Re-run `verify-release --stage post-load`.
- M0 alone applied, M1 failed: HPL Bilaspur reads "not published" (an honest gap, not a wrong price) —
  finish M1 or roll back M0; do not leave it for days.
- **Never** re-run `npm run seed` as a rollback (R4), and never run `load-depot` from this release's
  commit.

## 9. Engine or app defect (L3)

- Redeploy the previous API build **after** step 8 (or with step 7 on). The app degrades safely against
  an older API: the Compare card falls back to the tier and still shows a caveat for an inferred quote.
- A bad APK: don't distribute it; rebuild above 0.2.6 / code 8.

---

## After any rollback

1. Re-run `verify-release --stage pre-load` (if you rolled back to before the load) or
   `--stage post-load --with-deal` (if depot data is still meant to be live) against production.
2. Look at Compare and Deal yourself — a passing script is not a substitute.
3. Tell the client if the rollback affects anything they could have already seen (e.g. a since-corrected
   HPL Bhiwandi price).
