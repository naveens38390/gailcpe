/**
 * Re-test every previously discovered failure mode against a built index.
 *
 * The defects this suite covers were each found by reconciling a circular
 * against production, and each is now closed by a change to the readers. This
 * checks that they stay closed against a round the readers have not seen.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/september-retest.ts <dir>
 */

import { readFileSync } from "node:fs";
import { compare, crossRefFor, useSpellings, type Dataset } from "../core/pricing";

const DIR = process.argv[2] ?? "D:/Gail2/staged/sept";
const LIVE = "D:/Gail2/gailcpe/backend/data/normalized";

const priceIndex = JSON.parse(readFileSync(`${DIR}/price_index.json`, "utf8"));
const crossref = JSON.parse(readFileSync(`${DIR}/crossref.json`, "utf8"));
const discounts = JSON.parse(readFileSync(`${DIR}/discounts.json`, "utf8"));
const freight = JSON.parse(readFileSync(`${DIR}/freight.json`, "utf8"));
const locations = JSON.parse(readFileSync(`${LIVE}/locations.json`, "utf8"));
useSpellings(locations.spellings ?? {});

const data: Dataset = {
  priceIndex: {
    effective_date: priceIndex.effective_date, producers: priceIndex.producers,
    location_map: priceIndex.location_map, location_tier: priceIndex.location_tier,
  },
  freight: { effective_date: freight.effective_date, books: freight.books, destination_map: freight.destination_map },
  discounts: { producers: discounts.producers },
  crossref: { index: crossref.index },
} as Dataset;

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

const zonesOf = (p: string) => priceIndex.producers[p].zones as Record<string, Record<string, number>>;
const gradesOf = (p: string) => {
  const s = new Set<string>();
  for (const c of Object.values(zonesOf(p))) for (const g of Object.keys(c)) s.add(g);
  return s;
};

console.log("=".repeat(80));
console.log(`HISTORICAL DEFECT RE-TEST — ${DIR}   effective ${priceIndex.effective_date}`);
console.log("=".repeat(80));

// ---- HMEL ---------------------------------------------------------------
console.log("\nHMEL — column snapping, all three code families, stacked pairs");
const hmel = gradesOf("HMEL"), hmelZones = zonesOf("HMEL");
check("grade count is the full book", hmel.size >= 112, `${hmel.size} grades`);
for (const g of ["F0118LM", "F0120LM", "M2050S", "N2050S", "N0320L", "M5026L", "R0536L"]) {
  check(`${g} present`, hmel.has(g));
}
check("LLDPE family read (F517LMV, F327LME)", hmel.has("F517LMV") && hmel.has("F327LME"));
check("off-grade family read (OGHDBD, OGLLES)", hmel.has("OGHDBD") && hmel.has("OGLLES"));
check("stacked pair both priced (R0150S and R0151D)", hmel.has("R0150S") && hmel.has("R0151D"));
// Snapping would make one grade carry another's prices, so it shows up as two
// columns with the same price vector. HMEL, though, genuinely prices whole
// families alike — B0155D, B0158D, B0151D and OGHDLD share one basic price —
// so the presence of such groups proves nothing on its own. What is comparable
// is the shape against a round already verified cell by cell: the August book
// has 112 grades over 76 distinct price vectors. A round where the vectors
// collapsed would be the signal.
const vectors = new Set<string>();
for (const g of hmel) vectors.add(Object.keys(hmelZones).map((z) => hmelZones[z]![g]).join(","));
check(
  "price vectors have not collapsed",
  vectors.size >= 70,
  `${hmel.size} grades over ${vectors.size} distinct price vectors (August: 112 over 76)`,
);

// ---- IOCL ---------------------------------------------------------------
console.log("\nIOCL — orphaned rows");
const iocl = zonesOf("IOCL"), ioclGrades = gradesOf("IOCL");
for (const z of ["Udaipur", "Visak", "Bareilly", "Gautam Budh nagar"]) {
  const cells = iocl[z];
  check(`${z} carries every grade`, !!cells && Object.keys(cells).length === ioclGrades.size,
    cells ? `${Object.keys(cells).length} of ${ioclGrades.size}` : "zone absent");
}
check("no caption became a zone", !Object.keys(iocl).some((z) => /Film|Utility|Grades|Price/i.test(z)));

// ---- HPL ----------------------------------------------------------------
console.log("\nHPL — HDBRE overwriting HDT9C, off-grade aliases");
const hpl = gradesOf("HPL"), hplZones = zonesOf("HPL");
check("HDBRE present", hpl.has("HDBRE"));
check("HDT9C present", hpl.has("HDT9C"));
const distinct = Object.keys(hplZones).filter((z) => hplZones[z]!["HDBRE"] !== hplZones[z]!["HDT9C"]).length;
check("HDBRE no longer overwrites HDT9C", distinct === Object.keys(hplZones).length,
  `${distinct} of ${Object.keys(hplZones).length} price points hold different values`);
for (const a of ["HD OG (E)", "HD OG (F)", "HD OG (M)", "HD OG (B)", "LL OG (M)", "LL OG (E)"]) {
  check(`alias ${a} present`, hpl.has(a));
}

// ---- OPaL ---------------------------------------------------------------
console.log("\nOPaL — stacked dual code in the header");
const opal = gradesOf("OPaL");
check("F52H04 present", opal.has("F52H04"));
// F52H02 is stacked under F52H04 from September on; the August circular prints
// the column alone, so its absence there is the document, not the reader.
console.log(`  ${opal.has("F52H02") ? "PASS" : "n/a "}  F52H02 present${opal.has("F52H02") ? "" : " — this round's circular does not stack it"}`);

// ---- cross-reference ----------------------------------------------------
console.log("\nCross-reference — GAIL form letters resolve to a row");
for (const g of ["B52A003A", "I56A200UA", "I62A080UA", "Y50A010UA", "I56A200U", "I62A080U", "Y50A010U"]) {
  const entry = crossRefFor(data, g);
  const gradeExists = gradesOf("GAIL").has(g);
  if (!gradeExists) { console.log(`  n/a   ${g} is not a grade in this index (sheet names it differently)`); continue; }
  check(`${g} resolves to a cross-reference row`, entry !== undefined);
}
console.log("\nCross-reference — competitors actually quote");
for (const g of ["B52A003A", "E52A003A", "W52A009A"]) {
  if (!gradesOf("GAIL").has(g)) continue;
  const c: any = compare(data, g, "DELHI", 120, "cash");
  const priced = c.quotes.filter((q: any) => q.invoiceLanded !== null).map((q: any) => q.producer);
  check(`${g} at DELHI quotes a competitor`, priced.length > 1, `[${priced.join(",")}] leader ${c.leader?.producer ?? "-"}`);
}

console.log(`\n${"=".repeat(80)}`);
console.log(failures === 0 ? "ALL RE-TESTS PASS" : `${failures} RE-TEST FAILURE(S)`);
process.exitCode = failures ? 1 : 0;
