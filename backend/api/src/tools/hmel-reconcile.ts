/**
 * Reconcile HMEL's circular against the price index production is seeded from.
 *
 * Uses the structural grade dictionary (hmel-grade-dictionary.ts) rather than a
 * code pattern, so all three HMEL grade families are read: the regular HDPE
 * codes, the LLDPE codes with three digits and a three-letter suffix, and the
 * off-grade columns with no digits at all.
 *
 * Reports what is missing, whether anything can reach it, and what a quote
 * would show differently. Read-only — writes a report, changes nothing.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/hmel-reconcile.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { compare, useSpellings, type Dataset } from "../core/pricing";
import { buildIndex, readSections } from "./hmel-grade-dictionary";

const N = "D:/Gail2/gailcpe/backend/data/normalized";
const PDF = process.argv[2] ?? "D:/Gail/HMEL.pdf";
const REPORT = process.argv[3] ?? "D:/Gail2/hmel-reconciliation.txt";

const priceIndex = JSON.parse(readFileSync(`${N}/price_index.json`, "utf8"));
const crossref = JSON.parse(readFileSync(`${N}/crossref.json`, "utf8"));
const discounts = JSON.parse(readFileSync(`${N}/discounts.json`, "utf8"));
const freight = JSON.parse(readFileSync(`${N}/freight.json`, "utf8"));
const locations = JSON.parse(readFileSync(`${N}/locations.json`, "utf8"));
useSpellings(locations.spellings ?? {});

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const n = (v: number) => v.toLocaleString("en-IN");

function dataset(hmelZones: Record<string, Record<string, number>>): Dataset {
  const producers = JSON.parse(JSON.stringify(priceIndex.producers));
  producers.HMEL.zones = hmelZones;
  return {
    priceIndex: {
      effective_date: priceIndex.effective_date, producers,
      location_map: priceIndex.location_map, location_tier: priceIndex.location_tier,
    },
    freight: { effective_date: freight.effective_date, books: freight.books, destination_map: freight.destination_map },
    discounts: { producers: discounts.producers },
    crossref: { index: crossref.index },
  } as Dataset;
}

async function main() {
  const sections = await readSections(PDF);
  const { basic, exWorks } = buildIndex(sections);
  const prod = priceIndex.producers.HMEL.zones as Record<string, Record<string, number>>;

  const mineGrades = new Set(Object.keys(basic));
  const prodGrades = new Set<string>();
  for (const cells of Object.values(prod)) for (const g of Object.keys(cells)) prodGrades.add(g);

  say("=".repeat(88));
  say("HMEL RECONCILIATION — circular against the production price index");
  say("=".repeat(88));
  say(`sections read                : ${sections.length}`);
  say(`grade columns in the circular: ${sections.filter((s) => s.place === "bathinda").reduce((t, s) => t + s.columns.length, 0)}`);
  say(`distinct grades in circular  : ${mineGrades.size}`);
  say(`distinct grades in production: ${prodGrades.size}`);
  say(`locations in circular        : ${Object.keys(exWorks).length}`);
  say(`locations in production      : ${Object.keys(prod).length}`);

  // ---- 1. missing grades -------------------------------------------------
  const missingGrades = [...mineGrades].filter((g) => !prodGrades.has(g)).sort();
  const extraGrades = [...prodGrades].filter((g) => !mineGrades.has(g)).sort();
  const family = (g: string) => (g.startsWith("OG") ? "off-grade" : /^[A-Z]\d{4}[A-Z]{1,2}$/.test(g) ? "standard" : "irregular");
  const byFamily: Record<string, string[]> = {};
  for (const g of missingGrades) (byFamily[family(g)] ??= []).push(g);

  say(`\n${"-".repeat(88)}`);
  say(`1. GRADES IN THE CIRCULAR BUT NOT IN PRODUCTION: ${missingGrades.length}`);
  say("-".repeat(88));
  for (const [f, list] of Object.entries(byFamily)) {
    say(`  ${f} (${list.length}): ${list.join(" ")}`);
  }
  if (extraGrades.length) say(`\n  in production but not read from the circular (${extraGrades.length}): ${extraGrades.join(" ")}`);

  // ---- 2. missing prices -------------------------------------------------
  let cellsMine = 0, cellsProd = 0, cellsMissing = 0, cellsDiffer = 0, cellsSame = 0;
  const differSamples: string[] = [];
  for (const [loc, cells] of Object.entries(exWorks)) {
    cellsMine += Object.keys(cells).length;
    for (const [g, v] of Object.entries(cells)) {
      const p = prod[loc]?.[g];
      if (p === undefined) cellsMissing++;
      else if (Math.abs(p - v) < 0.5) cellsSame++;
      else { cellsDiffer++; if (differSamples.length < 12) differSamples.push(`${loc} ${g}: production ${p} vs circular ${v}`); }
    }
  }
  for (const cells of Object.values(prod)) cellsProd += Object.keys(cells).length;

  say(`\n${"-".repeat(88)}`);
  say("2. PRICES");
  say("-".repeat(88));
  say(`  prices derived from the circular : ${n(cellsMine)}`);
  say(`  prices in production             : ${n(cellsProd)}`);
  say(`  agreeing                         : ${n(cellsSame)}`);
  say(`  DIFFERING                        : ${n(cellsDiffer)}`);
  say(`  MISSING from production          : ${n(cellsMissing)}`);
  if (differSamples.length) { say(`\n  differing samples:`); for (const d of differSamples) say(`    ${d}`); }

  // ---- 3. cross-referenced grades affected --------------------------------
  const wanted = new Set<string>();
  for (const poly of ["hdpe", "lldpe"] as const)
    for (const row of crossref[poly])
      for (const g of (row.equivalents?.HMEL ?? [])) wanted.add(g);
  const wantedMissing = [...wanted].filter((g) => !prodGrades.has(g)).sort();
  const wantedRecovered = wantedMissing.filter((g) => mineGrades.has(g));
  const wantedAbsent = wantedMissing.filter((g) => !mineGrades.has(g));

  say(`\n${"-".repeat(88)}`);
  say("3. CROSS-REFERENCED GRADES AFFECTED");
  say("-".repeat(88));
  say(`  HMEL grades the cross-reference asks for : ${wanted.size}`);
  say(`  of those, unpriced in production         : ${wantedMissing.length}`);
  say(`    recovered from the circular            : ${wantedRecovered.length}  ${wantedRecovered.join(" ")}`);
  say(`    genuinely not in this circular         : ${wantedAbsent.length}  ${wantedAbsent.join(" ")}`);

  // Which GAIL grades those serve, and whether HMEL is the only competitor.
  const affected: Array<{ gail: string; hmel: string; soleCompetitor: boolean }> = [];
  for (const poly of ["hdpe", "lldpe"] as const)
    for (const row of crossref[poly]) {
      const eq = row.equivalents ?? {};
      const hits = (eq.HMEL ?? []).filter((g: string) => wantedRecovered.includes(g));
      if (!hits.length) continue;
      const others = ["RIL", "IOCL", "OPaL", "HPL", "BCPL"].some((p) => (eq[p] ?? []).length > 0);
      affected.push({ gail: row.gail_grade, hmel: hits.join(","), soleCompetitor: !others });
    }
  say(`\n  GAIL grades whose HMEL equivalent is missing: ${affected.length}`);
  for (const a of affected) say(`    ${a.gail.padEnd(12)} -> ${a.hmel.padEnd(10)} ${a.soleCompetitor ? "HMEL IS THE ONLY COMPETITOR" : "other competitors exist"}`);

  // ---- 4/5/6. coverage, visibility and ranking ---------------------------
  // The corrected book: grades production lacks are added, and the grades whose
  // column production mis-paired are overwritten. Only cells this read can
  // place against the page with near-total span overlap are touched.
  const merged: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(prod));
  for (const [loc, cells] of Object.entries(exWorks)) {
    if (!merged[loc]) continue; // only locations production already knows
    for (const [g, v] of Object.entries(cells)) merged[loc]![g] = v;
  }
  const before = dataset(prod), after = dataset(merged);
  const canon: string[] = locations.canonical;
  const gailGrades: string[] = Object.keys(Object.values(priceIndex.producers.GAIL.zones)[0] as any ?? {});

  let becameVisible = 0, leaderFlips = 0, cheapestFlips = 0, evaluated = 0;
  const visLocs = new Set<string>(), flipLocs = new Set<string>();
  const flipSamples: string[] = [];
  for (const g of gailGrades) {
    for (const loc of canon) {
      let cb: any, ca: any;
      try { cb = compare(before, g, loc, 120, "cash"); ca = compare(after, g, loc, 120, "cash"); } catch { continue; }
      evaluated++;
      const hb = cb.quotes.find((q: any) => q.producer === "HMEL")?.invoiceLanded ?? null;
      const ha = ca.quotes.find((q: any) => q.producer === "HMEL")?.invoiceLanded ?? null;
      if (hb === null && ha !== null) { becameVisible++; visLocs.add(loc); }
      const ch = (c: any) => c.quotes.filter((q: any) => q.invoiceLanded !== null).sort((x: any, y: any) => x.invoiceLanded - y.invoiceLanded)[0]?.producer ?? null;
      if ((cb.leader?.producer ?? null) !== (ca.leader?.producer ?? null)) { leaderFlips++; flipLocs.add(loc); }
      if (ch(cb) !== ch(ca)) {
        cheapestFlips++; flipLocs.add(loc);
        if (flipSamples.length < 12) flipSamples.push(`${g} at ${loc}: cheapest ${ch(cb)} -> ${ch(ca)}`);
      }
    }
  }

  say(`\n${"-".repeat(88)}`);
  say("4-6. COVERAGE, VISIBILITY AND RANKING");
  say("-".repeat(88));
  say(`  comparisons evaluated                  : ${n(evaluated)}`);
  say(`  comparisons where HMEL becomes visible : ${n(becameVisible)} across ${visLocs.size} locations`);
  say(`  leader changes                         : ${n(leaderFlips)}`);
  say(`  cheapest-supplier changes              : ${n(cheapestFlips)} across ${flipLocs.size} locations`);
  if (flipSamples.length) { say(`\n  flip samples:`); for (const f of flipSamples) say(`    ${f}`); }

  writeFileSync(REPORT, out.join("\n"));
  console.log(`\n(written to ${REPORT})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
