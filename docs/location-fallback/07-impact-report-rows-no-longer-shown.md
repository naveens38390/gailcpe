# Impact report: the live inferred prices that Phase 1 would stop showing

**Historical analysis, kept as the audit trail. Decision recorded 2026-09-22: option 3 approved** — 60 of these 62 rows are retained (`phase1-retained-legacy-rows.csv`); only the 2 Latur rows (HMEL, IOCL) are removed (`phase1-rows-no-longer-shown.csv`, now containing only those 2). See `06-implementation-plan.md` section 9.3. The analysis below is unchanged from when it was produced, so the "if all 62 are removed" framing in places is the option that was **not** chosen.

**Analysis only. No code, no data loaded.** Baseline: the repository data after the approved HPL fix, which is the state Phase 1 would load on top of. Counts are VERIFIED (computed from the data); revenue and usage are **not** in the repository and are not estimated (section 5).

## 1. Answers in brief

| Your question | Answer |
|---|---|
| Which competitors? | IOCL 17, RIL 13, HMEL 18, OPaL 14. **HPL none** (its rows are its own published territory). |
| Which towns? | **22 towns**, not 62 separate cases: 4 in Maharashtra, 4 in Rajasthan, 4 in Tamil Nadu, 3 in Gujarat, 3 in Madhya Pradesh, 2 in Haryana, 1 in Uttar Pradesh, 1 in Punjab (section 2). |
| Are they visible today? | **Yes, all 62 show a complete landed price today** (a freight rate exists for every HMEL and OPaL row). 54 show the same zone in production now; **8 show a different, wrong zone** that the HPL fix load already corrects (section 4). |
| Why does each disappear? | The design made the approved table the only source of inferred mappings, and these 62 are not in it: **24 are near-ties**, **33 are HPL's published hub versus a nearer zone**, **2 are 312 km away**, **3 are the Beawar candidates awaiting your approval** (section 3). |
| Can any be preserved? | **Yes: 60 of 62** rest on HPL's own published territory, the same state, and a distance within HPL's own reach. Removing all 62 would cut the number of competitors compared at **21 of 22 towns**, by up to 4 (section 6). |
| Revenue and usage? | **Not measurable from the repository.** Section 5 gives a read-only query for the real figure; I have not run it. |

## 2. Where they are: 22 towns

| Town | State | Rows lost | HPL hub (today's zone) | Hub km | Nearest zone (not approved) | Competitors compared today | After removing all 62 |
|---|---|---|---|---|---|---|---|
| Ahmednagar | Maharashtra | 4 (HMEL, IOCL, OPaL, RIL) | Pune | 113 | Aurangabad 108 km (HMEL,IOCL,OPaL,RIL) | 5 | 1 |
| Akola | Maharashtra | 4 (HMEL, IOCL, OPaL, RIL) | Nagpur | 222 | Jalgaon 152 km (HMEL,IOCL,OPaL,RIL) | 5 | 1 |
| Beawar | Rajasthan | 4 (HMEL, IOCL, OPaL, RIL) | Jodhpur | 132 | Ajmer 50 km (HMEL); Jodhpur 132 km (IOCL,OPaL,RIL) | 5 | 1 |
| Bharatpur | Rajasthan | 4 (HMEL, IOCL, OPaL, RIL) | Jaipur | 172 | Agra 52 km (HMEL,OPaL,RIL); Mathura 37 km (IOCL) | 5 | 1 |
| Dholpur | Rajasthan | 4 (HMEL, IOCL, OPaL, RIL) | Jaipur | 209 | Agra 56 km (HMEL,OPaL,RIL); Gwalior 59 km (IOCL) | 5 | 1 |
| Jamnagar | Gujarat | 4 (HMEL, IOCL, OPaL, RIL) | Rajkot | 77 | Mundra 54 km (HMEL); Gandhidham 68 km (IOCL,OPaL,RIL) | 5 | 1 |
| Shajapur | Madhya Pradesh | 4 (HMEL, IOCL, OPaL, RIL) | Bhopal | 116 | Indore 91 km (HMEL,IOCL,OPaL,RIL) | 4 | 0 |
| Surendranagar | Gujarat | 4 (HMEL, IOCL, OPaL, RIL) | Ahmedabad | 102 | Rajkot 100 km (HMEL,IOCL,OPaL,RIL) | 5 | 1 |
| Bharuch | Gujarat | 3 (HMEL, IOCL, RIL) | Baroda/Vadodara | 71 | Surat 58 km (HMEL,IOCL,RIL) | 5 | 2 |
| Bhiwani | Haryana | 3 (HMEL, IOCL, OPaL) | Panipat | 104 | Gurugram 94 km (HMEL,IOCL,OPaL) | 5 | 2 |
| Erode | Tamil Nadu | 3 (HMEL, OPaL, RIL) | Coimbatore | 91 | Karur 58 km (HMEL,OPaL,RIL) | 5 | 2 |
| Etawah | Uttar Pradesh | 3 (HMEL, OPaL, RIL) | Kanpur | 137 | Agra 109 km (HMEL,OPaL,RIL) | 5 | 2 |
| Katni | Madhya Pradesh | 3 (HMEL, IOCL, RIL) | Rewa | 119 | Jabalpur 87 km (HMEL,IOCL,RIL) | 4 | 1 |
| Rohtak | Haryana | 3 (HMEL, IOCL, OPaL) | Panipat | 66 | Gurugram 64 km (HMEL,IOCL,OPaL) | 5 | 2 |
| Satara | Maharashtra | 3 (HMEL, IOCL, OPaL) | Kolhapur | 113 | Pune 94 km (HMEL,IOCL,OPaL) | 5 | 2 |
| Guna | Madhya Pradesh | 2 (OPaL, RIL) | Bhopal | 155 | Tikamgarh 154 km (OPaL,RIL) | 5 | 3 |
| Latur | Maharashtra | 2 (HMEL, IOCL) | Kolhapur | 312 | Aurangabad 209 km (HMEL,IOCL) | 5 | 3 |
| Fazilka | Punjab | 1 (IOCL) | Ludhiana | 184 | Jalandhar 180 km (IOCL) | 4 | 4 |
| Karur | Tamil Nadu | 1 (IOCL) | Madurai | 116 | Salem 78 km (IOCL) | 5 | 4 |
| Nagaur | Rajasthan | 1 (HMEL) | Jodhpur | 127 | Ajmer 123 km (HMEL) | 5 | 4 |
| Namakkal | Tamil Nadu | 1 (IOCL) | Madurai | 145 | Salem 48 km (IOCL) | 5 | 4 |
| Salem | Tamil Nadu | 1 (HMEL) | Coimbatore | 148 | Karur 78 km (HMEL) | 5 | 4 |

## 3. Why each row disappears

Today these are legacy `inferred_via_hpl` mappings. Their **basis is published**: HPL's Annexure V lists the town as a district under a hub, and the competitor publishes a zone at that hub (VERIFIED for all 62; all 62 are in the town's own state). The design would remove that legacy inference and load only the approved table. These 62 are absent from it for four reasons:

| Cause | Rows | Detail |
|---|---|---|
| **Near-tie** (B) | 24 | the nearest zone is within a few km of HPL's hub, so my analysis called it ambiguous. The approved stability rule **A2** already says "keep the zone in use on a tie"; it was applied only to rows already Mapped. Hub distances: 66 to 184 km. |
| **HPL's hub versus a nearer zone** (C) | 33 | the hub is HPL's own published grouping; a nearer zone is 19 to 153 km closer. Two credible answers. Includes the withdrawn HMEL Beawar row. |
| **Beyond reach** (D) | 2 | Latur (IOCL, HMEL): the hub, Kolhapur, is 312 km away, beyond HPL's own 95th-percentile reach (225 km). |
| **Awaiting approval** (A) | 3 | IOCL, RIL, OPaL Beawar: Jodhpur, exactly today's zone. |

The rows in a town share one HPL hub, but a verdict can differ by producer because each publishes different zones (Jamnagar: HMEL's Mundra is 23 km nearer than the hub, while the others' Gandhidham is a near-tie).

## 4. What officers see today, and what removal would do

**Production today** (the pushed data, before the HPL fix load): 54 of the 62 show the same zone as after the fix. **8 show a wrong zone** that the HPL fix load corrects, so removal there would replace a wrong price with none:

| Competitor | Town | Production shows | After the HPL fix |
|---|---|---|---|
| HMEL | Etawah | Varanasi | Kanpur |
| OPaL | Etawah | Varanasi | Kanpur |
| RIL | Etawah | Varanasi | Kanpur |
| IOCL | Fazilka | Haridwar | Ludhiana |
| HMEL | Surendranagar | Surat | Ahmedabad |
| IOCL | Surendranagar | Surat | Ahmedabad |
| OPaL | Surendranagar | Surat | Ahmedabad |
| RIL | Surendranagar | Surat | Ahmedabad |

**Comparison depth** (competitors with a landed price) at the 22 towns, today versus after Phase 1 with all 62 removed. The "after" figure **includes** approved rows Phase 1 adds at the same towns from other producers, which is why Fazilka stays at 4:

| Competitors compared today to after | Towns |
|---|---|
| 4 to 0 | 1 |
| 4 to 1 | 1 |
| 4 to 4 | 1 |
| 5 to 1 | 7 |
| 5 to 2 | 6 |
| 5 to 3 | 2 |
| 5 to 4 | 4 |

**Seven towns fall from five competitors to one, and Shajapur falls to none.** Every one of the 62 is a complete quote today, so this is real visibility, not detail on a card.

## 5. Revenue and usage: what I can and cannot say

Neither is in the repository: it holds prices, freight and zones, not volumes or sales. I have **not** queried production (its connection string lives in `backend/api/.env`, and I will not use it without your explicit go-ahead). What the project data does show:

- The zonal comparison workbook (MZO) covers only 8 towns in one region (Aurangabad, Bhiwandi, Daman, Goa, Jalgaon, Nashik, Pune, Silvassa), so it says **nothing** about how much these 22 towns matter. I have not used it as evidence.
- Every one of the 62 is a **complete** quote today; nothing here is already a dead row.

The real usage figure is in the comparison history, which stores every result as served. **Read-only query** for the owner to run in Atlas (or to authorise me to run):

```
db.comparisonHistory.aggregate([
  { $match: { $expr: { $in: [ { $toUpper: "$location" }, [ "AHMEDNAGAR", "AKOLA", "BEAWAR", "BHARATPUR", "BHARUCH", "BHIWANI", "DHOLPUR", "ERODE", "ETAWAH", "FAZILKA", "GUNA", "JAMNAGAR", "KARUR", "KATNI", "LATUR", "NAGAUR", "NAMAKKAL", "ROHTAK", "SALEM", "SATARA", "SHAJAPUR", "SURENDRANAGAR" ] ] } } },
  { $unwind: "$result.quotes" },
  { $match: { "result.quotes.locationTier": "inferred_via_hpl" } },
  { $group: { _id: { town: { $toUpper: "$location" }, producer: "$result.quotes.producer" },
              comparisons: { $sum: 1 }, lastSeen: { $max: "$createdAt" } } },
  { $sort: { comparisons: -1 } }
])
```

It counts how often each affected (town, competitor) was actually shown as an inferred price. (Collection and field names checked in `activity.schema.ts` and `core/types.ts`; not executed.) Revenue would need volumes by town, which only GAIL holds.

## 6. Can they be preserved? Options

A **retained-live rule (R)** would keep an existing mapping under the new model when all three hold: (1) HPL's Annexure V lists the town under the hub; (2) it is in the town's own state; (3) the hub is within 225 km. Nothing new is inferred: it is today's mapping, relabelled **Inferred Location Match** with the distance caveat, entered in the reference table with its evidence, and flagged in the manifest so it is never mistaken for a fresh approval. All 62 pass (1) and (2); 60 pass (3).

| Option | Rows kept | Rows removed | Towns with fewer competitors | Note |
|---|---|---|---|---|
| 1. Remove all 62 (policy P1) | 0 | 62 | 21 | up to 4 competitors lost at a town; Shajapur to none |
| 2. Keep ties and candidates (A, B) | 27 | 35 | 14 | the 35 hub-versus-nearer rows are removed until reviewed |
| **3. Keep all but the two beyond-reach rows (A, B, C) (recommended)** | **60** | **2** | **1** (Latur, 2 competitors) | no change for any officer, relative to the post-fix state, except Latur; the 33 hub-versus-nearer rows get a per-town review |
| 4. Keep all 62 | 62 | 0 | 0 | keeps two 312 km mappings |

**Recommendation: option 3.** It is the only option that removes a price only where the evidence itself is weakest (312 km), and it turns the disagreement between HPL's hub and a nearer zone into a **22-town review list** instead of a loss of visibility. It does depart from the letter of "keep Confirm rows out of production" for rows that are **already live**; that is your call, which is why it is framed as an option. The strongest cases for the nearer zone (70 km or more closer) are Akola, Beawar, Bharatpur, Dholpur, Namakkal, Salem: worth deciding first.

## 7. Every row

Verdict key: **A** approve candidate, **B** near-tie, **C** HPL hub versus a nearer zone, **D** beyond reach. "Retain safely" means the mapping passes rule R; for C it is today's behaviour with a nearer zone open for review.

| Town | Competitor | Current tier | Current zone | km | Proposed outcome (P1) | Reason it disappears | Verdict | Retain safely? |
|---|---|---|---|---|---|---|---|---|
| Ahmednagar | IOCL | inferred_via_hpl | Pune | 113 | not published | near-tie between HPL's hub and the nearest zone; nearest Aurangabad 108 km | B1 | Yes |
| Ahmednagar | RIL | inferred_via_hpl | Pune | 113 | not published | near-tie between HPL's hub and the nearest zone; nearest Aurangabad 108 km | B1 | Yes |
| Ahmednagar | HMEL | inferred_via_hpl | Pune | 113 | not published | near-tie between HPL's hub and the nearest zone; nearest Aurangabad 108 km | B1 | Yes |
| Ahmednagar | OPaL | inferred_via_hpl | Pune | 113 | not published | near-tie between HPL's hub and the nearest zone; nearest Aurangabad 108 km | B1 | Yes |
| Akola | IOCL | inferred_via_hpl | Nagpur | 222 | not published | HPL's hub versus a materially nearer zone; nearest Jalgaon 152 km | C | Yes, review nearer zone |
| Akola | RIL | inferred_via_hpl | Nagpur | 222 | not published | HPL's hub versus a materially nearer zone; nearest Jalgaon 152 km | C | Yes, review nearer zone |
| Akola | HMEL | inferred_via_hpl | Nagpur | 222 | not published | HPL's hub versus a materially nearer zone; nearest Jalgaon 152 km | C | Yes, review nearer zone |
| Akola | OPaL | inferred_via_hpl | Nagpur | 222 | not published | HPL's hub versus a materially nearer zone; nearest Jalgaon 152 km | C | Yes, review nearer zone |
| Beawar | IOCL | inferred_via_hpl | Jodhpur | 132 | not published | awaiting your approval (Beawar candidate) | A | Yes (approve) |
| Beawar | RIL | inferred_via_hpl | Jodhpur | 132 | not published | awaiting your approval (Beawar candidate) | A | Yes (approve) |
| Beawar | HMEL | inferred_via_hpl | Jodhpur | 132 | not published | withdrawn from the approved set after the Beawar correction; nearest Ajmer 50 km | C | Yes, review nearer zone |
| Beawar | OPaL | inferred_via_hpl | Jodhpur | 132 | not published | awaiting your approval (Beawar candidate) | A | Yes (approve) |
| Bharatpur | IOCL | inferred_via_hpl | Jaipur | 172 | not published | HPL's hub versus a materially nearer zone; nearest Mathura 37 km | C | Yes, review nearer zone |
| Bharatpur | RIL | inferred_via_hpl | Jaipur | 172 | not published | HPL's hub versus a materially nearer zone; nearest Agra 52 km | C | Yes, review nearer zone |
| Bharatpur | HMEL | inferred_via_hpl | Jaipur | 172 | not published | HPL's hub versus a materially nearer zone; nearest Agra 52 km | C | Yes, review nearer zone |
| Bharatpur | OPaL | inferred_via_hpl | Jaipur | 172 | not published | HPL's hub versus a materially nearer zone; nearest Agra 52 km | C | Yes, review nearer zone |
| Bharuch | IOCL | inferred_via_hpl | Vadodara | 71 | not published | near-tie between HPL's hub and the nearest zone; nearest Surat 58 km | B1 | Yes |
| Bharuch | RIL | inferred_via_hpl | Baroda | 71 | not published | near-tie between HPL's hub and the nearest zone; nearest Surat 58 km | B1 | Yes |
| Bharuch | HMEL | inferred_via_hpl | Vadodara | 71 | not published | near-tie between HPL's hub and the nearest zone; nearest Surat 58 km | B1 | Yes |
| Bhiwani | IOCL | inferred_via_hpl | Panipat | 104 | not published | near-tie between HPL's hub and the nearest zone; nearest Gurugram 94 km | B1 | Yes |
| Bhiwani | HMEL | inferred_via_hpl | Panipat | 104 | not published | near-tie between HPL's hub and the nearest zone; nearest Gurugram 94 km | B1 | Yes |
| Bhiwani | OPaL | inferred_via_hpl | Panipat | 104 | not published | near-tie between HPL's hub and the nearest zone; nearest Gurugram 94 km | B1 | Yes |
| Dholpur | IOCL | inferred_via_hpl | Jaipur | 209 | not published | HPL's hub versus a materially nearer zone; nearest Gwalior 59 km | C | Yes, review nearer zone |
| Dholpur | RIL | inferred_via_hpl | Jaipur | 209 | not published | HPL's hub versus a materially nearer zone; nearest Agra 56 km | C | Yes, review nearer zone |
| Dholpur | HMEL | inferred_via_hpl | Jaipur | 209 | not published | HPL's hub versus a materially nearer zone; nearest Agra 56 km | C | Yes, review nearer zone |
| Dholpur | OPaL | inferred_via_hpl | Jaipur | 209 | not published | HPL's hub versus a materially nearer zone; nearest Agra 56 km | C | Yes, review nearer zone |
| Erode | RIL | inferred_via_hpl | Coimbatore | 91 | not published | HPL's hub versus a materially nearer zone; nearest Karur 58 km | C | Yes, review nearer zone |
| Erode | HMEL | inferred_via_hpl | Coimbatore | 91 | not published | HPL's hub versus a materially nearer zone; nearest Karur 58 km | C | Yes, review nearer zone |
| Erode | OPaL | inferred_via_hpl | Coimbatore | 91 | not published | HPL's hub versus a materially nearer zone; nearest Karur 58 km | C | Yes, review nearer zone |
| Etawah | RIL | inferred_via_hpl | Kanpur | 137 | not published | HPL's hub versus a materially nearer zone; nearest Agra 109 km | C | Yes, review nearer zone |
| Etawah | HMEL | inferred_via_hpl | Kanpur | 137 | not published | HPL's hub versus a materially nearer zone; nearest Agra 109 km | C | Yes, review nearer zone |
| Etawah | OPaL | inferred_via_hpl | Kanpur | 137 | not published | HPL's hub versus a materially nearer zone; nearest Agra 109 km | C | Yes, review nearer zone |
| Fazilka | IOCL | inferred_via_hpl | Ludhiana | 184 | not published | near-tie, hub 120 to 225 km away; nearest Jalandhar 180 km | B2 | Yes, caveat |
| Guna | RIL | inferred_via_hpl | Bhopal | 155 | not published | near-tie, hub 120 to 225 km away; nearest Tikamgarh 154 km | B2 | Yes, caveat |
| Guna | OPaL | inferred_via_hpl | Bhopal | 155 | not published | near-tie, hub 120 to 225 km away; nearest Tikamgarh 154 km | B2 | Yes, caveat |
| Jamnagar | IOCL | inferred_via_hpl | Rajkot | 77 | not published | near-tie between HPL's hub and the nearest zone; nearest Gandhidham 68 km | B1 | Yes |
| Jamnagar | RIL | inferred_via_hpl | Rajkot | 77 | not published | near-tie between HPL's hub and the nearest zone; nearest Gandhidham 68 km | B1 | Yes |
| Jamnagar | HMEL | inferred_via_hpl | Rajkot | 77 | not published | HPL's hub versus a materially nearer zone; nearest Mundra 54 km | C | Yes, review nearer zone |
| Jamnagar | OPaL | inferred_via_hpl | Rajkot | 77 | not published | near-tie between HPL's hub and the nearest zone; nearest Gandhidham 68 km | B1 | Yes |
| Karur | IOCL | inferred_via_hpl | Madurai | 116 | not published | HPL's hub versus a materially nearer zone; nearest Salem 78 km | C | Yes, review nearer zone |
| Katni | IOCL | inferred_via_hpl | Rewa | 119 | not published | HPL's hub versus a materially nearer zone; nearest Jabalpur 87 km | C | Yes, review nearer zone |
| Katni | RIL | inferred_via_hpl | Rewa | 119 | not published | HPL's hub versus a materially nearer zone; nearest Jabalpur 87 km | C | Yes, review nearer zone |
| Katni | HMEL | inferred_via_hpl | Rewa | 119 | not published | HPL's hub versus a materially nearer zone; nearest Jabalpur 87 km | C | Yes, review nearer zone |
| Latur | IOCL | inferred_via_hpl | Kolhapur | 312 | not published | live zone 312 km away; nearest Aurangabad 209 km | D | No |
| Latur | HMEL | inferred_via_hpl | Kolhapur | 312 | not published | live zone 312 km away; nearest Aurangabad 209 km | D | No |
| Nagaur | HMEL | inferred_via_hpl | Jodhpur | 127 | not published | near-tie, hub 120 to 225 km away; nearest Ajmer 123 km | B2 | Yes, caveat |
| Namakkal | IOCL | inferred_via_hpl | Madurai | 145 | not published | HPL's hub versus a materially nearer zone; nearest Salem 48 km | C | Yes, review nearer zone |
| Rohtak | IOCL | inferred_via_hpl | Panipat | 66 | not published | near-tie between HPL's hub and the nearest zone; nearest Gurugram 64 km | B1 | Yes |
| Rohtak | HMEL | inferred_via_hpl | Panipat | 66 | not published | near-tie between HPL's hub and the nearest zone; nearest Gurugram 64 km | B1 | Yes |
| Rohtak | OPaL | inferred_via_hpl | Panipat | 66 | not published | near-tie between HPL's hub and the nearest zone; nearest Gurugram 64 km | B1 | Yes |
| Salem | HMEL | inferred_via_hpl | Coimbatore | 148 | not published | HPL's hub versus a materially nearer zone; nearest Karur 78 km | C | Yes, review nearer zone |
| Satara | IOCL | inferred_via_hpl | Kolhapur | 113 | not published | HPL's hub versus a materially nearer zone; nearest Pune 94 km | C | Yes, review nearer zone |
| Satara | HMEL | inferred_via_hpl | Kolhapur | 113 | not published | HPL's hub versus a materially nearer zone; nearest Pune 94 km | C | Yes, review nearer zone |
| Satara | OPaL | inferred_via_hpl | Kolhapur | 113 | not published | HPL's hub versus a materially nearer zone; nearest Pune 94 km | C | Yes, review nearer zone |
| Shajapur | IOCL | inferred_via_hpl | Bhopal | 116 | not published | HPL's hub versus a materially nearer zone; nearest Indore 91 km | C | Yes, review nearer zone |
| Shajapur | RIL | inferred_via_hpl | Bhopal | 116 | not published | HPL's hub versus a materially nearer zone; nearest Indore 91 km | C | Yes, review nearer zone |
| Shajapur | HMEL | inferred_via_hpl | Bhopal | 116 | not published | HPL's hub versus a materially nearer zone; nearest Indore 91 km | C | Yes, review nearer zone |
| Shajapur | OPaL | inferred_via_hpl | Bhopal | 116 | not published | HPL's hub versus a materially nearer zone; nearest Indore 91 km | C | Yes, review nearer zone |
| Surendranagar | IOCL | inferred_via_hpl | Ahmedabad | 102 | not published | near-tie between HPL's hub and the nearest zone; nearest Rajkot 100 km | B1 | Yes |
| Surendranagar | RIL | inferred_via_hpl | Ahmedabad | 102 | not published | near-tie between HPL's hub and the nearest zone; nearest Rajkot 100 km | B1 | Yes |
| Surendranagar | HMEL | inferred_via_hpl | Ahmedabad | 102 | not published | near-tie between HPL's hub and the nearest zone; nearest Rajkot 100 km | B1 | Yes |
| Surendranagar | OPaL | inferred_via_hpl | Ahmedabad | 102 | not published | near-tie between HPL's hub and the nearest zone; nearest Rajkot 100 km | B1 | Yes |

## 8. Decisions needed

1. **Policy for the 62:** option 3 (recommended), or another. Until you decide, **no live inferred price is removed**.
2. **The 3 Beawar candidates:** approve (no change for officers) or leave pending. Pending them under option 3 keeps them via rule R anyway.
3. **Per-town review of the 33 hub-versus-nearer rows**, starting with Akola, Beawar, Bharatpur, Dholpur, Namakkal, Salem. Each town needs one answer that applies to all its rows.
4. **Latur:** confirm removal of the two 312 km rows, or keep them.
5. **Usage data:** authorise a read-only production query, or run the one above yourself.
