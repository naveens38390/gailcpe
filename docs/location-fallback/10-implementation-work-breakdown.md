# Final implementation work breakdown — PR1 to PR4

**No code has been written.** This consolidates the 15-item plan in [`08-coding-plan.md`](08-coding-plan.md) into exactly four pull requests, per the client-approved scope. `08-coding-plan.md` remains the file-by-file detail; this document is the PR-level plan for review.

**Prerequisite (PR0, not part of this package, already approved separately):** the HPL Annexure V table-cell fix (decision 0009) is fully coded and verified but still uncommitted in the working tree (`backend/etl/extractors/haldia.py`, `build.py`, `break_test.py`, and five regenerated `backend/data/normalized/*.json` files). It must be committed before PR1 starts, because PR1 edits the same two Python files. This is separate governance (already approved 2026-09-21) — flagged here only because it blocks the branch point.

---

## PR1 — ETL and reference data (Python, offline)

**What:** everything that changes what the normalised dataset contains. No database, no API, no app.

| Item | File |
|---|---|
| Bilaspur state table | new `backend/etl/reference/gail_location_state.json` (+ `_reasons.json`) |
| Bilaspur guard | `backend/etl/locations.py` (`Resolver.add_district_map`, `resolve_detailed`) |
| Bilaspur negative probe | `backend/etl/break_test.py` |
| Fallback reference tables | new `backend/etl/reference/location_equivalence.json`, `location_equivalence.review.json`, `geodata.json` |
| Fallback builder | new `backend/etl/equivalence_build.py` |
| Fallback loader/validator | new `backend/etl/equivalence.py` |
| ETL merge | `backend/etl/build.py` (merge approved rows; remove `add_cluster_hubs` from the works resolvers only; emit `location_meta`) |
| Fallback negative probes | `backend/etl/break_test.py` |
| Regenerated data | `backend/data/normalized/{price_index,locations,prices,build_report}.json` (`freight.json`, `drift_report.json` unchanged by this PR) |

**Depends on:** PR0 (commit first).
**Testing:** T1 (gates fire on each negative case; a clean rebuild is reproducible), T2 (prices and every exact/alias/evidence mapping byte-identical before/after). Run twice, diff both times, confirm 0.00% price movement.
**Reviewable alone:** yes — a Python/data-only diff; the regenerated JSON is the evidence.

## PR2 — Backend: engine, API payload, schema, loaders

**What:** everything in the NestJS API. Depends on PR1's data shape.

| Item | File |
|---|---|
| Tier helpers | new `backend/api/src/core/location-match.ts` (+ `.spec.ts` if Jest is approved, decision pending) |
| Tier union, Quote field | `core/types.ts` |
| Attach `locationMatch`, kill-switch, ex-depot guard | `core/pricing.ts` |
| Deal confidence keyed off tier group | `core/deal.ts` |
| Expose `location_meta` | `modules/dataset/dataset.service.ts` |
| Schema | `database/schemas/catalog.schema.ts` (`LocationTier` union, `producerZoneMeta`), `database/seed.ts` |
| Kill-switch env | `render.yaml` (`LOCATION_FALLBACK=true`) |
| Shared loader library | new `database/migration-lib.ts` (compare-and-set, before-image, audit entry, read-back, `--verify`/`--rollback`) |
| M0 extended (Bilaspur clear) | `database/fix-hpl-territory.ts` |
| M1 loader | new `database/load-equivalence.ts` |
| Offline verifier | new `backend/api/src/tools/equivalence-verify.ts` |

**Depends on:** PR1.
**Testing:** T3 (`equivalence-verify.ts` — exact/alias/evidence/published/depot quotes unchanged; changed quotes match the manifest exactly; kill-switch collapses the inferred set), T4 (unit tests, if approved), T5 (loader rehearsal on an in-memory MongoDB: dry run, apply, read-back, rollback, idempotency, hand-edit-is-a-conflict).
**Reviewable alone:** yes, against PR1's fixtures; no live database is touched by review.

## PR3 — Frontend (app)

**What:** presentation only. Depends on PR2's payload shape.

| Item | File |
|---|---|
| Tier union, `Quote.locationMatch?`, legacy-tier fallback | `frontend/src/services/api.ts` |
| Three group labels | `frontend/src/theme.ts` |
| Compare card: Exact/Territory/Inferred rendering, incomplete-inferred message | `frontend/src/app/(tabs)/index.tsx` |

**Correction from the coding plan:** `GET /pricing/history` and `GET /deals/history` (which would return a stored `Comparison`/`DealSimulation` with an old, legacy `locationTier` string) are **not consumed anywhere in the app today** (VERIFIED: no screen calls either route). There is no frontend "history screen" to update. Tolerating a legacy tier string is only a concern for `services/api.ts`'s TypeScript types (optional field, safe default) and for anything that reads the raw API response directly, such as `verify-release.ts` (PR4) — not for any UI rendering.

**Depends on:** PR2 (payload shape). `(tabs)/deal.tsx` needs no change — it already renders `dataCaveats` and the confidence pill from the API.
**Testing:** T6 — Compare on an inferred town, a territory town, an exact town, an incomplete-inferred quote, a cross-state town, 390 px width, an old history record. No console errors.
**Reviewable alone:** yes, against PR2's payload.

## PR4 — Release verification and documentation

**What:** the tooling and paperwork that prove the release is safe, and the repo protocol's required documentation update. No functional code change.

| Item | File |
|---|---|
| Release-stage checks | `backend/api/src/tools/verify-release.ts` — new `--stage pre-fallback` / `post-fallback` |
| Module and feature docs | `ai/modules/location-management.md`, `ai/modules/etl-pipeline.md`, `ai/features/` (new feature doc for the fallback) |
| Business rule amendment | `ai/business-rules.md` rule 2 |
| Risk closure | `ai/risks.md` — R19 and R20 closed |
| Decision record | `ai/decisions/0010-ex-works-nearest-location-fallback.md` marked implemented |
| Changelog | `ai/changelog.md` |
| Generated maps | `ai/dependencies/*.json` (regenerate, do not hand-edit) |
| Doc consistency check | `node ai/tools/check-docs.mjs` |

**Depends on:** PR2 (verify-release needs the engine's shape to write meaningful checks); can be drafted alongside PR3.
**Testing:** T7 is run **live**, after deployment (not before) — `pre-fallback` right after PR2/PR3 deploy with no fallback data loaded, `post-fallback` after the M1 load. This PR ships the tooling; running it is a deployment-checklist step (see `12-deployment-checklist.md`).
**Reviewable alone:** yes — text and a new CLI flag, no runtime behaviour change until invoked.

---

## Dependency chain

```
PR0 (commit the already-approved HPL fix)
   │
   ▼
PR1 (ETL + reference data)
   │
   ▼
PR2 (engine + API + schema + loaders) ──┐
   │                                     │
   ▼                                     ▼
PR3 (app)                          PR4 (verification + docs)
```

PR3 and PR4 can be built and reviewed in parallel once PR2 is merged; neither blocks the other. All four (plus PR0) must be **merged** before any deployment step in `12-deployment-checklist.md` begins — deployment is a separate, later action, not part of any PR.

## Testing requirements, summed up

| Test | What it proves | When it runs |
|---|---|---|
| T1 | ETL gates fire; rebuild is reproducible | PR1, every commit |
| T2 | Prices and exact/alias/evidence mappings unchanged | PR1, every commit |
| T3 | Engine output matches the manifest exactly, exact/depot untouched | PR2, every commit |
| T4 | `tierGroup`/label/warning-text unit tests (if Jest approved) | PR2, every commit |
| T5 | Loader rehearsal: dry run, apply, read-back, rollback, idempotency | PR2, before any real deployment |
| T6 | UI renders each tier and edge case correctly | PR3, every commit |
| T7 | Live pre/post-fallback checks against a real deployment | Deployment checklist, not a PR gate |

There are no automated tests in this repository today beyond what T4 (if approved) adds; T1–T3, T5–T6 are scripted checks run by a person, not CI, exactly as `depot-verify.ts` and `verify-release.ts` already work for the ex-depot release.
