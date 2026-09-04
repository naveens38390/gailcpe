/**
 * The audit baseline: what the six-producer price audit and its fixes changed,
 * measured in one place so the build can be tagged against it.
 *
 * Compares the live system — production data read by the pre-fix engine —
 * against the corrected system, and records the six things worth pinning:
 *
 *   1. price index row counts by producer
 *   2. cross-reference coverage
 *   3. quotable comparisons
 *   4. leader and cheapest-supplier changes
 *   5. freight package checksums
 *   6. byte-diff of every non-target output
 *
 * The corrected data is read from a staging directory, never from
 * data/normalized, so running this cannot publish anything.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/audit-baseline.ts [stagedDir]
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { compare, crossRefFor, normaliseGrade, additiveBaseOf, useSpellings, type Dataset } from "../core/pricing";

const LIVE = "D:/Gail2/gailcpe/backend/data/normalized";
const STAGED = process.argv[2] ?? "D:/Gail2/staged/etl-dryrun";
const REPORT = "D:/Gail2/audit-baseline.txt";

const load = (dir: string, name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
const livePrices = load(LIVE, "price_index");
const fixedPrices = load(STAGED, "price_index");
const crossref = load(LIVE, "crossref");
const discounts = load(LIVE, "discounts");
const freight = load(LIVE, "freight");
const locations = load(LIVE, "locations");
useSpellings(locations.spellings ?? {});

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const n = (v: number) => v.toLocaleString("en-IN");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

const grades: string[] = Object.keys((Object.values(livePrices.producers.GAIL.zones)[0] as any) ?? {});
const canon: string[] = locations.canonical;
const keys = Object.keys(crossref.index);

/**
 * The cross-reference index as the pre-fix engine effectively saw it.
 *
 * crossRefFor cannot be un-fixed in place, so the old behaviour is reproduced
 * by giving the new code an index in which every grade the old rules resolved
 * is keyed by its own name, and nothing else is present. Direct lookup then
 * hits exactly the grades that used to resolve, and the form-letter fallback
 * has no base left to find for the ones that did not.
 */
function preFixIndex(): Record<string, any> {
  const before: Record<string, any> = {};
  for (const g of grades) {
    const direct = crossref.index[g];
    if (direct) { before[g] = direct; continue; }
    const folded = normaliseGrade(g);
    const exact = keys.find((k) => normaliseGrade(k) === folded);
    if (exact) { before[g] = crossref.index[exact]; continue; }
    const base = additiveBaseOf(g);
    if (!base) continue;
    const key = keys.find((k) => normaliseGrade(k) === base);
    if (key) before[g] = crossref.index[key];
  }
  return before;
}

function dataset(priceIndex: any, index: Record<string, any>): Dataset {
  return {
    priceIndex: {
      effective_date: priceIndex.effective_date, producers: priceIndex.producers,
      location_map: priceIndex.location_map, location_tier: priceIndex.location_tier,
    },
    freight: { effective_date: freight.effective_date, books: freight.books, destination_map: freight.destination_map },
    discounts: { producers: discounts.producers },
    crossref: { index },
  } as Dataset;
}

interface Tally {
  evaluated: number; withCompetitor: number; leaderShown: number;
  leader: Map<string, string | null>; cheapest: Map<string, string | null>;
  perProducer: Record<string, number>;
}

function tally(d: Dataset): Tally {
  const t: Tally = { evaluated: 0, withCompetitor: 0, leaderShown: 0, leader: new Map(), cheapest: new Map(), perProducer: {} };
  for (const g of grades) {
    for (const loc of canon) {
      let c: any;
      try { c = compare(d, g, loc, 120, "cash"); } catch { continue; }
      t.evaluated++;
      const others = c.quotes.filter((q: any) => q.producer !== "GAIL" && q.invoiceLanded !== null);
      if (others.length) t.withCompetitor++;
      for (const q of others) t.perProducer[q.producer] = (t.perProducer[q.producer] ?? 0) + 1;
      if (c.leader?.producer) t.leaderShown++;
      const key = `${g}|${loc}`;
      t.leader.set(key, c.leader?.producer ?? null);
      const cheap = c.quotes.filter((q: any) => q.invoiceLanded !== null)
        .sort((x: any, y: any) => x.invoiceLanded - y.invoiceLanded)[0]?.producer ?? null;
      t.cheapest.set(key, cheap);
    }
  }
  return t;
}

function main() {
  say("=".repeat(88));
  say("GCPE AUDIT BASELINE");
  say("=".repeat(88));
  say(`live data   : ${LIVE}`);
  say(`fixed data  : ${STAGED}`);
  say(`effective   : ${livePrices.effective_date}  ->  ${fixedPrices.effective_date}`);

  // ---- 1. price index row counts by producer ------------------------------
  say(`\n${"-".repeat(88)}\n1. PRICE INDEX ROW COUNTS BY PRODUCER\n${"-".repeat(88)}`);
  say(`  ${"producer".padEnd(8)}${"zones".padStart(7)}${"live".padStart(10)}${"fixed".padStart(10)}${"delta".padStart(9)}   status`);
  let liveTotal = 0, fixedTotal = 0;
  for (const p of Object.keys(livePrices.producers)) {
    const lz = livePrices.producers[p].zones, fz = fixedPrices.producers[p].zones;
    const lc = Object.values(lz).reduce((t: number, c: any) => t + Object.keys(c).length, 0);
    const fc = Object.values(fz).reduce((t: number, c: any) => t + Object.keys(c).length, 0);
    liveTotal += lc; fixedTotal += fc;
    const identical = JSON.stringify(lz) === JSON.stringify(fz);
    const counts = new Set(Object.values(fz).map((c: any) => Object.keys(c).length));
    const shape = counts.size === 1 ? `complete ${Object.keys(fz).length}x${[...counts][0]}` : `ragged (${[...counts].sort((a: any, b: any) => a - b).join("/")})`;
    say(`  ${p.padEnd(8)}${String(Object.keys(fz).length).padStart(7)}${n(lc).padStart(10)}${n(fc).padStart(10)}${(fc - lc ? `+${n(fc - lc)}` : "-").padStart(9)}   ${identical ? "unchanged" : "CHANGED"}, ${shape}`);
  }
  say(`  ${"TOTAL".padEnd(8)}${"".padStart(7)}${n(liveTotal).padStart(10)}${n(fixedTotal).padStart(10)}${("+" + n(fixedTotal - liveTotal)).padStart(9)}`);

  // ---- 2. cross-reference coverage ----------------------------------------
  const before = preFixIndex();
  const resolvedBefore = grades.filter((g) => before[g] !== undefined).length;
  const xr: any = { crossref: { index: crossref.index } };
  const resolvedAfter = grades.filter((g) => crossRefFor(xr, g) !== undefined).length;
  say(`\n${"-".repeat(88)}\n2. CROSS-REFERENCE COVERAGE\n${"-".repeat(88)}`);
  say(`  GAIL grades in the index          : ${grades.length}`);
  say(`  resolving to a row, pre-fix       : ${resolvedBefore}  (${(100 * resolvedBefore / grades.length).toFixed(1)}%)`);
  say(`  resolving to a row, fixed         : ${resolvedAfter}  (${(100 * resolvedAfter / grades.length).toFixed(1)}%)`);
  say(`  grades revived                    : ${resolvedAfter - resolvedBefore}`);

  // ---- 3/4. quotable comparisons, leader and cheapest changes -------------
  const liveT = tally(dataset(livePrices, before));
  const fixedT = tally(dataset(fixedPrices, crossref.index));
  // A "change" is three different things and they must not be added together:
  // a leader appearing where the grid was blank is coverage, a leader changing
  // hands is a competitive reversal, and one disappearing would be a
  // regression. Reported separately, because the reversals are the number a
  // sales team would act on and they are a small fraction of the total.
  const split = (a: Map<string, string | null>, b: Map<string, string | null>) => {
    let appeared = 0, vanished = 0, switched = 0;
    for (const [k, after] of b) {
      const before = a.get(k) ?? null;
      if (before === after) continue;
      if (before === null) appeared++;
      else if (after === null) vanished++;
      else switched++;
    }
    return { appeared, vanished, switched };
  };
  const leaderSplit = split(liveT.leader, fixedT.leader);
  const cheapestSplit = split(liveT.cheapest, fixedT.cheapest);
  // The direction that matters commercially: a comparison the system used to
  // call for GAIL, where a competitor is in fact cheaper.
  let lostFromGail = 0, wonForGail = 0;
  for (const [k, after] of fixedT.cheapest) {
    const before = liveT.cheapest.get(k) ?? null;
    if (before === after) continue;
    if (before === "GAIL" && after !== null && after !== "GAIL") lostFromGail++;
    if (before !== null && before !== "GAIL" && after === "GAIL") wonForGail++;
  }
  const leaderChanges = leaderSplit.appeared + leaderSplit.vanished + leaderSplit.switched;
  const cheapestChanges = cheapestSplit.appeared + cheapestSplit.vanished + cheapestSplit.switched;

  say(`\n${"-".repeat(88)}\n3. QUOTABLE COMPARISONS\n${"-".repeat(88)}`);
  say(`  grid                              : ${grades.length} grades x ${canon.length} locations = ${n(liveT.evaluated)}`);
  say(`  with a competitor priced, live    : ${n(liveT.withCompetitor)}  (${(100 * liveT.withCompetitor / liveT.evaluated).toFixed(1)}%)`);
  say(`  with a competitor priced, fixed   : ${n(fixedT.withCompetitor)}  (${(100 * fixedT.withCompetitor / fixedT.evaluated).toFixed(1)}%)`);
  say(`  gained                            : ${n(fixedT.withCompetitor - liveT.withCompetitor)}`);
  say(`\n  quotable competitor prices, by producer:`);
  for (const p of Object.keys(fixedT.perProducer).sort()) {
    const a = liveT.perProducer[p] ?? 0, b = fixedT.perProducer[p];
    say(`    ${p.padEnd(6)}${n(a).padStart(8)} -> ${n(b).padStart(8)}${(b - a ? `  +${n(b - a)}` : "").padEnd(10)}`);
  }

  say(`\n${"-".repeat(88)}\n4. RANKING CHANGES\n${"-".repeat(88)}`);
  say(`  a leader is shown, live           : ${n(liveT.leaderShown)}`);
  say(`  a leader is shown, fixed          : ${n(fixedT.leaderShown)}`);
  say(`  leader changes                    : ${n(leaderChanges)}`);
  say(`    a leader appears where none was : ${n(leaderSplit.appeared)}  (coverage, not a reversal)`);
  say(`    the leader changes hands        : ${n(leaderSplit.switched)}  <- competitive reversals`);
  say(`    a leader disappears             : ${n(leaderSplit.vanished)}${leaderSplit.vanished ? "  <- would be a regression" : ""}`);
  say(`  cheapest-supplier changes         : ${n(cheapestChanges)}`);
  say(`    appears where none was          : ${n(cheapestSplit.appeared)}`);
  say(`    changes hands                   : ${n(cheapestSplit.switched)}  <- competitive reversals`);
  say(`    disappears                      : ${n(cheapestSplit.vanished)}${cheapestSplit.vanished ? "  <- would be a regression" : ""}`);
  say(`
  of those reversals:`);
  say(`    was GAIL, is a competitor       : ${n(lostFromGail)}  <- the system called these for GAIL wrongly`);
  say(`    was a competitor, is GAIL       : ${n(wonForGail)}`);

  // ---- 5. freight package checksums ---------------------------------------
  say(`\n${"-".repeat(88)}\n5. FREIGHT PACKAGE\n${"-".repeat(88)}`);
  const liveFreight = sha(`${LIVE}/freight.json`), fixedFreight = sha(`${STAGED}/freight.json`);
  say(`  freight.json  live  sha256:${liveFreight}`);
  say(`  freight.json  fixed sha256:${fixedFreight}   ${liveFreight === fixedFreight ? "IDENTICAL — the price fixes do not touch freight" : "CHANGED"}`);
  for (const f of ["freight.corrected.json", "destination-map.regenerated.json", "destination-map.regenerated.delta.json"]) {
    const p = `D:/Gail2/staged/${f}`;
    say(`  ${f.padEnd(38)} ${existsSync(p) ? `sha256:${sha(p)}` : "absent"}`);
  }

  // ---- 6. byte-diff of every non-target output ----------------------------
  say(`\n${"-".repeat(88)}\n6. BYTE-DIFF OF EVERY EMITTED FILE\n${"-".repeat(88)}`);
  for (const f of readdirSync(STAGED).filter((f) => f.endsWith(".json")).sort()) {
    const a = `${LIVE}/${f}`, b = `${STAGED}/${f}`;
    const same = existsSync(a) && readFileSync(a).equals(readFileSync(b));
    say(`  ${f.padEnd(24)} ${same ? "identical" : "CHANGED  "}  sha256:${sha(b)}`);
  }
  say(`\n  Expected to change: price_index.json, prices.json, build_report.json.`);
  say(`  Everything else identical is the check that the fixes stayed in their lane.`);

  writeFileSync(REPORT, out.join("\n"));
  console.log(`\n(written to ${REPORT})`);
}

main();
