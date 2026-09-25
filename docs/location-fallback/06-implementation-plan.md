# Phase 1 technical design: Ex-Works location fallback

**DESIGN, FINAL POLICY. No code has been written, no data loaded, nothing committed.** Written 2026-09-21, finalised 2026-09-22 against local HEAD `ecf61cb5` plus the uncommitted HPL fix. Labels: **VERIFIED** (computed from the data or executed), **OBSERVED** (read in the code, not run), **INFERRED**, **PENDING VALIDATION** (needs an owner answer or a check I could not make). Coding plan: `08-coding-plan.md`.

---

## 0. Decisions on record

| Approved | Not approved |
|---|---|
| Corrections **A1, A2, A3**; approved set **1,016** rows; the **Bilaspur state guard** (2026-09-21) | Freight fallback (Phase 2 at the earliest) |
| HPL Annexure V fix, and loading the corrected data through a safe loader (before-image, post-load verification, rollback) (2026-09-21) | Ex-Depot fallback (decision 0007 stands) |
| Ex-Works fallback, Phase 1 = the rows classified **Mapped** only (2026-09-21) | Automatic approval of the 3 Beawar candidates (they stay pending, 2026-09-22) |
| Confirm and Cannot-Determine rows stay out of production (2026-09-21) | Any automatic handling of Confirm rows |
| One inferred tier; three labels: **Exact Published Match**, **Territory Match**, **Inferred Location Match**; `inferred_via_hpl` is a legacy alias only (2026-09-21) | Running the production usage query now (owner: not needed at this stage, 2026-09-22) |
| **Option 3 for the 62 live inferred prices: retain 60, remove the 2 Latur rows** (2026-09-22, section 9.3) | |
| **Coding the Bilaspur fix and the Phase 1 rollout** (2026-09-22; plan in `08-coding-plan.md`; no code written yet) | |

## 1. Scope and what it will visibly do

**Ships: 1,076 rows** — **1,016 approved** competitor rows (section 2) plus **60 retained-live** rows (section 9.3, `phase1-retained-legacy-rows.csv`): IOCL 215, RIL 207, HMEL 205, HPL 252, OPaL 197, across **273 towns** (all 21 retained-row towns already have at least one approved row, mostly HPL's own territory match; the retained rows add producer coverage at those towns, not new towns). **Does not ship:** 188 Confirm, 23 no-replacement, 3 Beawar candidates (pending), and the **2 Latur rows** (`phase1-rows-no-longer-shown.csv`).

**What an officer will see (VERIFIED from the data, OBSERVED from `freightFor`):**

| Producers | Approved rows | Complete quote in Phase 1 | Price found, freight missing |
|---|---|---|---|
| IOCL, RIL (delivered) | 393 | **393** | 0 |
| HMEL, HPL, OPaL (ex-works) | 623 | 392 | **231** (HMEL 68, HPL 109, OPaL 54) |

For those 231 the competitor still does not appear in the comparison (the engine reports "publishes no freight rate"). Phase 1 does not fix that, by decision. The card must say so plainly (section 8).

## 2. Corrections to the approved set (approved 2026-09-21)

The approved set was the 1,017 rows shown as Mapped. Grounding the design in live data exposed three problems in my own analysis. None of them adds a row you did not approve. All three are approved.

| # | Problem | Effect on the approved set |
|---|---|---|
| **A1** | Beawar is itself an Annexure V district (under `Rajasthan_Jodhpur`); I had preferred a district borrowed from a freight book (Ajmer, `Rajasthan_Jaipur`) | HPL Beawar: Jaipur to **Jodhpur**. HMEL Beawar (Ajmer) loses its HPL corroboration and **is withdrawn to Confirm**. IOCL, RIL, OPaL Beawar become Mapped: **3 candidates, not loaded unless you approve** (each maps to Jodhpur, which is what production shows today, so approving them changes nothing for the officer) |
| **A2** | 4 live towns would swap zone on a tie: Thane HMEL and OPaL (Mumbai 16 km vs Bhiwandi 15 km), Raigad OPaL (Mumbai 61 vs Navi Mumbai 53), Dhar HMEL (Indore 56 vs Nimrani 55) | Rule: a live mapping is kept unless the new zone is better by more than max(15 km, 15%), and only for a nearest-zone row in the same state. The 4 keep their live zone |
| **A3** | HPL's published map sends Chhattisgarh's **Bilaspur** to `Himachal Pradesh_Baddi` (1,121 km away). The name lookup has no state guard | **Correction: this is two separate fixes, not one (found while writing the coding plan, section 5, WP2b).** The guard *rejects* the wrong cross-state match; it does not *supply* the right one, because production's resolver has no mechanism at all for a "whole state" HPL entry (VERIFIED: Patna, Raipur, Durg, Trivandrum, Guwahati and every other town in HPL's six wholesale states are `unresolved` today, not `published_map`; Chhattisgarh's Annexure V entry is the single unqueryable line `["All districts of Chattisgarh"]`, not a district list). So after the guard, HPL Bilaspur (works and depot) reads **"not published"**, not Chhattisgarh — an honest gap, replacing a wrong price. The correct Chhattisgarh price returns when the **already-approved Ex-Works fallback** loads (rule S, one of the 699 ADD rows in section 9.2), the same mechanism that fixes it for Patna, Raipur and every other wholesale-state town |

**Result: 1,017 approved − 1 withdrawn = 1,016.** Rows whose zone changed relative to what you saw: 5 (the 4 in A2 and HPL Beawar).

## 3. Architecture

```
 reviewed reference table ──► ETL (offline) ──► normalised JSON ──► loaders M0 / M1 ──► MongoDB Location docs
 (approved rows only)          gates stop the      locations.json      compare-and-set,     producerZone / Tier / Meta
                               build on any        price_index.json    before-image,
                               violation                               dry run first              │
                                                                                                  ▼
 App (presents only) ◄── API: Quote.locationMatch ◄── engine (core/pricing.ts) ◄── DatasetService (cached per round)
```

Principles: extraction and derivation stay **offline** (decision 0001); the API never computes a distance and the app never does arithmetic; a town with no approved row keeps today's behaviour ("no published price", business rule 2); data never overwrites what a producer or a person stated.

## 4. Data model

### 4.1 Tier model

| Stored `LocationTier` | Group sent to the app | UI label | Source |
|---|---|---|---|
| `exact`, `alias`, `evidence` | `exact` | **Exact Published Match** | the producer names the town, a known spelling, or a price the zonal workbook proves. (`evidence` is proof by price, not by name; the label follows your wording) |
| `published_map`, `state_zone` (new) | `territory` | **Territory Match** | HPL's own Annexure V district list; or a zone the producer names for a whole state (IOCL Kerala, HMEL Punjab, and so on) |
| `inferred_location` (new) | `inferred` | **Inferred Location Match** | nearest published zone; own state preferred |
| `inferred_location` on one of the 60 retained rows (`location_meta` source `retained`) | `inferred` | **Retained Existing Mapping** | today's live mapping, kept under option 3 (§9.3). Label added 2026-09-25 by the approved *Competitor Presence and Fallback Mapping* workbook; behavior is the inferred group's |
| `inferred_via_hpl` (legacy) | `inferred` | **Inferred Location Match** | **read-only alias**: never written after M1, but still understood, so stored history and a data rollback keep working |
| `unresolved` | none | none (workbook: *No Approved Mapping*) | no price shown |

**Business reference (2026-09-25):** `docs/client-review/Competitor_Presence_and_Fallback_Mapping.xlsx` is the approved per-location reference this table must reproduce — every competitor at every one of the 313 locations, with the mapped location, distance and classification. PR2 is validated against it cell by cell.

The consolidation removes two inferred concepts (`inferred_via_hpl`, and the proposed nearest-zone tier) in favour of one.

### 4.2 Reference tables (new, committed, reviewed)

`backend/etl/reference/location_equivalence.json` holds **approved rows only**. Held rows live in a separate `location_equivalence.review.json` that **no code reads**, so flipping a status flag cannot ship a held row.

```
{ producer, town, zone, tier: "state_zone" | "published_map" | "inferred_location",
  distance_km, crosses_state, corroborated_by_hpl, evidence, round: "2026-09-01" }
```

Ships with the coordinate subset it depends on (about 850 town and zone rows, `geodata.json`) and a builder (`equivalence_build.py`) so the next round can be re-derived; the 15 MB GeoNames file is not committed (CC BY 4.0 attribution kept in the file header). **The analysis scripts currently live only in a session scratchpad, so this WP is what makes the result reproducible** (VERIFIED: they are not in the repo).

**Frozen generation rules** (each one is implemented and measured in the analysis): state-wide zone; HPL's own district list (a name that is itself an Annexure V district outranks a borrowed district, A1); nearest zone with own state preferred within 225 km, another state only if at least 2x nearer and the own-state zone is over 100 km away; HPL co-membership corroborates and outranks the reach cap; a live zone is kept on a tie (A2); 120 km / 225 km limits.

**Build gates** (fail the build, in the style of the existing four): every approved zone exists in this round's book; every town is canonical; **no row is ex-depot**; no row overwrites an `exact`/`alias`/`evidence`/`published_map` town; no `held` row is present; row count equals the manifest.

### 4.3 MongoDB

No new collection. `Location` (OBSERVED: `producerZone`, `producerZoneTier` already exist as free-form objects) gains one optional field:

```
producerZoneMeta: { [producer]: { km: number|null, crossesState: boolean, corroborated: boolean, source: "annexure_v"|"state_zone"|"nearest" } }
```

`LocationTier` (a TypeScript union, not a database constraint) gains `evidence` (already emitted, missing from the union, R13), `state_zone`, `inferred_location`. Stored `comparisonHistory` and `dealSimulations` keep the whole result **as served** (OBSERVED), so they are never migrated and will contain legacy tier strings forever; every reader must tolerate them.

## 5. ETL changes

| Work package | File | Change |
|---|---|---|
| WP1 | new `backend/etl/reference/*`, `equivalence_build.py` | tables, builder, coordinate subset |
| WP2 | new `backend/etl/equivalence.py`; `build.py` | load and validate the table (gates above); after the resolvers run, merge approved rows into `coverage[p].map` / `tier_of` **only where a town has no zone**; emit `location_meta` into `price_index.json` and `meta` into `locations.json`. Ex-depot resolvers untouched |
| WP2a | `build.py` | **remove `add_cluster_hubs` from the works resolvers**: the approved table becomes the only source of inferred mappings (consolidation). **The freight resolvers keep it**: freight is out of scope, and freight destinations are not touched in Phase 1 |
| WP2b | new `backend/etl/reference/gail_location_state.json`; `locations.py` (`Resolver.add_district_map` / `resolve_detailed`) | **A guard, not a resolver.** `add_district_map`'s lookup is keyed only by district name (VERIFIED: `_district_map: dict[str,str]`, no state), so a name that exists in two states' Annexure V entries — Bilaspur is HP's district *and* Chhattisgarh's town — silently takes whichever one HPL happens to list individually. The guard rejects a district match whose state disagrees with the town's own state, sourced from a new **committed, curated** `gail_location_state.json` (313 towns; not read from the freight books alone — HMEL/HPL/OPaL's own freight books **disagree** on Bilaspur's state, and on 6 other GAIL names: Aurangabad, Chandigarh, Kudal, Silvassa, Tarapur, Yanam — those need a human call, not a mechanical union). Table sourced from where the freight books already agree (252 of 313, VERIFIED) plus a reviewed answer for the rest (the geodata work already did this; committing the small table, not the geocoder, is what this WP needs). **Scope: a guard only.** It does not add whole-state resolution (that gap — Bihar, Chhattisgarh, Kerala, Assam and the North-East are never matched via `add_district_map` today, not just for Bilaspur — is filled by the Ex-Works fallback's rule S, already approved, not by this work package) |
| WP2c | `break_test.py`-style probes | negative tests: a missing zone, a depot row, a held row, an overwrite each stop the build |

The regenerated files change by design: `coverage.tiers` counts, the removal of every `inferred_via_hpl`, and the new tiers. Prices and every exact/alias/evidence mapping must not change (checked in section 11).

## 6. API

No route added or changed (OBSERVED in `pricing.service`: it returns the engine's `Comparison` unchanged plus two dates, and stores it as served; `deals.service` is checked in section 11, T3). Changes are to the payload only:

- `Quote.locationMatch`: `{ group, label, matchedZone, distanceKm?, crossesState?, corroborated?, source? }`. The **server** sends the group and label, so the app holds no tier logic. Optional, so an old stored result still parses.
- `Comparison.warnings` text and `DealSimulation.dataCaveats` (which is seeded from those warnings, OBSERVED at `deal.ts`): new inferred-tier wording.
- `locationTier` stays on the Quote unchanged (compatibility).
- `DatasetService` exposes `location_meta` built from `Location.producerZoneMeta`.
- **Kill-switch** `LOCATION_FALLBACK` (env, default `true`; set in `render.yaml`). When `false`, a quote in the `inferred` group is treated as unresolved. See section 10.

## 7. Pricing engine (`backend/api/src`)

| File | Change |
|---|---|
| new `core/location-match.ts` | pure functions: `tierGroup(tier)` (with the legacy alias), `TIER_LABEL`, `buildLocationMatch(...)` |
| `core/types.ts` | `LocationTier` union; `Quote.locationMatch` |
| `core/pricing.ts` | in `quote()`, after the zone and tier are resolved, attach `locationMatch`; apply the kill-switch; **guard: an ex-depot quote never uses a fallback tier** (defence in depth on top of the data). `compare()`: replace the `inferred_via_hpl` warning (three sites key off the one legacy string today) with the group test |
| `core/deal.ts` | `inferred` = any quote in the `inferred` group; `dataConfidence` stays capped at "medium" (today's behaviour for inferred) |
| `modules/dataset/dataset.service.ts` | build `location_meta` from the Location docs |
| `database/schemas/catalog.schema.ts`, `seed.ts` | tier union; `producerZoneMeta`; seed writes it so a fresh database matches |

**Warning wording** (proposed): `Inferred Location Match: IOCL is priced at Mumbai (58 km from Khopoli), HMEL at Khalapur (8 km). These are the nearest published zones, not the customer's town. Confirm before quoting.` Names the producer, the zone and the distance; adds `crosses into <state>` where relevant.

**Invariants the engine must keep:** exact, alias, evidence and published-territory quotes are unchanged to the paisa; every ex-depot quote is unchanged; a town with no approved row still returns "no published price".

## 8. UI (`frontend/src`)

The app presents what the API sends; no arithmetic, no tier logic.

| File | Change |
|---|---|
| `services/api.ts` | `LocationTier` union; `Quote.locationMatch?` (the second of the two `Quote` types that must stay in step, D4). A small defensive helper derives the group from a legacy `locationTier` when `locationMatch` is absent (old history) |
| `theme.ts` | `TIER_LABEL` replaced by the three group labels |
| `(tabs)/index.tsx` (Compare card) | **Exact:** nothing (as today). **Territory:** a quiet line, "Territory Match: from HPL's own territory list" or "zone covers all of Kerala". **Inferred:** a caveat, "Inferred Location Match: priced at Mumbai, 58 km from Khopoli. Confirm before quoting." plus "crosses into Telangana" where it does |
| same, incomplete inferred quote | when a quote is inferred and has no landed price: "Basic price is from <zone>. No freight rate is published to <town>, so this producer is not compared." (the 231 rows) |
| `(tabs)/deal.tsx` | **no change**: it renders `dataCaveats` and the confidence pill from the API (OBSERVED) |
| *(correction)* | `GET /pricing/history` and `GET /deals/history` are not consumed by any app screen (VERIFIED); there is no history screen to update. Legacy-tier tolerance matters only for `services/api.ts`'s types and for tools reading the raw API directly (`verify-release.ts`) |

## 9. Migration strategy

Two independent migrations, each with its own loader, before-image and rollback. **M1 requires M0**: the approved table was derived against post-M0 data, and M1's expected values assume it.

### 9.1 M0: the HPL Annexure V fix data, plus clearing (not correcting) Bilaspur

`fix-hpl-territory.ts`. Two kinds of write:

- **REPLACE** (existing R19 scope, VERIFIED): 103 works and 24 HPL depot location mappings, 17 freight destinations — wrong zone → the zone the corrected Annexure V reader gives.
- **CLEAR** (new, from WP2b, VERIFIED wrong on both bases): HPL Bilaspur, **works and depot** (2 rows) — `published_map` / `Himachal Pradesh_Baddi` → field removed, reading as `unresolved`. **This does not set the correct zone**, because production's resolver has no whole-state mechanism to supply one (section 2, A3): it only stops the wrong one. Chhattisgarh returns when M1 loads (below). Between M0 and M1, HPL Bilaspur honestly reads "not published" — safer than today, but not yet fixed, and the same is true of Patna, Raipur, Durg and every other town in HPL's six whole-state zones, not just Bilaspur. **Decided (2026-09-22): M0 and M1 deploy in the same release window, not months apart** — the journey is wrong → not published → correct, and the middle state is a real, temporary loss of comparison that should be kept as short as the deployment steps allow (section 12; coding plan section "Sequencing decided").

Depot operations apply only if the target database already carries depot fields (production does not yet, OBSERVED: the depot work is unreleased); otherwise the corrected depot data arrives with `load-depot`, which reads the regenerated files.

### 9.2 M1: the fallback — final policy (option 3, section 9.3)

`load-equivalence.ts`. Four operation types, each compare-and-set. Counts are VERIFIED against post-M0 data (Bilaspur cleared, not corrected — see 9.1) and are the **final** counts, with option 3 applied:

| Operation | Rows | Meaning |
|---|---|---|
| **ADD** | 699 | town has no zone; set zone, tier, meta. Includes HPL Bilaspur (698 towns genuinely unresolved before Phase 1, plus Bilaspur, cleared by M0 and restored here to `Chattisgarh` / Territory Match) |
| **RELABEL** | 265 | same zone, no number changes; `inferred_via_hpl` → `inferred_location`. 205 already-approved same-zone rows + **60 retained-live rows** (9.3) |
| **REPLACE** | 15 | zone changes; the expected old zone and tier must match |
| **REMOVE** | 2 | the two Latur rows (IOCL, HMEL): live zone 312 km away, beyond HPL's own 95th-percentile reach, not retained |
| no-op | 97 | rows where HPL's published territory was already correct |

Sum: 699 + 265 + 15 + 2 + 97 = **1,078** rows examined = 1,016 approved + 60 retained + 2 removed.

### 9.3 The 62 live inferred prices: option 3 approved (2026-09-22)

Making the approved table the only source of inferred mappings would have stopped 62 live inferred prices being shown. The impact report (`07-impact-report-rows-no-longer-shown.md`) found:

- They fell on **22 towns**: IOCL 17, RIL 13, HMEL 18, OPaL 14 (HPL none).
- **All 62 were complete, visible comparisons.** 54 showed the same zone in production; 8 showed a wrong zone that the HPL fix load already corrects.
- **All 62 rest on HPL's own published territory**, all in the town's own state. Near-ties (24), HPL's hub versus a materially nearer zone (33), or 312 km away (2, both Latur).
- Removing all 62 would have cut the competitors compared at 21 of 22 towns, by up to 4.

**Retained-live rule (R):** keep an existing mapping when (1) HPL's Annexure V lists the town under the hub, (2) it is in the town's own state, and (3) the hub is within 225 km. Nothing new is inferred: the row is today's mapping, relabelled Inferred Location Match with the distance caveat, carries `evidence: "retained_live_hpl_hub"` in the reference table (`phase1-retained-legacy-rows.csv`), and is flagged so it is never read as a fresh approval. All 62 passed (1) and (2); 60 passed (3).

**Decision: option 3 — keep the 60 that pass rule R, remove the 2 that fail it (Latur, both 312 km).** `phase1-retained-legacy-rows.csv` lists the 60; `phase1-rows-no-longer-shown.csv` now lists only the 2 removed. The 3 Beawar candidate rows (IOCL, RIL, OPaL) are among the 60 retained — their live zone is Jodhpur already, so retaining them changes nothing an officer sees; this is separate from, and does not amount to, approving them as new fallback rows, which stays pending (decision table, section 0).

### 9.4 Loader mechanics (both loaders)

Follow the `load-depot.ts` pattern (OBSERVED: dry run by default, `--apply`, staged data directory, `MONGODB_URI` required) and the release checklist's rule to **run from a clean checkout of the release commit, never a working folder**. Plus:

1. **Dry run** prints, per operation, current value, target value, and any conflict; writes nothing.
2. **Compare-and-set per field** (`updateOne` filtered on the expected old zone and tier, or on the field being absent). A hand correction made in the admin panel never matches, is reported as a conflict and **skipped, never forced**.
3. **Before-image:** before any write, the loader saves every Location document it will touch (whole `producerZone`, `producerZoneTier`, `producerZoneMeta`, `freightDestination`) plus a SHA-256 manifest to a file, and **refuses `--apply` if it cannot write it**.
4. **Audit:** one `auditLogs` entry (`migration.m0` / `migration.m1`) with counts and the manifest hash (OBSERVED: `AuditLog` accepts free-form `detail`).
5. **Read-back verification** after apply: every touched document is re-read and compared with the intended result; PASS/FAIL, non-zero exit on FAIL.
6. **Idempotent:** a second run finds every operation already applied and does nothing.
7. **Modes:** `--verify` (read-only comparison against the staged data) and `--rollback <before-image>` (section 10).
8. The API caches the dataset in memory per round (OBSERVED: `DatasetService.invalidate()` is in-process), so **the API must be restarted after every apply**.

It bypasses the admin revision workflow, as `seed.ts` and `load-depot.ts` do (Location records carry no revision pointer, R16); the audit entry and before-image are the record.

## 10. Rollback strategy

Three layers, fastest first. **Undo data before code**: an old API reading new tier strings would show no caveat.

| Layer | Trigger | Action | Time | Loses |
|---|---|---|---|---|
| **L1 Kill-switch** | any doubt about a fallback price | set `LOCATION_FALLBACK=false` in Render; the service restarts | minutes | nothing; **all inferred prices disappear** (fail-safe direction, and stricter than today's behaviour) |
| **L2 Data** | wrong mapping in production | `load-equivalence --rollback <before-image>` (and the same for M0): restores each touched document field by field, only where the current value still equals what the migration wrote; conflicts reported, not forced; then restart the API | minutes | comparisons served in between remain in history as served |
| **L3 Code** | engine or UI defect | redeploy the previous commit **after** L2 (or with L1 on) | a deploy | nothing |

Independent of these: the repo says Atlas is "already backed up" (OBSERVED, `render.yaml`) but the docs also say the cluster is the 512 MB free tier, and free clusters generally have no snapshots (**INFERRED, PENDING VALIDATION**: confirm in the Atlas console). The before-image is designed to be sufficient on its own.

## 11. Testing plan

**There are no automated tests in this repo (R2, VERIFIED).** Verification is scripted checks in the style of `tools/depot-verify.ts`, run on staged data, plus a small number of new unit tests. State plainly what runs.

| # | Check | How | Pass condition |
|---|---|---|---|
| T1 | ETL gates and reproducibility | run the build twice; run the negative probes (WP2c) | outputs identical; each violation stops the build |
| T2 | **Prices and exact mappings unchanged** | diff the regenerated files against the current ones | prices 0.00% movement; every `exact`/`alias`/`evidence` mapping identical |
| T3 | **`equivalence-verify.ts`** (new; offline, no database; loads staged data and calls `compare()` like `depot-verify.ts`) | every grade x town x 5 competitors, before vs after | (a) exact/alias/evidence/published quotes deep-equal; (b) every ex-depot quote deep-equal; (c) changed quotes are exactly the manifest: 699 added (including HPL Bilaspur, cleared by M0 and restored here), 15 replaced, 2 removed (Latur only), 265 relabelled with unchanged numbers (205 newly approved + 60 retained-live); (d) each approved or retained quote carries the manifest's group and label, and a retained quote's number is byte-identical to its pre-migration value; (e) no held or no-replacement row appears; the 3 Beawar candidate rows appear only via their retained-live entry, never as a freshly-approved row; (f) with the kill-switch off the inferred set collapses to unresolved and nothing else moves; (g) the Bhiwandi figures in `verify-release.ts` are unchanged |
| T4 | Unit tests (new, `npm test`; Jest is configured, none exist) | `core/location-match.spec.ts`: `tierGroup` including the legacy alias and an unknown tier; label text; warning wording | pass. Small and pure by design |
| T5 | **Loader rehearsal on an in-memory MongoDB** (never Atlas: quota, R17) | build the pre-M0 state, run M0 and M1: dry run, apply, verify, rollback | rollback restores byte-identical documents (hash compare); a document edited by hand beforehand is reported as a conflict and left alone; a second apply is a no-op |
| T6 | UI in the preview | Compare on: an inferred town (Asangaon: IOCL and HMEL), a territory town (Alappuzha, IOCL "Kerala"), an exact town (Bhiwandi), an incomplete inferred quote (Asangaon HMEL), a cross-state town (Bidar), 390 px width, an old history record | each label and caveat as specified; no console errors |
| T7 | Live, after deploy: `verify-release.ts` gains `--stage pre-fallback` and `post-fallback` | read-only apart from comparison-history records | pre: sampled answers unchanged. post: 30 sampled manifest rows show the expected zone and group, plus exact and depot controls unchanged |

**Not covered:** no end-to-end automation, no APK on a device, no load test. Say so in the release notes.

## 12. Deployment plan

**Precondition that changes the sequence (OBSERVED):** the code base already contains the unreleased ex-depot work (4 local commits, `origin/main` is `f3049b21`). Phase 1 touches the same engine and Compare files, so **it cannot be released ahead of the depot work**. Either the depot runbook runs first, or both ship in order with these steps after the depot verification.

| Step | Action | Gate to proceed |
|---|---|---|
| 0 | Approvals in section 14. Separate commits for the ETL fix, the regenerated data and each new tool; run every loader from a clean clone of the release commit | you sign off |
| 1 | Owner checks Atlas headroom (`listDatabases`, R17) and confirms whether snapshots exist | headroom confirmed |
| 2 | **M0 rehearsal** (T5), then `fix-hpl-territory` dry run against production; review conflicts | zero unexpected conflicts |
| 3 | M0 `--apply`; read-back PASS; restart API; `verify-release` sanity (Bhiwandi unchanged, the known wrong towns now right) | PASS |
| 4 | Deploy the API and app with the fallback code and **no fallback data**, kill-switch on | T7 `pre-fallback` matches: nothing changed |
| 5 | **M1 rehearsal** (T5), then dry run against production; confirm the dry run's 60 RELABEL_RETAINED values match `phase1-retained-legacy-rows.csv` and its 2 REMOVE targets match `phase1-rows-no-longer-shown.csv` | dry run matches the manifests exactly |
| 6 | M1 `--apply`; read-back PASS; restart API; T7 `post-fallback` | PASS |
| 7 | Build and release the APK (`preview` profile, version bump) | only after step 6 |
| 8 | Monitor: the first day's comparison history for inferred quotes; keep L1 ready | no complaint |
| 9 | Docs, per repo protocol: module and feature docs, business rule 2 amended, R19 closed, a decision record, changelog, regenerated maps, `check-docs` | done |

**Steps 2 to 6 run in one continuous window** (same day or the next maintenance window), not spread across separate releases: this is what keeps the Bilaspur "not published" gap between M0 (step 3) and M1 (step 6) short, per the decision in section 14. Track A's code can be merged well ahead of time; only its deployment step (part of step 2–3) is held until Track B is ready to follow immediately.

Render's free instance spins down when idle (OBSERVED, `render.yaml`): allow for a cold start before verifying.

## 13. Work packages

| WP | Content | Size | Depends on |
|---|---|---|---|
| WP1 | Reference tables, builder, coordinate subset | M | your sign-off on section 2 |
| WP2, 2a, 2b, 2c | ETL merge, gates, cluster-hub removal (works), state guard, negative probes | M | WP1 |
| WP3 | `migration-lib`, `fix-hpl-territory`, `load-equivalence`, rehearsal | L | WP2 |
| WP4 | Engine, API payload, kill-switch | S | WP2 (data shape) |
| WP5 | App types, labels, caveats | S | WP4 |
| WP6 | `equivalence-verify`, unit tests, `verify-release` stages | M | WP4 |
| WP7 | Release runbook and docs | S | all |

## 14. Decisions

### Resolved

| # | Decision | Outcome |
|---|---|---|
| 1 | A1 to A3 | **Approved** (2026-09-21). The Bilaspur fix (A3) is approved to build (2026-09-22, coding plan `08-coding-plan.md`) |
| 2 | Policy for the 62 live inferred prices | **Option 3 approved** (2026-09-22): keep 60 via the retained-live rule, remove the 2 Latur rows |
| 3 | The 3 Beawar candidates | **Stay pending**, not auto-approved (2026-09-22). Their live value is preserved regardless, via retained-live row #2 |
| 4 | Freight fallback | **Not approved**; stays Phase 2 (2026-09-21, reaffirmed 2026-09-22) |
| 5 | Ex-Depot fallback | **Not approved**; decision 0007 stands |
| 6 | Production usage query for the 62 | **Not needed at this stage** (2026-09-22): the impact report's structural findings (defensible basis, visible today, comparison-depth cost) were judged sufficient without it |
| 7 | Accept 231 approved rows show "price found, freight missing" until Phase 2 | accepted, with the wording in section 8 |
| 8 | Bilaspur's interim gap (M0 clears the wrong price; M1 restores the correct one) | **Ship M0 and M1 in the same release window** (2026-09-22): the journey is wrong → not published → correct, and the middle state is a real, temporary loss of comparison for Bilaspur and every other whole-state-zone town, not just an internal nuance — kept as short as the deployment steps allow. See the coding plan's "Sequencing decided" |

### Still open (do not block starting the coding plan)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Include the Bilaspur depot **clear** in M0 alongside the 24 R19 depot corrections (section 9.1) | yes; drop with a flag if you disagree |
| 2 | Kill-switch direction: off removes **all** inferred prices | yes (fail-safe) |
| 3 | Sequence with the unreleased depot work (section 12) | depot first |
| 4 | Introduce Jest specs (T4) | yes; a handful of pure tests |
| 5 | Confirm whether Atlas snapshots exist | owner |
| 6 | Facts only you can supply: the nine uncertain towns, Lote, RIL and OPaL "Sendh" | when convenient; none blocks Phase 1 |

## 15. Risks

| Risk | Mitigation |
|---|---|
| A fallback price is read as exact | distinct label, caveat on the card, capped Deal confidence, held rows excluded |
| Production differs from the repo data (older round, hand edits) | compare-and-set, dry run, conflicts reported and skipped |
| Old app or API meets new data | release order (code first, data second); legacy alias; L1 kill-switch |
| Loader run from a working folder loads someone's unfinished edit | clean-clone rule from the release checklist |
| The reference table goes stale next round | build gate stops on a missing zone; builder re-derives |
| Atlas quota (R17) | additions are small (INFERRED, well under 1 MB); owner checks headroom first |
| Removing legacy inference surprises officers | P1 sign-off with the explicit list; approve the 3 candidates |
| Two `Quote` types drift (D4) | change both in one commit; T7 reads the live shape |

## Appendix: new or changed artefacts

New: `backend/etl/reference/{location_equivalence.json,location_equivalence.review.json,geodata.json}`, `backend/etl/{equivalence.py,equivalence_build.py}`, `backend/api/src/core/location-match.ts` (+ `.spec.ts`), `backend/api/src/database/{migration-lib.ts,fix-hpl-territory.ts,load-equivalence.ts}`, `backend/api/src/tools/equivalence-verify.ts`, npm scripts `fix-hpl-territory`, `load-equivalence`, `verify-equivalence`, env `LOCATION_FALLBACK`.
Changed: `backend/etl/{build.py,locations.py}`, `backend/api/src/core/{types,pricing,deal}.ts`, `modules/dataset/dataset.service.ts`, `database/schemas/catalog.schema.ts`, `database/seed.ts`, `tools/verify-release.ts`, `render.yaml`, `frontend/src/{services/api.ts,theme.ts,app/(tabs)/index.tsx}`.
Not changed: any route, the Deal screen, Ex-Depot paths, Price Corrections, exports, freight resolution.
