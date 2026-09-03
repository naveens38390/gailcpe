/**
 * The HMEL price correction, staged for review.
 *
 * Builds a corrected HMEL price index from the structural grade dictionary,
 * re-runs the production pricing engine against it, and writes the per-location
 * and per-grade reports plus the staged index itself.
 *
 * Two rules govern what goes in, because a correction that loses data is worse
 * than the defect it fixes:
 *   - a grade production carries is never dropped, whatever this reader saw;
 *   - a price is only overwritten where the circular places it against the page
 *     unambiguously.
 *
 * Read-only with respect to production: everything lands in D:/Gail2/staged.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/hmel-correction-package.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compare, useSpellings, type Dataset } from "../core/pricing";
import { buildIndex, readSections } from "./hmel-grade-dictionary";

const N = "D:/Gail2/gailcpe/backend/data/normalized";
const STAGED = "D:/Gail2/staged";
const PDF = process.argv[2] ?? "D:/Gail/HMEL.pdf";

const priceIndex = JSON.parse(readFileSync(`${N}/price_index.json`, "utf8"));
const crossref = JSON.parse(readFileSync(`${N}/crossref.json`, "utf8"));
const discounts = JSON.parse(readFileSync(`${N}/discounts.json`, "utf8"));
const freight = JSON.parse(readFileSync(`${N}/freight.json`, "utf8"));
const locations = JSON.parse(readFileSync(`${N}/locations.json`, "utf8"));
useSpellings(locations.spellings ?? {});

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const n = (v: number) => v.toLocaleString("en-IN");
const rs = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  mkdirSync(STAGED, { recursive: true });
  const sections = await readSections(PDF);
  const { basic, exWorks } = buildIndex(sections);
  const prod = priceIndex.producers.HMEL.zones as Record<string, Record<string, number>>;

  // ---- validation: does the reading reproduce what production already has? --
  say("=".repeat(90));
  say("HMEL CORRECTION PACKAGE");
  say("=".repeat(90));
  const shared: string[] = [];
  let agree = 0, disagree = 0;
  const disagreeByGrade = new Map<string, number>();
  for (const [loc, cells] of Object.entries(prod)) {
    for (const [g, p] of Object.entries(cells)) {
      const v = exWorks[loc]?.[g];
      if (v === undefined) continue;
      if (Math.abs(v - p) < 0.5) agree++;
      else { disagree++; disagreeByGrade.set(g, (disagreeByGrade.get(g) ?? 0) + 1); }
    }
  }
  const lostGrades = new Set<string>();
  for (const cells of Object.values(prod)) for (const g of Object.keys(cells)) if (basic[g] === undefined) lostGrades.add(g);

  say(`\nVALIDATION OF THE READING`);
  say(`  cells production and the circular both hold : ${n(agree + disagree)}`);
  say(`    agreeing                                  : ${n(agree)}`);
  say(`    disagreeing                               : ${n(disagree)}  across ${disagreeByGrade.size} grades`);
  say(`  grades production has that this cannot read : ${lostGrades.size}${lostGrades.size ? " — " + [...lostGrades].join(" ") : ""}`);
  if (disagreeByGrade.size) {
    say(`\n  grades whose prices differ, and by how much at Delhi:`);
    for (const [g, count] of [...disagreeByGrade].sort((a, b) => b[1] - a[1])) {
      const p = prod.Delhi?.[g], v = exWorks.Delhi?.[g];
      const delta = p !== undefined && v !== undefined ? v - p : NaN;
      say(`    ${g.padEnd(10)} ${String(count).padStart(3)} locations   production ${p ?? "-"}  ->  circular ${v ?? "-"}   ${Number.isNaN(delta) ? "" : (delta > 0 ? "+" : "") + rs(delta)}`);
    }
  }

  // ---- build the corrected index -----------------------------------------
  const corrected: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(prod));
  let added = 0, overwritten = 0, preserved = 0;
  for (const [loc, cells] of Object.entries(exWorks)) {
    if (!corrected[loc]) continue;
    for (const [g, v] of Object.entries(cells)) {
      if (corrected[loc]![g] === undefined) { corrected[loc]![g] = v; added++; }
      else if (Math.abs(corrected[loc]![g]! - v) >= 0.5) { corrected[loc]![g] = v; overwritten++; }
    }
  }
  for (const g of lostGrades) preserved++;

  say(`\nCORRECTED INDEX`);
  say(`  prices added    : ${n(added)}`);
  say(`  prices corrected: ${n(overwritten)}`);
  say(`  grades preserved that this reader could not see: ${preserved}`);
  const before = dataset(prod), after = dataset(corrected);

  // ---- grade-by-grade -----------------------------------------------------
  const gradeRows: Array<{ grade: string; added: number; corrected: number; delta: number }> = [];
  for (const [loc, cells] of Object.entries(exWorks)) {
    if (!prod[loc]) continue;
    for (const [g, v] of Object.entries(cells)) {
      const p = prod[loc]?.[g];
      let row = gradeRows.find((r) => r.grade === g);
      if (!row) { row = { grade: g, added: 0, corrected: 0, delta: 0 }; gradeRows.push(row); }
      if (p === undefined) row.added++;
      else if (Math.abs(p - v) >= 0.5) { row.corrected++; row.delta = v - p; }
    }
  }
  say(`\n${"-".repeat(90)}`);
  say("GRADE-BY-GRADE");
  say("-".repeat(90));
  say(`${"grade".padEnd(20)}${"added".padStart(8)}${"corrected".padStart(11)}${"per-MT change".padStart(16)}`);
  for (const r of gradeRows.filter((r) => r.corrected).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
    say(`${r.grade.padEnd(20)}${String(r.added).padStart(8)}${String(r.corrected).padStart(11)}${((r.delta > 0 ? "+" : "") + rs(r.delta)).padStart(16)}`);
  }
  const addedOnly = gradeRows.filter((r) => r.added && !r.corrected);
  say(`\n  grades added with no correction: ${addedOnly.length} (${n(addedOnly.reduce((t, r) => t + r.added, 0))} prices)`);

  // ---- engine impact ------------------------------------------------------
  const canon: string[] = locations.canonical;
  const gailGrades: string[] = Object.keys(Object.values(priceIndex.producers.GAIL.zones)[0] as any ?? {});
  let evaluated = 0, visible = 0, leaderFlips = 0, cheapFlips = 0, priceMoved = 0;
  const perLocation = new Map<string, { visible: number; flips: number; moved: number; worst: number }>();
  const flipDetail: string[] = [];

  for (const g of gailGrades) {
    for (const loc of canon) {
      let cb: any, ca: any;
      try { cb = compare(before, g, loc, 120, "cash"); ca = compare(after, g, loc, 120, "cash"); } catch { continue; }
      evaluated++;
      const hb = cb.quotes.find((q: any) => q.producer === "HMEL")?.invoiceLanded ?? null;
      const ha = ca.quotes.find((q: any) => q.producer === "HMEL")?.invoiceLanded ?? null;
      const rec = perLocation.get(loc) ?? { visible: 0, flips: 0, moved: 0, worst: 0 };
      if (hb === null && ha !== null) { visible++; rec.visible++; }
      if (hb !== null && ha !== null && Math.abs(ha - hb) >= 0.5) {
        priceMoved++; rec.moved++; rec.worst = Math.max(rec.worst, Math.abs(ha - hb));
      }
      const ch = (c: any) => c.quotes.filter((q: any) => q.invoiceLanded !== null).sort((x: any, y: any) => x.invoiceLanded - y.invoiceLanded)[0]?.producer ?? null;
      if ((cb.leader?.producer ?? null) !== (ca.leader?.producer ?? null)) leaderFlips++;
      if (ch(cb) !== ch(ca)) {
        cheapFlips++; rec.flips++;
        if (flipDetail.length < 400) flipDetail.push(`${loc}|${g}|${ch(cb)}|${ch(ca)}`);
      }
      perLocation.set(loc, rec);
    }
  }

  say(`\n${"-".repeat(90)}`);
  say("ENGINE IMPACT — 120 MT cash, every GAIL grade at every location");
  say("-".repeat(90));
  say(`  comparisons evaluated            : ${n(evaluated)}`);
  say(`  HMEL becomes quotable            : ${n(visible)}`);
  say(`  HMEL's landed cost moves          : ${n(priceMoved)}`);
  say(`  competitor leader changes         : ${n(leaderFlips)}`);
  say(`  cheapest supplier changes         : ${n(cheapFlips)}`);

  say(`\n${"-".repeat(90)}`);
  say("LOCATION-BY-LOCATION (locations with any change, worst first)");
  say("-".repeat(90));
  say(`${"location".padEnd(22)}${"newly quotable".padStart(16)}${"prices moved".padStart(14)}${"flips".padStart(7)}${"worst /MT".padStart(12)}`);
  const locRows = [...perLocation.entries()].filter(([, r]) => r.visible || r.moved || r.flips)
    .sort((a, b) => (b[1].flips - a[1].flips) || (b[1].worst - a[1].worst));
  for (const [loc, r] of locRows.slice(0, 40)) {
    say(`${loc.padEnd(22)}${String(r.visible).padStart(16)}${String(r.moved).padStart(14)}${String(r.flips).padStart(7)}${rs(r.worst).padStart(12)}`);
  }
  say(`  ... ${locRows.length} locations affected in total`);

  writeFileSync(`${STAGED}/hmel.corrected.json`, JSON.stringify(corrected, null, 1));
  writeFileSync(`${STAGED}/hmel-grade-dictionary.json`, JSON.stringify(basic, null, 1));
  writeFileSync(`${STAGED}/hmel-cheapest-flips.csv`,
    "location,gail_grade,cheapest_before,cheapest_after\n" + flipDetail.map((f) => f.split("|").join(",")).join("\n"));
  writeFileSync("D:/Gail2/hmel-correction-package.txt", out.join("\n"));
  say(`\nstaged to ${STAGED} — nothing published`);
}

main().catch((e) => { console.error(e); process.exit(1); });
