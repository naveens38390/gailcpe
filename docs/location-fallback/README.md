# Competitor-location equivalency map: implementation package

**Status (2026-09-25):** PR0–PR3 approved; PR4 (release verification, docs) in review on `location-fallback/pr4-release-verification-docs`, which stacks all five PRs in one line (not pushed). The full release was rehearsed end to end on a local MongoDB. **No data loaded into any production database; nothing deployed.** Release readiness: [`14-release-readiness.md`](14-release-readiness.md).

## Business reference artifacts (client-approved)

These two workbooks are the approved business reference. Where the implementation and a workbook disagree, the workbook is right and the implementation is the defect.

| Workbook | Approved | What it governs |
|---|---|---|
| [`../client-review/Location_Mapping_Changes_Client_Review.xlsx`](../client-review/Location_Mapping_Changes_Client_Review.xlsx) | 2026-09-22 | *What changes*: the 1,016-row Phase 1 set, the 60 retained mappings, removal of the 2 Latur mappings, option 3 |
| [`../client-review/Competitor_Presence_and_Fallback_Mapping.xlsx`](../client-review/Competitor_Presence_and_Fallback_Mapping.xlsx) | 2026-09-25 | *The resulting behavior per location*: which competitors are directly available at each of the 313 locations, and for every missing competitor the mapped location, distance and mapping type |

The second workbook's classifications are what the engine must reproduce, per competitor per location:

| Workbook classification | Meaning | Rows |
|---|---|---|
| Exact Published Match | competitor directly available: the producer names the town, a known spelling, or a price the zonal workbook proves | 334 |
| Territory Match | HPL's own Annexure V district list, or a producer's whole-state zone | 278 |
| Inferred Location Match | nearest published zone, newly approved | 738 |
| Retained Existing Mapping | one of the 60 retained live mappings (option 3) | 60 |
| No Approved Mapping | missing, no approved fallback (held, candidate, or no reasonable replacement): no price shown | 155 |
| **Total** | 313 locations x 5 competitors | **1,565** |

**Change this makes to decision 0010:** 0010 had three labels and showed retained rows as *Inferred Location Match*. The approved workbook shows them as a fourth classification, *Retained Existing Mapping*. Behavior is unchanged (still an inferred-group match: distance caveat, Deal confidence capped at medium, cleared by the kill-switch); only the label differs.

## Reading order

This is the implementation package for that approved scope — read in order:

0. [`14-release-readiness.md`](14-release-readiness.md) — **start here to release**: what ships, what's excluded, deployment order, rollback, known risks
1. [`09-release-impact-summary.md`](09-release-impact-summary.md) — what changes for officers
2. [`10-implementation-work-breakdown.md`](10-implementation-work-breakdown.md) — PR1 to PR4
3. [`11-technical-inventory.md`](11-technical-inventory.md) — exact files, collections, APIs, screens
4. [`12-deployment-checklist.md`](12-deployment-checklist.md) — validation, backup, migration, rollback
5. [`13-branch-plan.md`](13-branch-plan.md) — branches and coding sequence
6. [`08-coding-plan.md`](08-coding-plan.md) and [`06-implementation-plan.md`](06-implementation-plan.md) — the full file-by-file detail and design these are built from

The package was reviewed and coding authorised (2026-09-22). Coding follows the PR sequence in `13-branch-plan.md`; each PR is reviewed before the next begins.

## 1. Decisions on record

| Approved | Not approved |
|---|---|
| **Client approved the workbook and mapping approach** (2026-09-22): 1,016 approved rows, 60 retained, removal of the 2 Latur rows, option 3 | Freight fallback (Phase 2 at the earliest) |
| Corrections **A1, A2, A3**; the **Bilaspur state guard** | Ex-Depot fallback (decision 0007) |
| HPL Annexure V fix, loaded through a safe loader | Automatic approval of the 3 Beawar candidates (stay pending) |
| Ex-Works fallback, Phase 1 = Mapped + retained rows only; Confirm and Cannot-Determine stay out | Running the production usage query (not needed at this stage) |
| Labels: **Exact Published Match**, **Territory Match**, **Inferred Location Match**, and (added by the second approved workbook, 2026-09-25) **Retained Existing Mapping** for the 60 retained rows | |
| **Client approved the Competitor Presence and Fallback Mapping workbook** (2026-09-25) as the business reference for per-location behavior | |
| Track A (Bilaspur) and Track B (fallback) **deploy in the same release window** (2026-09-22) | |
| **Coding the Bilaspur fix and the Phase 1 rollout** — implementation package written, not built | |

## 2. A correction found while writing the coding plan

The Bilaspur guard **clears** the wrong price; it does not **supply** the correct one. Production has no mechanism at all for HPL's six whole-state entries (Bihar, Chhattisgarh, Kerala, Assam, Jharkhand, the North-East) — verified directly: every town in them (Patna, Raipur, Durg, Trivandrum, Guwahati, and Bilaspur itself) reads `unresolved` in the current data, not `published_map`. So after the guard, HPL Bilaspur reads "not published," not Chhattisgarh, until the Ex-Works fallback loads and supplies it via the same mechanism that fixes every other town in those six states. **Resolved:** the two tracks deploy in the same release window, so this gap is kept short.

A second correction, found while writing the technical inventory: `GET /pricing/history` and `GET /deals/history` are not consumed by any screen in the app today — there is no "history screen" to update, contrary to an earlier line in the coding plan (now fixed there too).

## 3. Final Phase 1 scope

| | Rows |
|---|---|
| **Approved (new fallback)** | 1,016 |
| **Retained (live, unchanged value)** | 60 |
| **Removed** (Latur, IOCL + HMEL) | 2 |
| **Ships in total** | **1,076** |
| Held out: Confirm | 188 |
| Held out: no reasonable replacement / cannot be located | 23 |
| Awaiting approval: Beawar candidates | 3 |

IOCL and RIL complete a quote on every approved row. For HMEL, HPL and OPaL, 231 of 623 approved rows still lack freight until a Phase 2 freight fallback. Full release impact: `09-release-impact-summary.md` (188 towns gain a competitor, 1 loses one, 477 net comparisons added).

## 4. Files

| File | What it is |
|---|---|
| **`09-release-impact-summary.md`** | Towns gaining/losing visibility, before/after counts, remaining exceptions |
| **`10-implementation-work-breakdown.md`** | PR1–PR4, dependencies, testing requirements |
| **`11-technical-inventory.md`** | Exact files, database collections, APIs, UI screens affected |
| **`12-deployment-checklist.md`** | Pre-deployment validation, backup, migration execution, post-deployment validation, rollback |
| **`13-branch-plan.md`** | Branch names and coding sequence (none created yet) |
| **`08-coding-plan.md`** | The file-by-file coding plan (Track A: Bilaspur guard; Track B: the fallback) |
| **`06-implementation-plan.md`** | The full design: schema, ETL, API, engine, UI, migration, rollback, testing, deployment |
| `phase1-load-manifest.csv` | The 1,016 approved rows |
| `phase1-retained-legacy-rows.csv` | The 60 retained rows (option 3) |
| `phase1-rows-no-longer-shown.csv` | The 2 removed rows (final) |
| `07-impact-report-rows-no-longer-shown.md` | Historical: the impact analysis that led to option 3 |
| `05-hpl-fix-verification.md` | The HPL Annexure V fix: defects, change, verification |
| `01-master-ex-works.md`, `02-...`, `03-...`, `04-...` | The full 1,231-row analysis, by outcome |
| `master-mapping.csv`, `location-equivalency-mapping.xlsx` | Everything, filterable |
| `../client-review/Location_Mapping_Changes_Client_Review.xlsx` | Client-approved workbook 1 (2026-09-22): what changes |
| `../client-review/Competitor_Presence_and_Fallback_Mapping.xlsx` | Client-approved workbook 2 (2026-09-25): per-location competitor presence and fallback behavior — the reference PR2 is validated against |
| `reference-ex-depot-NOT-APPROVED/` | Earlier depot analysis. **Do not use** |

Geographic data: GeoNames (https://www.geonames.org), CC BY 4.0, used from a scratch folder outside the repo. PR1 is what commits a small, reviewed subset of this into the repo; the analysis scripts themselves stay in the session scratchpad.
