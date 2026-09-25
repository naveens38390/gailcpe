# Technical inventory — exact files, collections, APIs, screens affected

**As built (2026-09-25):** differences from this pre-coding inventory: `fix-hpl-territory.ts` is a **new** file (listed below as modified — it did not exist); also new: `backend/api/jest.config.js`, `database/migrations.rehearsal.spec.ts`, `database/workbook-harness.ts`, `database/workbook.{seed,m1}.integration.spec.ts`, `tools/workbook-verify.ts`; PR4 also changed `database/load-depot.ts` (refuses to write a fallback zone), `backend/etl/rounds/2026-09-01.json` (source path), `tools/equivalence-verify.ts` (repo-relative defaults) and the tracked release docs. `backend/etl/equivalence.py` changed again in PR2 (provenance for all 1,076 rows). The original inventory follows.

This is the complete, verified inventory behind `10-implementation-work-breakdown.md`'s four PRs. Every item was confirmed by reading the current code (OBSERVED) or computed from the current data (VERIFIED); nothing here is inferred.

---

## 1. Files

### New files

| File | PR |
|---|---|
| `backend/etl/reference/gail_location_state.json` | PR1 |
| `backend/etl/reference/gail_location_state_reasons.json` | PR1 |
| `backend/etl/reference/location_equivalence.json` | PR1 |
| `backend/etl/reference/location_equivalence.review.json` | PR1 |
| `backend/etl/reference/geodata.json` | PR1 |
| `backend/etl/equivalence_build.py` | PR1 |
| `backend/etl/equivalence.py` | PR1 |
| `backend/api/src/core/location-match.ts` (+ `.spec.ts` if Jest approved) | PR2 |
| `backend/api/src/database/migration-lib.ts` | PR2 |
| `backend/api/src/database/load-equivalence.ts` | PR2 |
| `backend/api/src/tools/equivalence-verify.ts` | PR2 |

### Modified files

| File | PR | Change |
|---|---|---|
| `backend/etl/locations.py` | PR1 | State guard on `Resolver.add_district_map` / `resolve_detailed` |
| `backend/etl/build.py` | PR1 | Merge fallback table; remove `add_cluster_hubs` from works resolvers |
| `backend/etl/break_test.py` | PR1 | Bilaspur probe, fallback-gate negative probes |
| `backend/data/normalized/price_index.json` | PR1 | Regenerated |
| `backend/data/normalized/locations.json` | PR1 | Regenerated |
| `backend/data/normalized/prices.json` | PR1 | Regenerated |
| `backend/data/normalized/build_report.json` | PR1 | Regenerated |
| `backend/api/src/core/types.ts` | PR2 | `LocationTier` union, `Quote.locationMatch` |
| `backend/api/src/core/pricing.ts` | PR2 | Attach `locationMatch`; kill-switch; ex-depot guard; warning text |
| `backend/api/src/core/deal.ts` | PR2 | `dataConfidence` keyed off tier group |
| `backend/api/src/modules/dataset/dataset.service.ts` | PR2 | Expose `location_meta` |
| `backend/api/src/database/schemas/catalog.schema.ts` | PR2 | `LocationTier` union, `producerZoneMeta` on `Location` |
| `backend/api/src/database/seed.ts` | PR2 | Write `producerZoneMeta` |
| `backend/api/src/database/fix-hpl-territory.ts` | PR2 | Add the CLEAR operation type (Bilaspur) |
| `render.yaml` | PR2 | `LOCATION_FALLBACK=true` |
| `backend/api/src/tools/verify-release.ts` | PR4 | `--stage pre-fallback` / `post-fallback` |
| `frontend/src/services/api.ts` | PR3 | `LocationTier` union, `Quote.locationMatch?` |
| `frontend/src/theme.ts` | PR3 | Three group labels |
| `frontend/src/app/(tabs)/index.tsx` | PR3 | Compare card rendering per tier |
| `ai/modules/location-management.md`, `ai/modules/etl-pipeline.md` | PR4 | Module docs |
| new `ai/features/location-fallback.md` | PR4 | Feature doc |
| `ai/business-rules.md` | PR4 | Rule 2 amended |
| `ai/risks.md` | PR4 | R19, R20 closed |
| `ai/decisions/0010-ex-works-nearest-location-fallback.md` | PR4 | Marked implemented |
| `ai/changelog.md` | PR4 | Entry |
| `ai/dependencies/*.json` | PR4 | Regenerated (`node ai/tools/build-maps.mjs`) |

### Explicitly not touched

`core/types.ts` other exports, `modules/pricing/pricing.controller.ts`, `modules/deals/deals.controller.ts` (no route signature changes — see Section 3), `frontend/src/app/(tabs)/deal.tsx`, every Ex-Depot code path, `modules/corrections/*` (Price Corrections), `modules/exports/*` (Excel/PDF circular exports), `backend/etl/depot.py` and every other depot ETL file.

## 2. Database collections

| Collection | Touched? | How |
|---|---|---|
| `locations` | **Yes** | `producerZone`, `producerZoneTier` gain new values (ADD/RELABEL/REPLACE/REMOVE per the manifest); new optional `producerZoneMeta` field |
| `auditLogs` | **Yes** | One entry per migration run (`migration.m0`, `migration.m1`), free-form `detail` with counts and the before-image manifest hash |
| `comparisonHistory` | **Read only, going forward it stores `locationMatch` too** | Existing records are never migrated (stored "as served"); new records after PR2 deploys will carry the new field |
| `dealSimulations` | Same as `comparisonHistory` | Same |
| `producers`, `grades`, `gradeMappings`, `discountSchemes`, `priceCirculars`, `priceEntries`, `freightCirculars`, `freightEntries`, `discountTerms`, `priceCorrections`, `users`, `roles`, `depotLoadAudits`, `circularDocuments`, `notifications`, `*Drafts`, `*DraftRows` | **No** | Not referenced by any file in Section 1 |

No new collection is created. `Location` is the only schema that gains a field.

## 3. APIs

| Route | Method | Touched? | How |
|---|---|---|---|
| `/pricing/compare` | POST | **Payload changes** | Each `Quote` gains an optional `locationMatch`; `warnings` text changes for inferred quotes. Route path, request shape, response envelope: unchanged. |
| `/deals/simulate` | POST | **Payload changes** | Same, via the same `Quote` type; `dataCaveats` wording changes for inferred quotes. |
| `/pricing/history` | GET | **Payload changes, going forward** | Returns stored `Comparison` records; new records (after deploy) carry `locationMatch`, old ones don't. Not consumed by the app (Section 4). |
| `/deals/history` | GET | Same as above | Same. Not consumed by the app. |
| `/pricing/grade-options` | GET | **Behaviour changes, no payload change** | Reads `location_map` directly (`equivalentOptions` in `core/pricing.ts`); a town that gains a zone via the fallback will show that grade as available where it didn't before. The response shape is unchanged — no `LocationTier` or tier field is in its output today (VERIFIED). |
| `/pricing/gail-book` | GET | No | GAIL's own price grid; no competitor zone resolution involved |
| `/deals/:id/outcome` | POST | No | Deal outcome tracking; unrelated |
| Every other route (111 total, per the repo's generated `api-map.json`) | — | No | Not referenced by any Section 1 file |

No route is added, removed, or renamed.

## 4. UI screens

| Screen | File | Touched? | How |
|---|---|---|---|
| Compare | `frontend/src/app/(tabs)/index.tsx` | **Yes** | New rendering for the three match tiers on each competitor card; a distinct message for an inferred quote with no landed price |
| Deal | `frontend/src/app/(tabs)/deal.tsx` | **No** | Already renders `dataCaveats` and the confidence pill generically from the API; no code change needed |
| Any comparison/deal **history** view | — | **Does not exist** | `GET /pricing/history` and `GET /deals/history` are not called by any screen in the app today (VERIFIED by search). There is nothing to update here — this corrects an earlier, inaccurate line in the coding plan that assumed a history screen existed. |
| Admin screens (locations, producers, grades, discounts, price/freight circulars, users, timeline) | `frontend/src/app/admin/*` | No | None reference `LocationTier` or `locationMatch` (VERIFIED by search) |

Two screens touched in total, one of which needs no code change.
