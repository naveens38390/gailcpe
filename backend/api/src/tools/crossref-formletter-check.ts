/**
 * Verify the cross-reference form-letter rule.
 *
 * GAIL's sheet names a grade with the form letter it ships as (B52A003A);
 * the cross-reference master names the grade (B52A003). Before this rule,
 * 23 of GAIL's 53 grades matched no row at all and were quoted "GAIL only"
 * everywhere, while their NA variants — which `additiveBaseOf` did reconcile —
 * quoted all six producers off the same row.
 *
 * Three things are checked, because the value of the rule is worth less than
 * the guarantee that it is safe:
 *
 *   1. SAFETY   no grade that already resolved now resolves differently.
 *   2. AMBIGUITY no grade the rule fires on has a competing row of its own,
 *                and no two sheet grades collapse onto one another.
 *   3. VALUE    what it unlocks, measured through core/pricing.compare.
 *
 * Read-only.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/crossref-formletter-check.ts
 */

import { readFileSync } from "node:fs";
import { compare, crossRefFor, formBaseOf, additiveBaseOf, normaliseGrade, useSpellings, type Dataset } from "../core/pricing";

const N = "D:/Gail2/gailcpe/backend/data/normalized";
const priceIndex = JSON.parse(readFileSync(`${N}/price_index.json`, "utf8"));
const crossref = JSON.parse(readFileSync(`${N}/crossref.json`, "utf8"));
const discounts = JSON.parse(readFileSync(`${N}/discounts.json`, "utf8"));
const freight = JSON.parse(readFileSync(`${N}/freight.json`, "utf8"));
const locations = JSON.parse(readFileSync(`${N}/locations.json`, "utf8"));
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

const grades: string[] = Object.keys((Object.values(priceIndex.producers.GAIL.zones)[0] as any) ?? {});
const canon: string[] = locations.canonical;
const keys = Object.keys(crossref.index);
const n = (v: number) => v.toLocaleString("en-IN");

/** crossRefFor as it behaved before the rule, for the before/after comparison. */
function crossRefBefore(grade: string) {
  const direct = crossref.index[grade];
  if (direct) return direct;
  const folded = normaliseGrade(grade);
  const exact = keys.find((k) => normaliseGrade(k) === folded);
  if (exact) return crossref.index[exact];
  const base = additiveBaseOf(grade);
  if (!base) return undefined;
  const key = keys.find((k) => normaliseGrade(k) === base);
  return key ? crossref.index[key] : undefined;
}

console.log("=".repeat(84));
console.log("CROSS-REFERENCE FORM-LETTER RULE");
console.log("=".repeat(84));

// ---- 1. safety -----------------------------------------------------------
let unchanged = 0, gained = 0, altered = 0;
const gainedList: string[] = [], alteredList: string[] = [];
for (const g of grades) {
  const before = crossRefBefore(g), after = crossRefFor(data, g);
  if (before === after) { unchanged++; continue; }
  if (before === undefined && after !== undefined) { gained++; gainedList.push(g); continue; }
  altered++; alteredList.push(g);
}
console.log(`\n1. SAFETY`);
console.log(`   grades whose row is unchanged : ${unchanged}`);
console.log(`   grades that gained a row      : ${gained}`);
console.log(`   grades whose row CHANGED      : ${altered}${altered ? "  <-- must be zero" : "  (none, as intended)"}`);
for (const a of alteredList) console.log(`     ${a}`);

// ---- 2. ambiguity --------------------------------------------------------
console.log(`\n2. AMBIGUITY`);
const ownRow: string[] = [], collisions: string[] = [];
for (const g of gainedList) {
  const folded = normaliseGrade(g);
  if (keys.some((k) => normaliseGrade(k) === folded)) ownRow.push(g);
}
// Two sheet grades must not fold onto the same base.
const byBase = new Map<string, string[]>();
for (const g of grades) {
  const b = formBaseOf(g);
  if (!b) continue;
  (byBase.get(b) ?? byBase.set(b, []).get(b)!).push(g);
}
for (const [b, gs] of byBase) if (gs.length > 1) collisions.push(`${b} <- ${gs.join(" , ")}`);
// A grade the rule fires on must not also be a real, separately priced grade.
const shadowed = gainedList.filter((g) => {
  const b = formBaseOf(g);
  return b !== null && grades.some((o) => normaliseGrade(o) === b);
});
console.log(`   grades that had a row of their own : ${ownRow.length}${ownRow.length ? " <-- rule should not have fired" : ""}`);
console.log(`   two sheet grades folding onto one  : ${collisions.length}`);
for (const c of collisions) console.log(`     ${c}`);
console.log(`   base is itself a priced sheet grade: ${shadowed.length}${shadowed.length ? " — " + shadowed.join(" ") : ""}`);

// ---- 3. value ------------------------------------------------------------
console.log(`\n3. VALUE  (${grades.length} grades x ${canon.length} locations, 120 MT cash)`);
let evaluated = 0, withCompetitor = 0, leaderShown = 0;
const dead = new Set<string>();
for (const g of grades) {
  let any = false;
  for (const loc of canon) {
    let c: any;
    try { c = compare(data, g, loc, 120, "cash"); } catch { continue; }
    evaluated++;
    if (c.quotes.some((q: any) => q.producer !== "GAIL" && q.invoiceLanded !== null)) { withCompetitor++; any = true; }
    if (c.leader?.producer) leaderShown++;
  }
  if (!any) dead.add(g);
}
console.log(`   comparisons evaluated              : ${n(evaluated)}`);
console.log(`   with at least one competitor priced: ${n(withCompetitor)}  (${(100 * withCompetitor / evaluated).toFixed(1)}%)`);
console.log(`   a leader is shown                  : ${n(leaderShown)}`);
console.log(`   grades with no competitor anywhere : ${dead.size}  ${[...dead].join(" ")}`);
console.log(`\n   grades revived by the rule (${gained}):`);
console.log(`     ${gainedList.join(" ")}`);

// ---- a worked example ----------------------------------------------------
console.log(`\n4. WORKED EXAMPLE — the pair that exposed the defect`);
for (const g of ["B52A003A", "B52A003NA"]) {
  const c: any = compare(data, g, "DELHI", 120, "cash");
  const priced = c.quotes.filter((q: any) => q.invoiceLanded !== null).map((q: any) => q.producer);
  console.log(`   ${g.padEnd(11)} at DELHI  priced=[${priced.join(",")}]  leader=${c.leader?.producer ?? "-"}`);
}
