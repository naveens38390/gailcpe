# Release readiness — Phase 1 location fallback

*2026-09-25. For the owner and reviewer. Decisions: [0009](../../ai/decisions/0009-hpl-territory-read-from-table-cells.md), [0010](../../ai/decisions/0010-ex-works-nearest-location-fallback.md). Business reference: `docs/client-review/` (both workbooks, client-approved).*

## 1. What is deployable now

One release line, branch `location-fallback/pr4-release-verification-docs`, on top of `origin/main` (`c88cb792`, the ex-depot release). Not pushed.

| PR | Commit(s) | What |
|---|---|---|
| PR0 | `7c797c29` | HPL Annexure V read from table cells (R19) |
| PR1 | `1ab4e9cd`, `5d7b54b9` | Bilaspur state guard (R20); approved fallback table (1,016 + 60 retained), merged by the ETL |
| PR2 | `11773562`, `feb7d376` | Engine `locationMatch`, API payload, schema, kill-switch, M0/M1 loaders; reproduces the approved workbook exactly |
| PR3 | `48881377` | Compare card shows the classification |
| PR4 | this commit | `verify-release` fallback stages, `load-depot` safeguard, repo-relative tooling, round manifest path, release docs, committed workbooks and design package |

**Verified before release (all local, never Atlas or production):**

| Check | Result |
|---|---|
| Typecheck (API, app) | clean |
| Jest: unit, loader rehearsal, workbook integration | 30 / 30 |
| Approved workbook vs data (offline, fresh seed, M1 path) | 1,565 / 1,565 cells |
| **Full release rehearsal from the depot release's data** | depot post-load PASS → M0 (46 REPLACE, 2 CLEAR) → pre-fallback PASS → M1 (698 ADD, 213 RELABEL, 68 REPLACE, 97 META, 2 REMOVE) → **database matches all 1,565 workbook cells** → post-fallback + Deal PASS (61) |
| Kill-switch (L1) through the API | 35 inferred/retained quotes → unpriced; every exact and territory quote unchanged |
| Data rollback (L2) | database byte-identical to the pre-release state; depot post-load PASS |
| Browser (PR3) | 8 cases incl. 390 px and a pre-0010 API response |

Not verified: an Android device, the web build on Vercel, anything against production.

## 2. What is intentionally excluded from Phase 1

| Excluded | Why / where it stands |
|---|---|
| Freight fallback | Not approved (Phase 2 at the earliest). HMEL/HPL/OPaL quotes whose town has no freight rate stay "not compared" — the card says why |
| Ex-Depot fallback | Not approved (decision 0007). Verified: no depot quote uses a fallback |
| The 3 Beawar candidates as fresh approvals | Pending. IOCL/RIL/OPaL Beawar show only as Retained Existing Mapping (Jodhpur, today's value) |
| 188 held rows, 23 no-replacement rows | Not in Phase 1; they read "no published price" (the workbook's 155 No Approved Mapping cells) |
| The 2 Latur mappings (IOCL, HMEL) | Removed (option 3) |
| 17 R19 freight-destination corrections | **Not loaded** — see risk 1 |

## 3. Exact deployment order

1. **Ex-depot release first, complete** — its own runbook, `load-depot` **from `c88cb792`**, `verify-release --stage post-load --with-deal` PASS. *(Its production status is not visible from git — owner confirms.)*
2. Push this release line to `main`; Render deploys the API (`LOCATION_FALLBACK=true`).
3. `verify-release --stage post-load` — PASS.
4. `fix-hpl-territory` dry run → review → `--apply` → restart API.
5. `verify-release --stage pre-fallback` — PASS.
6. `load-equivalence` dry run → gates (1,078; only the 2 Latur REMOVE; all 60 retained RELABEL; 0 conflicts) → `--apply` → restart API.
7. `verify-release --stage post-fallback --with-deal` — PASS.
8. Web app (Vercel), then APK — **version above 0.2.6 / code 8**, which the depot release already built.
9. `docs/post-release-checklist.md` on the real app; monitor.

Steps 4–7 in one window. Full commands and expected outputs: [`12-deployment-checklist.md`](12-deployment-checklist.md).

## 4. Rollback procedure

Fastest first; **undo data before code**. Detail: [`docs/rollback-runbook.md`](../rollback-runbook.md) §7–9.

| Layer | When | Action | Effect (rehearsed) |
|---|---|---|---|
| L1 kill-switch | any doubt about a fallback price | `LOCATION_FALLBACK=false` in Render, restart | every Inferred / Retained quote reads "no published price"; exact and territory unchanged |
| L2 data | a wrong mapping is live | `load-equivalence -- --rollback <m1 manifest>`, then `fix-hpl-territory -- --rollback <m0 manifest>`, restart | database returns exactly to its pre-release state (compare-and-set: hand edits since are left alone) |
| L3 code | engine/UI defect | redeploy the previous build after L2 (or with L1 on) | — |

The before-image manifests (Part 2 of the checklist) are the L2 mechanism: keep them off the server for the whole monitoring period.

## 5. Remaining known risks

| # | Risk | Status |
|---|---|---|
| 1 | **17 R19 freight-destination corrections are not loaded.** The corrected Annexure V changes which freight destination 17 producer/town pairs bill through; M0/M1 write only zones. Production keeps today's (misread) freight for: GAIL Bhubaneswar; HMEL Bhubaneswar, Ghazipur, Neemuch; HPL Bhubaneswar, Cuttack, Fazilka, Ghazipur, Lucknow, Meerut, Muzaffarnagar, Sambalpur; OPaL Fazilka, Ghazipur, Kheda, Lucknow, Sambalpur. Not a regression (it is production today). | **Decision needed:** extend M0 to `freightDestination` (a migration change) or accept for now |
| 2 | **Freight lookup is order-dependent where two destinations share a name** (`freightFor` takes the first). Observed in the rehearsal: HMEL Bilaspur billed at Himachal's ₹1,320 instead of Chhattisgarh's ₹4,560 (₹3,240 understated); HPL Kalol ₹10. Pre-existing, likely in production today (PENDING VALIDATION). | Decision needed (engine fix, out of this release's scope) |
| 3 | HMEL's **exact** Bilaspur zone is its Himachal Pradesh Bilaspur — the R20 name collision through an exact match, which the state guard (published map only) does not cover. Pre-existing. | Owner review |
| 4 | Production may differ from `c88cb792`'s data (hand edits, older load). | Dry runs gate it; conflicts are skipped, not forced; post-fallback checks the end state against the workbook |
| 5 | Atlas free tier (512 MB) near full; snapshots unknown. | Owner confirms headroom first (additions are small) |
| 6 | No automated app tests; Compare verified by hand in a browser. | Follow-up |
| 7 | Launch configs in `D:\Gail2\.claude\launch.json`: `gcpe-api-local` connects to **production** (reads `backend/api/.env`); `gcpe-web` points the app at the production API (every comparison is stored there). | **Recommend** removing both or renaming them `…-PRODUCTION`; use `gcpe-mongo-verify` + `gcpe-api-verify` + `gcpe-web-local` for local work |
| 8 | A parallel session sharing this working directory committed onto these branches twice. | Check `git log origin/main..HEAD` before pushing; that session should use its own `git worktree` |
| 9 | The fallback table is frozen to the 2026-09-01 round's zones; next round the ETL gate stops on any dropped zone, and re-deriving needs the analysis pipeline (session scratchpad, not the repo). | Plan before the next round |
| 10 | `ai/` knowledge layer and root `CLAUDE.md` are not tracked in git. | Owner decides whether to commit them |
