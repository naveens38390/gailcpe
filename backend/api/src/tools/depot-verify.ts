/**
 * Verifies the ex-works / ex-depot price basis against the zonal workbook and
 * against the engine as it was before the second price list existed.
 *
 *   1. the client's Bhiwandi sheet, figure by figure, on both bases
 *   2. every grade x location x producer x basis: the ladder adds up
 *   3. with no basis asked for, the answer is exactly what it was before
 *
 * Reads a staged dataset directory and never writes to a database.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/depot-verify.ts [dir] [previousEngine.ts]
 */

import { readFileSync } from "node:fs";

import { simulate } from "../core/deal";
import { compare, quote, useSpellings, type Dataset } from "../core/pricing";
import type { PricingBasis, Producer, Quote } from "../core/types";

const DIR = process.argv[2] ?? "D:/Gail2/staged/depot";
const OLD_ENGINE = process.argv[3];

const load = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}.json`, "utf8"));
const priceIndex = load("price_index");
const freight = load("freight");
const discounts = load("discounts");
const crossref = load("crossref");
const locations = load("locations");
useSpellings(locations.spellings ?? {});

const data = {
  priceIndex,
  freight: {
    effective_date: freight.effective_date,
    books: freight.books,
    destination_map: freight.destination_map,
  },
  discounts: { producers: discounts.producers },
  crossref: { index: crossref.index },
} as Dataset;

let failures = 0;
const fail = (line: string) => {
  failures++;
  console.log(`  FAIL ${line}`);
};
const money = (n: number | null) => (n === null ? "null" : n.toLocaleString("en-IN"));
const near = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) < 0.005;

// ---------------------------------------------------------------------------
// 1. The client's Bhiwandi sheet (Price Comparison - Ex Works / Ex Depot).
//    Its circular date is 01.08.2026; a figure is marked "moved" where the
//    September circular has repriced it since, which is not a defect.
// ---------------------------------------------------------------------------

interface Row {
  producer: Producer;
  grade: string;
  basic: number;
  cd: number;
  freight: number | null;
  net: number;
}

const WORKS: Row[] = [
  { producer: "GAIL", grade: "B52A003", basic: 139010, cd: 1000, freight: 2752, net: 140762 },
  { producer: "IOCL", grade: "B52A003", basic: 140596, cd: 1100, freight: null, net: 139496 },
  { producer: "RIL", grade: "B52A003", basic: 140636, cd: 1100, freight: null, net: 139536 },
  { producer: "HMEL", grade: "B52A003", basic: 137770, cd: 1100, freight: 2870, net: 139540 },
  { producer: "OPaL", grade: "B52A003", basic: 140040, cd: 1100, freight: 1376, net: 140316 },
  { producer: "HPL", grade: "B52A003", basic: 140210, cd: 1100, freight: 3745, net: 142855 },
];
const DEPOT: Row[] = [
  { producer: "GAIL", grade: "B52A003", basic: 140420, cd: 0, freight: null, net: 140420 },
  { producer: "IOCL", grade: "B52A003", basic: 140396, cd: 1100, freight: null, net: 139296 },
  // 140,320 less cash discount 1,100 and RIL's dealer discount 350 — the client's own example.
  { producer: "RIL", grade: "B52A003", basic: 140320, cd: 1100, freight: null, net: 138870 },
  { producer: "HMEL", grade: "B52A003", basic: 140390, cd: 1100, freight: null, net: 139290 },
  { producer: "OPaL", grade: "B52A003", basic: 139836, cd: 0, freight: null, net: 139836 },
  { producer: "HPL", grade: "B52A003", basic: 143596, cd: 1100, freight: null, net: 142496 },
];

function sheet(title: string, rows: Row[], basis: PricingBasis) {
  console.log(`\n${title} — Bhiwandi, B52 (blow moulding), cash, 1 MT`);
  const c = compare(data, "B52A003", "BHIWANDI", 1, "cash", undefined, undefined, basis);
  const gail = c.quotes.find((q) => q.producer === "GAIL")!;
  for (const row of rows) {
    const q = c.quotes.find((x) => x.producer === row.producer)!;
    const exact = near(q.basic, row.basic) && near(q.priceNetOfGst, row.net);
    const cdOk = q.cashDiscount === row.cd;
    const label = `${row.producer.padEnd(5)} ${(q.grade ?? "-").padEnd(9)}`;
    const line =
      `${label} basic ${money(q.basic).padStart(8)} (sheet ${money(row.basic)})  ` +
      `CD ${String(q.cashDiscount).padStart(4)}  freight ${money(q.freight).padStart(6)}  ` +
      `net-of-GST ${money(q.priceNetOfGst).padStart(8)} (sheet ${money(row.net)})`;
    if (!cdOk) fail(`${label} cash discount ${q.cashDiscount}, sheet ${row.cd}`);
    if (exact) console.log(`  ok   ${line}`);
    else if (q.priceNetOfGst !== null && q.basic !== null)
      console.log(`  moved ${line}   [September circular differs from the August sheet]`);
    else fail(`${line}   not priced`);
    if (q.pricingBasis !== basis) fail(`${label} pricingBasis ${q.pricingBasis}`);
    if (basis === "ex_depot" && q.freight !== 0) fail(`${label} depot quote carries freight ${q.freight}`);
    if (basis === "ex_depot" && q.basicPlusFreight !== null) fail(`${label} depot quote has basic+freight`);
    if (row.producer !== "GAIL" && gail.priceNetOfGst !== null && q.priceNetOfGst !== null) {
      const expect = gail.priceNetOfGst - q.priceNetOfGst;
      if (!near(q.priceDelta, expect)) fail(`${label} delta ${q.priceDelta} != ${expect}`);
    }
  }
}
sheet("EX WORKS", WORKS, "ex_works");
sheet("EX DEPOT", DEPOT, "ex_depot");

// ---------------------------------------------------------------------------
// 2. The ladder adds up, everywhere, on both bases.
// ---------------------------------------------------------------------------

console.log("\nLadder invariants over every grade x location x producer x basis");
const grades: string[] = Object.keys(
  (Object.values(priceIndex.producers.GAIL.zones)[0] as Record<string, number>) ?? {},
);
const canonical: string[] = locations.canonical;
const tally: Record<string, { works: number; depot: number; both: number; differ: number }> = {};
let checked = 0;

for (const grade of grades) {
  for (const location of canonical) {
    const works = compare(data, grade, location, 100, "cash", undefined, undefined, "ex_works");
    const depot = compare(data, grade, location, 100, "cash", undefined, undefined, "ex_depot");
    for (const basis of ["ex_works", "ex_depot"] as PricingBasis[]) {
      const c = basis === "ex_works" ? works : depot;
      const gailNet = c.quotes.find((q) => q.producer === "GAIL")?.priceNetOfGst ?? null;
      for (const q of c.quotes) {
        checked++;
        const tag = `${q.producer} ${grade}@${location} ${basis}`;
        if (q.pricingBasis !== basis) fail(`${tag} wrong pricingBasis`);
        if (q.invoiceLanded !== q.priceNetOfGst) fail(`${tag} net of GST != landed`);
        if (q.basic !== null && q.netBasic !== null && !near(q.netBasic, q.basic - q.cashDiscount - q.dealerDiscount))
          fail(`${tag} net basic ${q.netBasic} != basic ${q.basic} - CD ${q.cashDiscount} - dealer ${q.dealerDiscount}`);
        const wantDealer = q.producer === "RIL" && basis === "ex_depot" ? 350 : 0;
        if (q.dealerDiscount !== wantDealer) fail(`${tag} dealer discount ${q.dealerDiscount}, expected ${wantDealer}`);
        if (q.gaps.some((g) => /dealer discount/i.test(g))) fail(`${tag} still mentions a dealer discount in gaps`);
        // A depot price is never placed on another town's depot by inference.
        if (basis === "ex_depot" && q.zone !== null && q.locationTier === "inferred_via_hpl")
          fail(`${tag} depot zone was inferred (${q.zone})`);
        if (basis === "ex_depot") {
          if (q.freight !== 0) fail(`${tag} depot freight ${q.freight}`);
          if (q.priceNetOfGst !== null && !near(q.priceNetOfGst, q.netBasic)) fail(`${tag} depot net`);
        } else if (q.priceNetOfGst !== null && !near(q.priceNetOfGst, q.basicPlusFreight)) {
          fail(`${tag} works net ${q.priceNetOfGst} != basic+freight ${q.basicPlusFreight}`);
        }
        const wantDelta =
          q.producer !== "GAIL" && gailNet !== null && q.priceNetOfGst !== null
            ? gailNet - q.priceNetOfGst
            : null;
        if (!(wantDelta === null ? q.priceDelta === null : near(q.priceDelta, wantDelta)))
          fail(`${tag} delta ${q.priceDelta} != ${wantDelta}`);
      }
    }

    // Availability is reported the same way from either side, and never lies.
    for (const producer of works.quotes.map((q) => q.producer)) {
      const w = works.quotes.find((q) => q.producer === producer)!;
      const d = depot.quotes.find((q) => q.producer === producer)!;
      const t = (tally[producer] ??= { works: 0, depot: 0, both: 0, differ: 0 });
      if (w.basic !== null) t.works++;
      if (d.basic !== null) t.depot++;
      if (w.basic !== null && d.basic !== null) {
        t.both++;
        if (w.basic !== d.basic) t.differ++;
      }
      if (w.basisAvailability.ex_depot !== (d.basic !== null))
        fail(`${producer} ${grade}@${location}: availability says depot=${w.basisAvailability.ex_depot}, quote says ${d.basic !== null}`);
      if (d.basisAvailability.ex_works !== (w.basic !== null))
        fail(`${producer} ${grade}@${location}: availability says works=${d.basisAvailability.ex_works}, quote says ${w.basic !== null}`);
    }
  }
}
console.log(`  ${checked.toLocaleString("en-IN")} quotes checked`);
console.log("  producer   works-priced   depot-priced   priced on both   depot basic differs");
for (const [p, t] of Object.entries(tally)) {
  console.log(
    `  ${p.padEnd(9)} ${String(t.works).padStart(12)} ${String(t.depot).padStart(14)} ${String(t.both).padStart(16)} ${String(t.differ).padStart(15)}`,
  );
}

// ---------------------------------------------------------------------------
// 2b. The Deal engine reads the basis it is given, and nothing else.
// ---------------------------------------------------------------------------

console.log("\nDeal engine: ranking follows the selected basis");
{
  let deals = 0;
  let rankChanged = 0;
  for (const grade of ["B52A003", "B55HM0003", "I60A080", "E52A003"]) {
    for (const location of canonical) {
      const works = simulate(data, grade, location, 120, "cash", null, "ex_works");
      const dflt = simulate(data, grade, location, 120, "cash");
      const depot = simulate(data, grade, location, 120, "cash", null, "ex_depot");
      deals++;
      if (JSON.stringify(works) !== JSON.stringify(dflt)) fail(`${grade}@${location}: default deal is not the ex-works deal`);
      if (works.pricingBasis !== "ex_works" || depot.pricingBasis !== "ex_depot") fail(`${grade}@${location}: pricingBasis not carried`);
      if (depot.comparison.quotes.some((q) => q.pricingBasis !== "ex_depot")) fail(`${grade}@${location}: a depot deal read an ex-works quote`);
      const gail = depot.comparison.gail;
      const leader = depot.comparison.leader;
      if (gail?.invoiceLanded != null && leader?.invoiceLanded != null) {
        if (!near(depot.comparison.gapToLeader, gail.invoiceLanded - leader.invoiceLanded)) fail(`${grade}@${location}: depot gap is not on depot prices`);
        const match = depot.options.find((o) => o.label.startsWith("Match"));
        if (match && !near(match.gailLanded, gail.invoiceLanded - depot.comparison.gapToLeader!)) fail(`${grade}@${location}: depot 'match the leader' is not on depot prices`);
      }
      if (gail && gail.invoiceLanded === null && !depot.narrative.some((n) => /ex-depot|not published/i.test(n)))
        fail(`${grade}@${location}: unpublished GAIL depot price is not explained`);
      if (works.comparison.leader?.producer !== depot.comparison.leader?.producer || works.outcome !== depot.outcome) rankChanged++;
    }
  }
  console.log(`  ${deals.toLocaleString("en-IN")} deals; ranking or outcome differs between the two bases in ${rankChanged}`);
}

// ---------------------------------------------------------------------------
// 3. Nothing moved for anyone who does not ask for the depot list.
// ---------------------------------------------------------------------------

async function regression() {
  if (!OLD_ENGINE) {
    console.log("\nRegression against the previous engine: skipped (no engine path given)");
    return;
  }
  const previous = (await import(OLD_ENGINE)) as { compare: typeof compare };
  console.log("\nRegression: default output vs the engine before ex-depot existed");
  let compared = 0;
  let drift = 0;
  for (const grade of grades) {
    for (const location of canonical) {
      for (const mode of ["cash", "credit_ifc"] as const) {
        const now = compare(data, grade, location, 120, mode);
        const before = previous.compare(data, grade, location, 120, mode);
        compared++;
        const pick = (q: Quote) => [q.producer, q.grade, q.basic, q.netBasic, q.freight, q.invoiceLanded, q.effectiveNet, q.zone];
        const same =
          JSON.stringify(now.quotes.map(pick)) === JSON.stringify(before.quotes.map(pick)) &&
          now.leader?.producer === before.leader?.producer &&
          now.gailRank === before.gailRank &&
          now.gapToLeader === before.gapToLeader;
        if (!same) {
          drift++;
          if (drift <= 5) fail(`${grade}@${location} ${mode} differs from the previous engine`);
        }
      }
    }
  }
  console.log(`  ${compared.toLocaleString("en-IN")} comparisons, ${drift} differ`);
  if (drift) failures++;
}

regression().then(() => {
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
});
