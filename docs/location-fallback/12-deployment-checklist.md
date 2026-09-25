# Deployment checklist — Phase 1 (HPL fix + Bilaspur guard + Ex-Works fallback)

**Status (2026-09-25): ready for execution, not executed.** PR0–PR3 approved; PR4 (this) in review. Every step below was **rehearsed end to end on a local MongoDB** (never Atlas) starting from the depot release's own data (`c88cb792`) — the state production should be in after the ex-depot release — with the real scripts, the real API and `verify-release`. The expected output quoted at each step is from that rehearsal. Nothing has touched production.

Decisions this follows: [0009](../../ai/decisions/0009-hpl-territory-read-from-table-cells.md), [0010](../../ai/decisions/0010-ex-works-nearest-location-fallback.md). Business reference: the two client-approved workbooks in `docs/client-review/`. Rollback: [`docs/rollback-runbook.md`](../rollback-runbook.md) §7–9.

**M0 and M1 run in one continuous window** (decided 2026-09-22): between them, HPL Bilaspur honestly reads "not published".

---

## Part 0 — Preconditions (owner)

- [ ] **The ex-depot release is complete in production** — pushed, API deployed, `load-depot --apply` run **from the depot release commit `c88cb792`**, `verify-release --stage post-load --with-deal` PASSED. *(Status PENDING VALIDATION: `origin/main` is `c88cb792`; whether Render is serving it and whether depot data is loaded is not visible from git.)*
- [ ] **Never run `load-depot` from this release's commit.** Its data carries 699 fallback zones. Since PR4 `load-depot` refuses to write them (it reports "699 works zone(s) from the approved fallback table left for load-equivalence (M1)"), but the rule stands: depot data is loaded from the depot release.
- [ ] Atlas headroom confirmed (512 MB tier, R17); whether snapshots exist is known.
- [ ] The **production API URI is only ever passed explicitly** (`MONGODB_URI=… npm run …`). `backend/api/.env` holds it — do not rely on it, and never run the local `gcpe-api-local` launch config (it uses `.env`).
- [ ] A **clean clone of the release commit** (PR4 tip) exists, `git status --short` prints nothing, `npm ci` done in `backend/api`. Every command below runs from `backend/api` in that clone.
- [ ] The APK/web version plan is decided: the depot release already built **0.2.6 / versionCode 8** (from a commit not on `main`); this release's app needs a higher version.

## Part 1 — Pre-deployment validation (from the clean clone)

```bash
npx tsc --noEmit                                        # clean
npm test                                                # 30 pass (M1-path tests skip without GCPE_POST_M0_DATA)
npm run verify-workbook                                 # "MATCHES THE APPROVED WORKBOOK", 1,565 cells
cd ../etl && py break_test.py && py equivalence_build.py && cd ../api   # probes OK, PASS
```
- [ ] `node ai/tools/check-docs.mjs` — 0 errors *(the `ai/` layer is not in git; run it where `ai/` exists)*.

## Part 2 — Backup

- [ ] Each migration's `--apply` writes its **before-image manifest** (every touched Location's zone, tier, meta, depot and freight fields, SHA-256) to `backend/migrations/` (or `GCPE_MIGRATIONS_DIR`) **before** writing, and refuses to apply if it cannot. Copy both files off the deployment machine immediately; they are the L2 rollback.

## Part 3 — Execution (each step is a gate)

| # | Action | Expected (rehearsal) |
|---|---|---|
| 1 | Deploy the API from the release commit, **`LOCATION_FALLBACK=true`** (in `render.yaml`). Wait for `/api/health`. | — |
| 2 | `API_URL=https://gcpe-api.onrender.com/api VERIFY_EMAIL=… VERIFY_PASSWORD=… npm run verify-release -- --stage post-load` | PASS (the fallback-aware API on the depot data, no location data changed yet). The Location fallback section does not run at this stage. |
| 3 | `MONGODB_URI=<prod> npm run fix-hpl-territory` (**M0 dry run**). Review every line. | `REPLACE 46, CLEAR 2, NOOP 578` — HPL only, works + depot; CLEAR = Bilaspur works + depot. **Any conflict: stop** (a hand correction exists). |
| 4 | `MONGODB_URI=<prod> npm run fix-hpl-territory -- --apply` · restart the API | `applied 48, 0 conflict(s)` · `read-back: PASS` · before-image path printed |
| 5 | `npm run verify-release -- --stage pre-fallback` (same env as step 2) | PASS: every quote carries `locationMatch`; no fallback tier served; HPL Bilaspur unresolved |
| 6 | `MONGODB_URI=<prod> npm run load-equivalence` (**M1 dry run**) | `ADD 698, RELABEL 213, REPLACE 68, META 97, REMOVE 2` = 1,078. **Gates:** total 1,078; REMOVE exactly `IOCL LATUR`, `HMEL LATUR`; **all 60 retained rows RELABEL** (same zone as today); 0 conflicts. The ADD/RELABEL/REPLACE split can differ if production differs from `c88cb792`'s data — the end state cannot (step 8). |
| 7 | `MONGODB_URI=<prod> npm run load-equivalence -- --apply` · restart the API | `applied 1078, 0 conflict(s)` · `read-back: PASS` |
| 8 | `npm run verify-release -- --stage post-fallback --with-deal` | PASS: 12 towns × 5 competitors match the approved workbook; Bilaspur = Territory Match (Chattisgarh); Latur IOCL/HMEL removed; Beawar only as Retained Existing Mapping; Ex Depot has no fallback |
| 9 | Web app (Vercel) and APK from the release commit, version bumped (Part 0) | — |

If anything fails at steps 3–8: `docs/rollback-runbook.md` §7–9. **Do not leave M0 applied without M1** for longer than it takes to decide.

## Part 4 — Post-deployment validation

- [ ] `docs/post-release-checklist.md`, section "Location fallback" — on the real app.
- [ ] Monitor the first day's comparisons for inferred quotes; keep the kill-switch ready.

## Part 5 — Rollback (summary; detail in the runbook)

| Layer | Action | Rehearsed |
|---|---|---|
| **L1 kill-switch** | `LOCATION_FALLBACK=false` in Render, restart | 35 inferred/retained quotes → unpriced, every exact/territory quote unchanged |
| **L2 data** | `load-equivalence -- --rollback <m1 manifest>`, then `fix-hpl-territory -- --rollback <m0 manifest>`, restart | restored 1,078 + 48; database byte-identical to before M0; depot `post-load` PASS |
| **L3 code** | redeploy the previous API build **after** L2 (or with L1 on) | — |

## Known, not fixed by this release (decide before or after)

- **17 R19 freight-destination corrections are in the data but not loaded** — no migration writes `freightDestination`. Production keeps the misread-Annexure freight destination for those producer/town pairs (listed in `14-release-readiness.md`).
- **HMEL Bilaspur and HPL Kalol freight is order-dependent** in production (two destinations share a name); pre-existing.
