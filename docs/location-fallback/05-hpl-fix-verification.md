# HPL Annexure V fix: what changed, and how it was verified

Status: **fix applied to the working tree, not committed, not loaded into any database.** Verified by execution on 2026-09-21.

## The defects (VERIFIED)

1. **Misattribution.** The reader attached the district lines above each price-point label to the *previous* point. 129 of 516 districts landed on the wrong price point.
2. **Dropped and invented points.** Haryana_Faridabad and Gujarat_Ahmedabad were lost; two lines of the legal notice under the table were stored as price points.
3. **Dangling zone.** Annexure V spells a point "Orissa_Barhgarh"; the price book says "Orissa_Bargarh". HPL's Sambalpur was mapped to a zone that has no prices.

## The change

| File | Change |
|---|---|
| `backend/etl/extractors/haldia.py` | `territory_map` reads the table by its cell borders; finds the table by its "Territory Division" heading (no page constant); stops the build unless the rows are a clean 1..N list. New `reconcile_territory` keys Annexure V by the price book's names and stops the build unless the two describe the same 71 points. |
| `backend/etl/build.py` | calls `reconcile_territory` and logs the rename. |
| `backend/etl/break_test.py` | one probe message made true again (no page constant). |
| `backend/data/normalized/{price_index,prices,freight,locations,build_report}.json` | regenerated. |

## Verification

| Check | Result |
|---|---|
| Baseline: unfixed ETL re-run into a scratch folder vs the committed data | **byte-identical** in all 7 data files, so the rehearsal is faithful |
| Fixed reader vs an independent read of the PDF table cells (pdfplumber) | same 71 points, same districts; junk rows gone; bracketed names kept whole |
| Fixed ETL: all build gates (Round, Rectangle, Shrink, Drift) | pass; prices **0.00%% movement** on all 6 producers |
| Prices and depot books after the fix vs before | **identical** (only location and freight-destination maps changed) |
| Resolutions checked against the independent PDF read | **477 checked, 0 wrong** (was 108: 86 ex-works + 22 HPL ex-depot) |
| HPL mappings pointing at a zone with no prices | **0** (was 1: Sambalpur) |
| Known examples | Gorakhpur HPL -> Uttar Pradesh_Varanasi; Lucknow -> Kanpur; Kakinada -> Vizag; Meerut -> Noida; Kolar -> Bangalore; Fazilka -> Ludhiana |

**Not run:** the API, the app, `seed.ts`, or any database. The data reaches production only through a load step that does not exist yet (see `06-implementation-plan.md`, section 7).

## Location mapping changes (125)

Producer / basis / town. **Removed** rows are prices that were wrong and now correctly read "not published" until a fallback is approved.

| Basis | Producer | Town | Change | Was (tier) | Now |
|---|---|---|---|---|---|
| Ex Depot | HPL | Burhanpur | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Depot | HPL | Cuttack | re-pointed | Orissa_Balasore (published_map) | Orissa_Bhubaneswar |
| Ex Depot | HPL | Dhar | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Depot | HPL | Etawah | re-pointed | Uttar Pradesh_Varanasi (published_map) | Uttar Pradesh_Kanpur |
| Ex Depot | HPL | Fatehpur | re-pointed | Uttar Pradesh_Varanasi (published_map) | Uttar Pradesh_Kanpur |
| Ex Depot | HPL | Fazilka | re-pointed | Uttarakhand_Haridwar (published_map) | Punjab_Ludhiana |
| Ex Depot | HPL | Gaziabad/Noida | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Depot | HPL | Ghazipur | re-pointed | Haryana_Panipat (published_map) | Uttar Pradesh_Varanasi |
| Ex Depot | HPL | Gorakhpur | re-pointed | Haryana_Panipat (published_map) | Uttar Pradesh_Varanasi |
| Ex Depot | HPL | Kakinada | re-pointed | Telangana_Hyderabad (published_map) | Andhra Pradesh_Vizag |
| Ex Depot | HPL | Kheda | re-pointed | Gujarat_Surat (published_map) | Gujarat_Ahmedabad |
| Ex Depot | HPL | Kolar | re-pointed | Andhra Pradesh_tirupati (published_map) | Karnataka_Bangalore |
| Ex Depot | HPL | Lucknow | re-pointed | Uttar Pradesh_Varanasi (published_map) | Uttar Pradesh_Kanpur |
| Ex Depot | HPL | Mandsaur | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Depot | HPL | Meerut | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Depot | HPL | Muzaffarnagar | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Depot | HPL | Neemuch | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Depot | HPL | Ratlam | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Depot | HPL | Saharanpur | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Depot | HPL | Sambalpur | re-pointed | Orissa_Barhgarh (published_map) | Orissa_Bargarh |
| Ex Depot | HPL | Srikakulam | re-pointed | Telangana_Hyderabad (published_map) | Andhra Pradesh_Vizag |
| Ex Depot | HPL | Surendranagar | re-pointed | Gujarat_Surat (published_map) | Gujarat_Ahmedabad |
| Ex Depot | HPL | Ujjain | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Works | HMEL | Bhubaneswar | removed (was wrong; now "not published") | Balasore (inferred_via_hpl) | — |
| Ex Works | HMEL | Burhanpur | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | HMEL | Dhar | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | HMEL | Etawah | re-pointed | Varanasi (inferred_via_hpl) | Kanpur |
| Ex Works | HMEL | Fatehpur | re-pointed | Varanasi (inferred_via_hpl) | Kanpur |
| Ex Works | HMEL | Ghazipur | re-pointed | Panipat (inferred_via_hpl) | Varanasi |
| Ex Works | HMEL | Gorakhpur | re-pointed | Panipat (inferred_via_hpl) | Varanasi |
| Ex Works | HMEL | Kakinada | removed (was wrong; now "not published") | Hyderabad (inferred_via_hpl) | — |
| Ex Works | HMEL | Kheda | re-pointed | Surat (inferred_via_hpl) | Ahmedabad |
| Ex Works | HMEL | Kolar | added | — | Bengaluru |
| Ex Works | HMEL | Lucknow | re-pointed | Varanasi (inferred_via_hpl) | Kanpur |
| Ex Works | HMEL | Mandsaur | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | HMEL | Neemuch | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | HMEL | Ratlam | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | HMEL | Sambalpur | added | — | Bargarh |
| Ex Works | HMEL | Srikakulam | removed (was wrong; now "not published") | Hyderabad (inferred_via_hpl) | — |
| Ex Works | HMEL | Surendranagar | re-pointed | Surat (inferred_via_hpl) | Ahmedabad |
| Ex Works | HMEL | Ujjain | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | HPL | Burhanpur | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Works | HPL | Cuttack | re-pointed | Orissa_Balasore (published_map) | Orissa_Bhubaneswar |
| Ex Works | HPL | Dhar | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Works | HPL | Etawah | re-pointed | Uttar Pradesh_Varanasi (published_map) | Uttar Pradesh_Kanpur |
| Ex Works | HPL | Fatehpur | re-pointed | Uttar Pradesh_Varanasi (published_map) | Uttar Pradesh_Kanpur |
| Ex Works | HPL | Fazilka | re-pointed | Uttarakhand_Haridwar (published_map) | Punjab_Ludhiana |
| Ex Works | HPL | Gaziabad/Noida | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Works | HPL | Ghazipur | re-pointed | Haryana_Panipat (published_map) | Uttar Pradesh_Varanasi |
| Ex Works | HPL | Gorakhpur | re-pointed | Haryana_Panipat (published_map) | Uttar Pradesh_Varanasi |
| Ex Works | HPL | Kakinada | re-pointed | Telangana_Hyderabad (published_map) | Andhra Pradesh_Vizag |
| Ex Works | HPL | Kheda | re-pointed | Gujarat_Surat (published_map) | Gujarat_Ahmedabad |
| Ex Works | HPL | Kolar | re-pointed | Andhra Pradesh_tirupati (published_map) | Karnataka_Bangalore |
| Ex Works | HPL | Lucknow | re-pointed | Uttar Pradesh_Varanasi (published_map) | Uttar Pradesh_Kanpur |
| Ex Works | HPL | Mandsaur | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Works | HPL | Meerut | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Works | HPL | Muzaffarnagar | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Works | HPL | Neemuch | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Works | HPL | Ratlam | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Works | HPL | Saharanpur | re-pointed | Uttar Pradesh_Mathura (published_map) | Uttar Pradesh_Noida |
| Ex Works | HPL | Sambalpur | re-pointed | Orissa_Barhgarh (published_map) | Orissa_Bargarh |
| Ex Works | HPL | Srikakulam | re-pointed | Telangana_Hyderabad (published_map) | Andhra Pradesh_Vizag |
| Ex Works | HPL | Surendranagar | re-pointed | Gujarat_Surat (published_map) | Gujarat_Ahmedabad |
| Ex Works | HPL | Ujjain | re-pointed | Madhya Pradesh_Bhopal (published_map) | Madhya Pradesh_Indore |
| Ex Works | IOCL | Bhubaneswar | removed (was wrong; now "not published") | Balasore (inferred_via_hpl) | — |
| Ex Works | IOCL | Burhanpur | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | IOCL | Dhar | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | IOCL | Etawah | added | — | Kanpur |
| Ex Works | IOCL | Fatehpur | added | — | Kanpur |
| Ex Works | IOCL | Fazilka | re-pointed | Haridwar (inferred_via_hpl) | Ludhiana |
| Ex Works | IOCL | Ghazipur | removed (was wrong; now "not published") | Panipat (inferred_via_hpl) | — |
| Ex Works | IOCL | Gorakhpur | removed (was wrong; now "not published") | Panipat (inferred_via_hpl) | — |
| Ex Works | IOCL | Kakinada | added | — | Visak |
| Ex Works | IOCL | Kheda | re-pointed | Surat (inferred_via_hpl) | Ahmedabad |
| Ex Works | IOCL | Kolar | added | — | Bangalore |
| Ex Works | IOCL | Lucknow | added | — | Kanpur |
| Ex Works | IOCL | Mandsaur | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | IOCL | Meerut | removed (was wrong; now "not published") | Mathura (inferred_via_hpl) | — |
| Ex Works | IOCL | Muzaffarnagar | removed (was wrong; now "not published") | Mathura (inferred_via_hpl) | — |
| Ex Works | IOCL | Neemuch | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | IOCL | Ratlam | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | IOCL | Saharanpur | removed (was wrong; now "not published") | Mathura (inferred_via_hpl) | — |
| Ex Works | IOCL | Sambalpur | added | — | Bargarh |
| Ex Works | IOCL | Srikakulam | added | — | Visak |
| Ex Works | IOCL | Surendranagar | re-pointed | Surat (inferred_via_hpl) | Ahmedabad |
| Ex Works | IOCL | Ujjain | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | OPaL | Bhubaneswar | removed (was wrong; now "not published") | Balasore (inferred_via_hpl) | — |
| Ex Works | OPaL | Burhanpur | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | OPaL | Dhar | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | OPaL | Etawah | re-pointed | Varanasi (inferred_via_hpl) | Kanpur |
| Ex Works | OPaL | Fatehpur | re-pointed | Varanasi (inferred_via_hpl) | Kanpur |
| Ex Works | OPaL | Fazilka | added | — | Ludhiana |
| Ex Works | OPaL | Ghazipur | re-pointed | Panipat (inferred_via_hpl) | Varanasi |
| Ex Works | OPaL | Gorakhpur | re-pointed | Panipat (inferred_via_hpl) | Varanasi |
| Ex Works | OPaL | Kakinada | removed (was wrong; now "not published") | Hyderabad (inferred_via_hpl) | — |
| Ex Works | OPaL | Kheda | re-pointed | Surat (inferred_via_hpl) | Ahmedabad |
| Ex Works | OPaL | Kolar | added | — | Bengaluru |
| Ex Works | OPaL | Lucknow | re-pointed | Varanasi (inferred_via_hpl) | Kanpur |
| Ex Works | OPaL | Mandsaur | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | OPaL | Neemuch | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | OPaL | Ratlam | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | OPaL | Sambalpur | added | — | Bargarh |
| Ex Works | OPaL | Srikakulam | removed (was wrong; now "not published") | Hyderabad (inferred_via_hpl) | — |
| Ex Works | OPaL | Surendranagar | re-pointed | Surat (inferred_via_hpl) | Ahmedabad |
| Ex Works | OPaL | Ujjain | re-pointed | Bhopal (inferred_via_hpl) | Indore |
| Ex Works | RIL | Bhubaneswar | removed (was wrong; now "not published") | BALASORE (inferred_via_hpl) | — |
| Ex Works | RIL | Burhanpur | re-pointed | BHOPAL (inferred_via_hpl) | INDORE |
| Ex Works | RIL | Dhar | re-pointed | BHOPAL (inferred_via_hpl) | INDORE |
| Ex Works | RIL | Etawah | re-pointed | VARANASI (inferred_via_hpl) | KANPUR |
| Ex Works | RIL | Faridabad | removed (was wrong; now "not published") | DELHI (inferred_via_hpl) | — |
| Ex Works | RIL | Fatehpur | re-pointed | VARANASI (inferred_via_hpl) | KANPUR |
| Ex Works | RIL | Fazilka | added | — | LUDHIANA |
| Ex Works | RIL | Ghazipur | re-pointed | PANIPAT (inferred_via_hpl) | VARANASI |
| Ex Works | RIL | Gorakhpur | re-pointed | PANIPAT (inferred_via_hpl) | VARANASI |
| Ex Works | RIL | Kakinada | removed (was wrong; now "not published") | HYDERABAD (inferred_via_hpl) | — |
| Ex Works | RIL | Kheda | re-pointed | SURAT (inferred_via_hpl) | AHMEDABAD |
| Ex Works | RIL | Kolar | added | — | BENGALURU |
| Ex Works | RIL | Lucknow | re-pointed | VARANASI (inferred_via_hpl) | KANPUR |
| Ex Works | RIL | Mandsaur | re-pointed | BHOPAL (inferred_via_hpl) | INDORE |
| Ex Works | RIL | Neemuch | re-pointed | BHOPAL (inferred_via_hpl) | INDORE |
| Ex Works | RIL | Ratlam | re-pointed | BHOPAL (inferred_via_hpl) | INDORE |
| Ex Works | RIL | Sambalpur | added | — | BARGARH |
| Ex Works | RIL | Srikakulam | removed (was wrong; now "not published") | HYDERABAD (inferred_via_hpl) | — |
| Ex Works | RIL | Surendranagar | re-pointed | SURAT (inferred_via_hpl) | AHMEDABAD |
| Ex Works | RIL | Ujjain | re-pointed | BHOPAL (inferred_via_hpl) | INDORE |

## Freight destination changes (17): these change a landed price

Freight for a town follows the destination the town resolves to. A wrong hub meant a wrong freight rate.

| Producer | Town | Was (Rs/MT) | Now (Rs/MT) | Change Rs/MT |
|---|---|---|---|---|
| GAIL | Bhubaneswar | BALASORE @ 2,995 | — @ — | freight now a gap |
| HMEL | Bhubaneswar | Balasore @ 5,400 | — @ — | freight now a gap |
| HMEL | Ghazipur | Panipat @ 1,130 | Varanasi @ 3,380 | +2,250 |
| HMEL | Neemuch | Bhopal @ 2,660 | Indore @ 2,370 | -290 |
| HPL | Bhubaneswar | BALASORE @ 1,044 | — @ — | freight now a gap |
| HPL | Cuttack | BALASORE @ 1,044 | — @ — | freight now a gap |
| HPL | Fazilka | HARIDWAR @ 3,553 | LUDHIANA @ 3,614 | +61 |
| HPL | Ghazipur | PANIPAT @ 3,441 | VARANASI @ 2,383 | -1,058 |
| HPL | Lucknow | VARANASI @ 2,383 | KANPUR @ 2,507 | +124 |
| HPL | Meerut | MATHURA @ 3,274 | NOIDA @ 3,248 | -26 |
| HPL | Muzaffarnagar | MATHURA @ 3,274 | NOIDA @ 3,248 | -26 |
| HPL | Sambalpur | — @ — | BARGARH @ 1,797 | freight newly available |
| OPaL | Fazilka | Haridwar @ 3,598 | Ludhiana @ 3,365 | -233 |
| OPaL | Ghazipur | Panipat @ 2,980 | Varanasi @ 3,758 | +777 |
| OPaL | Kheda | Surat @ 595 | Ahmedabad @ 825 | +230 |
| OPaL | Lucknow | Varanasi @ 3,758 | Kanpur @ 3,076 | -681 |
| OPaL | Sambalpur | — @ — | Bargarh @ 3,461 | freight newly available |
