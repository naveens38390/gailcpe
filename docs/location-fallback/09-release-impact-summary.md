# Release Impact Summary — Phase 1 (final, post client approval)

**Analysis only. No code, no migration, no deployment.** Client approved the mapping workbook on 2026-09-22 (1,016 approved rows, 60 retained, 2 removed, option 3, the workbook and mapping approach). This document is the release-facing view of that same approved scope: what changes for officers, town by town, once Phase 1 ships. Numbers are VERIFIED, computed directly from the approved dataset (`phase1-load-manifest.csv`, `phase1-retained-legacy-rows.csv`, `phase1-rows-no-longer-shown.csv`).

"Competitors compared" counts a producer only where it produces a full landed price (IOCL and RIL always qualify once a zone is resolved; HMEL, HPL and OPaL also need a freight rate to the town). A price with no freight rate is not counted as compared, in either "before" or "after" — this is unchanged by Phase 1 and revisited only if the Phase 2 freight fallback is later approved.

---

## 1. Headline

| | |
|---|---|
| Towns gaining competitor visibility | **188** |
| Towns losing competitor visibility | **1** (Latur) |
| Towns with no depth change | 124 (already fully or partially covered by exact/territory matches; Phase 1 adds no new comparison there) |
| Total additional (town, competitor) comparisons enabled | **477** |
| Total comparisons removed | **2** (Latur, IOCL + HMEL) |
| Net comparisons added | **+475** |

313 GAIL towns in total; 189 have a change in how many competitors are compared.

## 2. Towns gaining competitor visibility (188)

| Gain (extra competitors compared) | Number of towns |
|---|---|
| +1 | 47 |
| +2 | 59 |
| +3 | 38 |
| +4 | 22 |
| +5 (0 competitors before, full coverage after) | 22 |

22 towns went from **zero** competitors compared to all five. Full town-by-town detail: `phase1-load-manifest.csv` (which producer, which zone, why) and the client workbook's Impact Summary sheet.

## 3. Towns losing competitor visibility (1)

| Town | State | Before | After | Competitors affected | Why |
|---|---|---|---|---|---|
| Latur | Maharashtra | 5 | 3 | IOCL, HMEL | Nearest HPL-published hub (Kolhapur) is 312 km away — beyond HPL's own 95th-percentile reach (225 km) and not retained under option 3. Client-approved removal. |

RIL, OPaL and HPL are unaffected at Latur (already resolved through other tiers). No other town loses any comparator.

## 4. Competitor count before vs after — distribution across all 313 towns

| Competitors compared | Towns before | Towns after |
|---|---|---|
| 0 | 140 | 16 |
| 1 | 14 | 15 |
| 2 | 23 | 53 |
| 3 | 10 | 33 |
| 4 | 39 | 44 |
| 5 (all producers compared) | 87 | 152 |
| **Total** | **313** | **313** |

**140 towns had zero competitors compared before this release; 16 still do after it** — these 16 are among the 23 "no reasonable replacement" and the towns held for business review that happen to have no exact/territory match either (Section 5). 22 of the 140 move all the way to full 5-competitor coverage.

Full before → after movement, every combination that occurs (rows sum to 313):

| Before | After | Towns | | Before | After | Towns |
|---|---|---|---|---|---|---|
| 0 | 0 | 16 | | 2 | 5 | 13 |
| 0 | 1 | 14 | | 3 | 3 | 2 |
| 0 | 2 | 47 | | 3 | 4 | 4 |
| 0 | 3 | 23 | | 3 | 5 | 4 |
| 0 | 4 | 18 | | 4 | 4 | 16 |
| 0 | 5 | 22 | | 4 | 5 | 23 |
| 1 | 1 | 1 | | 5 | 3 | 1 (Latur) |
| 1 | 2 | 3 | | 5 | 5 | 86 |
| 1 | 3 | 4 | | | | |
| 1 | 4 | 2 | | | | |
| 1 | 5 | 4 | | | | |
| 2 | 2 | 3 | | | | |
| 2 | 3 | 3 | | | | |
| 2 | 4 | 4 | | | | |

Sum check: unchanged rows (after = before) = 16 + 1 + 3 + 2 + 16 + 86 = **124** (matches Section 1); gain rows (after > before) = **188**; loss row (after < before, Latur only) = **1**. 124 + 188 + 1 = 313.

## 5. Remaining exceptions after Phase 1 (unaffected by this release)

| Category | Rows | Towns | What happens |
|---|---|---|---|
| **Held for business review** | 188 | 130 | No current price; stays "not published" until reviewed. See `phase1-rows-no-longer-shown.csv`'s sibling analysis in `04-ambiguous-mappings.md` / `03-business-confirmation.md` for the full list. |
| **Beawar candidates** (pending, not auto-approved) | 3 | 1 (Beawar) | Today's price is unaffected either way — the candidate zone is identical to what production already shows. Formal sign-off remains outstanding, tracked separately (decision 0010). |
| **No reasonable replacement found** | 23 | 23 | Stay "not published." Nearest available zone was judged too far, or the town could not be located at all (Lote). |
| **Freight fallback (Phase 2)** | 231 of the 1,016 approved rows | — | Price zone resolves (HMEL/HPL/OPaL), but no freight rate is published to the town, so the quote stays incomplete and the competitor is still not compared, per business rule 1. Not approved for Phase 1. |
| **Ex-Depot fallback** | out of scope | — | Decision 0007 stands; untouched by this release. |

Total rows still outside Phase 1's approved scope: 214 (188 + 3 + 23).

## 6. What does not change

- Every **exact**, **alias** and **evidence** match: byte-identical.
- Every **Ex-Depot** quote: byte-identical (decision 0007; Phase 1 touches Ex-Works only).
- GAIL's own price book and Price Corrections: untouched.
- The 60 retained rows (Section 4 of the workbook): the number shown to an officer does not change at all — only the internal label does (from a legacy tag to "Inferred Location Match").

## 7. Source data

`phase1-load-manifest.csv` (1,016 rows), `phase1-retained-legacy-rows.csv` (60 rows), `phase1-rows-no-longer-shown.csv` (2 rows, final), cross-checked against the current committed `backend/data/normalized/price_index.json` and `freight.json`. Full methodology: `06-implementation-plan.md`.
