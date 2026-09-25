# Coding plan: Bilaspur fix and Phase 1 rollout

**No code has been written.** This is the ordered, file-by-file plan for review before implementation starts. It sequences the two approved pieces of work — the Bilaspur state-guard fix (Track A) and the Ex-Works fallback (Track B, Phase 1) — as two tracks, coded separately but **deployed together in one release window** (decision below). Full rationale, data model and testing strategy are in [`06-implementation-plan.md`](06-implementation-plan.md); this document is the task breakdown.

## Sequencing decided (2026-09-22): ship close together

Track A alone turns Bilaspur's wrong price into "not published" — safer, but for Bilaspur, Patna, Raipur, Durg and every other town in HPL's six whole-state zones, that is a **wrong → not published → correct** journey, and the middle state is a real, if temporary, loss of comparison for those officers. **Track A does not deploy alone for an extended period.** Both tracks are coded and rehearsed together, then deployed in the same release window (same day or the next maintenance window), so the "not published" state is never visible to an officer for more than that window. This closes design section 14 item 2 and open question Q10.

Sequence:

1. **Code Track A** (A1–A5).
2. **Code Track B** (B1–B10).
3. **Rehearse both together** on an in-memory MongoDB (T5 for M0's CLEAR extension and for M1, run back to back, not as separate exercises).
4. **Deploy:** Track A's code and data (M0, including the Bilaspur CLEAR) → immediately followed by Track B's code and data (M1) in the same window → validation checks (T7) → restart → monitor.

Track A's guard code can still land in its own commit and be reviewed on its own (PR 3 below is unchanged), but **its deployment step is merged into Track B's release order** (design section 12), not run as an earlier, separate release.

---

## 0. A correction, found while writing this plan

The design said the Bilaspur fix "becomes HPL's Chhattisgarh state zone" at the ETL layer. That is not quite right, and matters for sequencing: **production's resolver has no mechanism at all for a whole-state HPL entry** (VERIFIED: Patna, Raipur, Durg, Trivandrum, Guwahati and every other town in HPL's six wholesale states — Bihar, Chhattisgarh, Kerala, Assam, Jharkhand, the North-East — are `unresolved` today, not `published_map`; Chhattisgarh's Annexure V line is the single unqueryable string `"All districts of Chattisgarh"`, not a district list). So the guard (Track A) **stops the wrong price**; it does not supply the right one. The right one — for Bilaspur and for every other town in those six states — comes from the **already-approved Ex-Works fallback** (Track B, rule S). Track A can still ship first and independently; officers see "not published" for HPL at Bilaspur in the gap between the two, which is safe (business rule 2) but not yet the correct price. Section 14, item 2 of the design asks you to confirm whether that gap is acceptable or whether the two tracks should ship close together.

---

## Track A: the Bilaspur guard (small; coded independently, deployed with Track B)

### A1. `backend/etl/reference/gail_location_state.json` (new, committed)

One state per GAIL canonical location (313 entries). **Not derived mechanically from the freight books alone**: HMEL, HPL and OPaL's own freight books disagree on the state for 7 names — Aurangabad, Bilaspur, Chandigarh, Kudal, Silvassa, Tarapur, Yanam — because each is a real place in more than one state, or is itself the disagreement Bilaspur is a case of. 252 of 313 are unambiguous (every freight book that names the town agrees); those are auto-derived and spot-checked. The remaining 61, including the 7 name clashes, are reviewed and recorded with a one-line reason each (this repeats and commits the same table used in the analysis, `towns_state.py`, which is currently only in the session scratchpad).

- **File shape:** `{ "BILASPUR": "Chhattisgarh", ... }`.
- **Acceptance:** every one of the 313 canonical names in `locations.json` has an entry; the 252 auto-derived entries agree with every freight book that names the town; the 7 name-clash entries carry a `_reasons.json` sibling file with the one-line justification, reviewable independently of the code.

### A2. `backend/etl/locations.py`: the guard

`Resolver.add_district_map` and `resolve_detailed`'s `published_map` branch gain a state check: a district match is used only if `gail_location_state[gail_town] == point_state(price_point)`; otherwise the resolver falls through to the next tier (today, that means `unresolved`, since no producer other than HPL calls `add_district_map`). `point_state` is a small new helper deriving a price point's state from its own name (`West Bengal_Howrah` → West Bengal; the six bare-state names map to themselves) — this already exists as a read-only helper in the analysis (`point_state` in `hpl_backtest.py`) and is being ported, not invented fresh.

- **Acceptance:** Bilaspur becomes `unresolved` for HPL, works and depot. No other currently-correct `published_map` row changes (run the full 195-row check the analysis already did, now as a script instead of a one-off).

### A3. `backend/etl/break_test.py`: a negative probe

Add a case asserting a same-named district in two different states resolves to neither when the state disagrees — using Bilaspur itself as the fixture, so a regression is caught immediately if the guard is ever loosened.

### A4. `database/fix-hpl-territory.ts`: extend the existing M0 loader

Add the **CLEAR** operation type (works and depot, 2 rows) alongside the existing REPLACE operations: compare-and-set where "compare" is the known-wrong value and "set" is *removing* the `producerZone.HPL` / `producerZoneTier.HPL` field for `BILASPUR`, not writing a new value. Same before-image, same read-back verification, same dry-run-by-default pattern as the existing 127 REPLACE rows (design section 9.4).

- **Acceptance:** dry run shows the 2 CLEARs distinctly from the 127 REPLACEs; `--apply` on a rehearsal database removes exactly those two fields; rollback restores them; a second run is a no-op.

### A5. Rebuild and diff

Re-run the ETL with A2 in place; confirm the regenerated `price_index.json` shows HPL Bilaspur (works, depot) as `unresolved`, every other `published_map` row unchanged, and prices at 0.00% movement (same gate as the R19 fix).

### Track A deployment

Coded and reviewed on its own: commit → rehearse the M0 CLEAR extension on an in-memory MongoDB. **Deployment (`--apply` against production, read-back, restart) is held until Track B is ready and runs in the same window** (decision above, and design section 12) — not run as soon as the code lands. No app or engine change is needed for Track A by itself (a cleared field already reads as "not published" through the existing, unmodified code path), so holding its deployment costs nothing technically; it is purely a scheduling choice to keep the "not published" gap short.

---

## Track B: the Ex-Works fallback (Phase 1)

Ordered so each step is independently reviewable and, mostly, independently testable. WP numbers match `06-implementation-plan.md` section 5.

### B1 (WP1). Reference tables and builder

- `backend/etl/reference/location_equivalence.json` — the 1,016 approved + 60 retained-live rows (1,076), generated from the reviewed analysis (`phase1-load-manifest.csv` + `phase1-retained-legacy-rows.csv`), **not** the 188 held or 23 no-replacement rows.
- `backend/etl/reference/location_equivalence.review.json` — the held rows, for visibility only; no code path reads it (design section 4.2).
- `backend/etl/reference/geodata.json` — the ~850-row coordinate subset the builder needs to re-derive a future round; the 15 MB GeoNames file itself is not committed (CC BY 4.0 attribution kept in a header comment).
- `backend/etl/equivalence_build.py` — regenerates the two JSON files above from a staged round, reusing A1's `gail_location_state.json`.
- **Depends on:** nothing in Track A; can start immediately. **Acceptance:** the builder reproduces `location_equivalence.json` byte-for-byte from the current round; row count matches the manifest (1,076); every row's town is canonical and every zone exists in the round's price book.

### B2 (WP2). ETL merge and gates

- `backend/etl/equivalence.py` — loads and validates the reference table: gates from design section 4.2 (approved zone exists; canonical town; no ex-depot row; no row overwrites `exact`/`alias`/`evidence`/`published_map`; no held row present; row count equals the manifest).
- `build.py` — after the resolvers run (and after A2's guard, if Track A has landed by then), merge approved rows into `coverage[p].map` / `tier_of` **only where a town currently has no zone**; emit `location_meta` (distance, crosses-state, corroborated) into `price_index.json`, and `meta` into `locations.json`.
- **Depends on:** B1. **Acceptance:** T1/T2 from the design's testing plan — gates fire on each negative case; prices and every `exact`/`alias`/`evidence` mapping are byte-identical before and after.

### B3 (WP2a). Remove legacy cluster-hub inference from the works resolvers

- `build.py` — delete the `add_cluster_hubs` call for the **works** resolvers only (the reference table is now the sole source of inferred mappings there); leave it in place for the **freight** resolvers (freight is out of scope for Phase 1).
- **Depends on:** B2, so the removal and the replacement land together and the diff is reviewable as one change (no in-between state where inference is gone and nothing has replaced it).
- **Acceptance:** every town that resolved via legacy `inferred_via_hpl` now resolves via B2's merge to the same value if retained, or is `unresolved` if not in the reference table (matches `phase1-load-manifest.csv` / `phase1-retained-legacy-rows.csv` / `phase1-rows-no-longer-shown.csv` exactly, row for row).

### B4 (WP2c). Negative probes

Extend `break_test.py` (alongside A3): a reference-table row for a non-canonical town, a row for a zone absent from the round, a row overwriting an `exact` match, and a held row present in the loaded file each stop the build.

### B5 (WP4). Pricing engine and API payload

- `core/location-match.ts` (new) — `tierGroup(tier)` (including the legacy `inferred_via_hpl` alias), `TIER_LABEL`, `buildLocationMatch(...)`. Small and pure, so it is the first thing to get a unit test (B9).
- `core/types.ts` — `LocationTier` union gains `evidence` (already emitted, missing from the type, R13), `state_zone`, `inferred_location`; `Quote.locationMatch`.
- `core/pricing.ts` — `quote()` attaches `locationMatch` after the zone/tier resolve; applies the `LOCATION_FALLBACK` kill-switch; **guards that an ex-depot quote never carries a fallback tier**, independent of the data (defence in depth); `compare()`'s warning text keys off the tier group rather than the one legacy string.
- `core/deal.ts` — `dataConfidence` capped at "medium" for any quote in the `inferred` group (already true for `inferred_via_hpl`; now keyed off the group).
- `modules/dataset/dataset.service.ts` — exposes `location_meta`.
- `database/schemas/catalog.schema.ts`, `seed.ts` — tier union; `producerZoneMeta`; seed writes it.
- `render.yaml` — `LOCATION_FALLBACK=true` default.
- **Depends on:** B2 (needs the final data shape). **Acceptance:** T3 (`equivalence-verify.ts`, B7) and the invariants in design section 7 (exact/alias/evidence/published-territory and every ex-depot quote unchanged to the paisa).

### B6 (WP5). App

- `services/api.ts` — tier union, `Quote.locationMatch?`, a defensive group-from-legacy-tier helper for old stored history.
- `theme.ts` — the three group labels replace `TIER_LABEL`.
- `(tabs)/index.tsx` — Exact: unchanged. Territory: a quiet line. Inferred: the caveat with distance and, where relevant, "crosses into `<state>`"; a separate message for an inferred quote with no landed price (the 231 freight-incomplete rows).
- **Correction:** `GET /pricing/history` and `GET /deals/history` are **not consumed anywhere in the app today** (VERIFIED: no screen calls either route), so there is no "history screen" to update. Tolerating a legacy tier string is a concern only for `services/api.ts`'s types (optional field) and for anything reading the raw API response directly (`verify-release.ts`, B7) — not for any UI.
- **Depends on:** B5 (payload shape). `(tabs)/deal.tsx` needs no change (it already renders `dataCaveats` and the confidence pill from the API).

### B7 (WP6). Verification tooling

- `tools/equivalence-verify.ts` (new, offline, no database) — the T3 checks from the design's testing plan, run against staged pre/post data.
- `core/location-match.spec.ts` (new; first use of Jest in this repo, pending confirmation in design section 14) — `tierGroup`, label text, warning wording.
- `tools/verify-release.ts` — new `--stage pre-fallback` / `post-fallback`.
- **Depends on:** B5.

### B8 (WP3). Loaders

- `database/migration-lib.ts` (new, shared by both loaders) — compare-and-set, before-image (SHA-256 manifest), audit-log entry, read-back verification, `--verify` and `--rollback` modes. This is what A4 (Track A's CLEAR extension) also uses, so **build this before or alongside A4** even though it is listed under Track B; the two tracks share this one file.
- `database/load-equivalence.ts` (new) — ADD / RELABEL / REPLACE / REMOVE against `location_equivalence.json`, following `load-depot.ts`'s pattern (dry run by default, `--apply`, staged directory, `MONGODB_URI` required).
- **Depends on:** B2 (data shape), B5 (schema fields).
- **Acceptance:** T5 — rehearsal on an in-memory MongoDB; rollback restores byte-identical documents; a hand-edited document is reported as a conflict and skipped, never forced; a second run is a no-op.

### B9. Unit tests, if approved (design section 14, item 5)

`core/location-match.spec.ts` from B7, run via `npm test`. Small and pure by construction (B5); no test infrastructure beyond what Jest already provides (configured, unused today).

### B10 (WP7). Docs and release

Module and feature docs, business rule 2 amended, R19 (and, once Track A ships, R20) closed in `risks.md`, a decision record, changelog entry, regenerated dependency maps, `check-docs`. Release runbook: design section 12.

---

## Suggested commit / PR breakdown

| # | Contents | Track | Reviewable alone? |
|---|---|---|---|
| 1 | A1 `gail_location_state.json` (+ `_reasons.json`) | A | yes — pure data, easy to check the 7 disputed entries |
| 2 | A2 guard + A3 probe | A | yes — small diff in `locations.py` |
| 3 | A4 M0 CLEAR extension + rehearsal | A | yes |
| 4 | B1 reference tables + builder | B | yes — data only |
| 5 | B2 + B3 + B4 (ETL merge, cluster-hub removal, gates) | B | reviewed together: B3 only makes sense alongside B2's replacement |
| 6 | B5 (engine + API payload) | B | yes, against B2's fixtures |
| 7 | B6 (app) | B | yes, against B5's payload |
| 8 | B7 (verification tooling) + B9 (unit tests, if approved) | B | yes |
| 9 | B8 (loaders, shared `migration-lib.ts`) | A + B | needs B2 and B5 merged first for `load-equivalence`; `fix-hpl-territory`'s CLEAR (A4) can use `migration-lib.ts` as soon as it exists, ahead of the rest |
| 10 | B10 (docs, release runbook) | B | last |

PR 3 (Track A complete) can be **merged and reviewed** on its own timeline, but its **deployment step waits for Track B** (decision above) — PRs 1–10 all land in code before any of it goes to production. PRs 4–10 are Track B and follow the release order in design section 12 (depot work first, then Track A + Track B deployment steps in order, docs last).

---

## What this plan does not do

It does not write any of the files above. It is the thing to approve before that starts. Once approved, I will build one PR at a time in the order above, re-reading each file immediately before editing it (per this repo's own working rules) and reporting what actually ran versus what I could not run (there are no automated tests here today beyond what B9 adds).
