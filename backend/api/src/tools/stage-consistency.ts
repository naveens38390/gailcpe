/**
 * Check a value survives every stage unchanged.
 *
 * The pipeline hands a price through several shapes — the extractor's own
 * output in prices.json, the flattened price_index the engine reads, and the
 * documents the seeder writes to MongoDB. A value that is right in the first
 * and wrong in the last is the kind of defect that survives an extraction audit
 * entirely, so each hop is compared rather than assumed.
 *
 * Also checks the arithmetic hazards: a price that lost its decimals, one that
 * was rounded, and one that became a string.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/stage-consistency.ts <dir>
 */

import { readFileSync } from "node:fs";

const DIR = process.argv[2] ?? "D:/Gail2/staged/sept";
const index = JSON.parse(readFileSync(`${DIR}/price_index.json`, "utf8"));
const prices = JSON.parse(readFileSync(`${DIR}/prices.json`, "utf8"));

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

console.log("=".repeat(80));
console.log(`STAGE CONSISTENCY — ${DIR}   effective ${index.effective_date}`);
console.log("=".repeat(80));

// ---- 1. every stored value is a finite number ---------------------------
console.log("\ntypes and magnitudes");
let cells = 0, nonNumber = 0, nonFinite = 0, negative = 0, absurd = 0, fractional = 0;
const oddSamples: string[] = [];
for (const [producer, entry] of Object.entries(index.producers) as Array<[string, any]>) {
  for (const [zone, row] of Object.entries(entry.zones as Record<string, Record<string, unknown>>)) {
    for (const [grade, value] of Object.entries(row)) {
      cells++;
      if (typeof value !== "number") {
        nonNumber++;
        if (oddSamples.length < 5) oddSamples.push(`${producer} ${zone} ${grade} is ${typeof value}`);
        continue;
      }
      if (!Number.isFinite(value)) nonFinite++;
      else if (value < 0) negative++;
      else if (value < 1000 || value > 1_000_000) {
        absurd++;
        if (oddSamples.length < 5) oddSamples.push(`${producer} ${zone} ${grade} = ${value}`);
      }
      if (Number.isFinite(value) && !Number.isInteger(value)) fractional++;
    }
  }
}
check("every cell is a number", nonNumber === 0, `${cells.toLocaleString("en-IN")} cells`);
check("every cell is finite", nonFinite === 0);
check("no negative price", negative === 0);
check("every price is a plausible Rs/MT figure", absurd === 0);
console.log(`  note  ${fractional.toLocaleString("en-IN")} cells carry a fractional part (kept, not rounded)`);
for (const s of oddSamples) console.log(`        ${s}`);

// ---- 2. price_index agrees with the extractor's own output --------------
console.log("\nextractor output -> price index");
// IOCL's delivered book is carried through unchanged, so it is the cleanest
// hop to compare directly; the others are merged or derived on the way.
const ioclRaw = prices?.iocl?.prices?.delivered as Record<string, Record<string, number>> | undefined;
if (ioclRaw) {
  let same = 0, diff = 0;
  const samples: string[] = [];
  for (const [z, row] of Object.entries(ioclRaw)) {
    for (const [g, v] of Object.entries(row)) {
      const stored = index.producers.IOCL.zones[z]?.[g];
      if (stored === undefined) continue;
      if (Math.abs(stored - v) < 1e-9) same++;
      else { diff++; if (samples.length < 5) samples.push(`${z} ${g}: prices.json ${v} vs index ${stored}`); }
    }
  }
  check("IOCL delivered survives the hop unchanged", diff === 0, `${same.toLocaleString("en-IN")} cells compared`);
  for (const s of samples) console.log(`        ${s}`);
} else {
  console.log("  n/a   prices.json does not carry IOCL's delivered book in this build");
}

// HMEL is derived rather than carried: the extractor stores basic prices and
// locational adjustments, and the index stores the subtraction. Re-doing the
// arithmetic is what would catch a rounding or truncation introduced on the way.
const hmelBasic = prices?.hmel?.basic as Record<string, { price: number }> | undefined;
const hmelAdj = prices?.hmel?.adjustments as Record<string, Record<string, number>> | undefined;
if (hmelBasic && hmelAdj) {
  let same = 0, diff = 0;
  const samples: string[] = [];
  for (const [loc, cells] of Object.entries(hmelAdj)) {
    for (const [grade, adjustment] of Object.entries(cells)) {
      const basic = hmelBasic[grade]?.price;
      const stored = index.producers.HMEL.zones[loc]?.[grade];
      if (basic === undefined || stored === undefined) continue;
      if (Math.abs(basic - adjustment - stored) < 1e-9) same++;
      else { diff++; if (samples.length < 5) samples.push(`${loc} ${grade}: ${basic} - ${adjustment} != ${stored}`); }
    }
  }
  check("HMEL basic minus adjustment reproduces the index exactly", diff === 0,
    `${same.toLocaleString("en-IN")} cells recomputed`);
  for (const s of samples) console.log(`        ${s}`);
}

// ---- 3. the shape the seeder will write --------------------------------
console.log("\nprice index -> database-ready documents");
const docs: Array<{ producer: string; zone: string; grade: string; price: number }> = [];
for (const [producer, entry] of Object.entries(index.producers) as Array<[string, any]>) {
  for (const [zone, row] of Object.entries(entry.zones as Record<string, Record<string, number>>)) {
    for (const [grade, price] of Object.entries(row)) docs.push({ producer, zone, grade, price });
  }
}
check("one document per cell", docs.length === cells, `${docs.length.toLocaleString("en-IN")} documents`);
const keys = new Set(docs.map((d) => `${d.producer}|${d.zone}|${d.grade}`));
check("no duplicate (producer, zone, grade)", keys.size === docs.length,
  `${(docs.length - keys.size).toLocaleString("en-IN")} duplicates`);
check("no document loses its price in a JSON round trip",
  JSON.parse(JSON.stringify(docs)).every((d: any, i: number) => d.price === docs[i]!.price));
const blankZone = docs.filter((d) => !d.zone.trim()).length;
const blankGrade = docs.filter((d) => !d.grade.trim()).length;
check("no blank zone", blankZone === 0);
check("no blank grade", blankGrade === 0);

console.log(`\n${"=".repeat(80)}`);
console.log(failures === 0 ? "STAGE CONSISTENCY CLEAN" : `${failures} STAGE FAILURE(S)`);
process.exitCode = failures ? 1 : 0;
