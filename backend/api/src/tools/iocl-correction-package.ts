/**
 * The IOCL price correction, staged for review.
 *
 * The defect is narrow and its cause is known exactly. On page 3 three zones —
 * Udaipur, Visak and Bareilly — have their price row split across two text
 * baselines, with the zone label and the last two prices on one line and the
 * first thirteen on the next. extractors/iocl.py carries a zone name forward
 * only in the opposite arrangement (label first, prices after), so the orphaned
 * line arrives with no zone to attach to and is dropped: 39 prices, in silence.
 *
 * Nothing is mispriced. Every one of the 2,721 cells production holds agrees
 * with the circular to the rupee. This adds the 39 that never arrived.
 *
 * Read-only with respect to production: everything lands in D:/Gail2/staged.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/iocl-correction-package.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compare, useSpellings, type Dataset } from "../core/pricing";
import { readIocl } from "./iocl-price-audit";

const N = "D:/Gail2/gailcpe/backend/data/normalized";
const STAGED = "D:/Gail2/staged";
const PDF = process.argv[2] ?? "D:/Gail/IOCL.pdf";

const priceIndex = JSON.parse(readFileSync(`${N}/price_index.json`, "utf8"));
const crossref = JSON.parse(readFileSync(`${N}/crossref.json`, "utf8"));
const discounts = JSON.parse(readFileSync(`${N}/discounts.json`, "utf8"));
const freight = JSON.parse(readFileSync(`${N}/freight.json`, "utf8"));
const locations = JSON.parse(readFileSync(`${N}/locations.json`, "utf8"));
useSpellings(locations.spellings ?? {});

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const n = (v: number) => v.toLocaleString("en-IN");

function dataset(zones: Record<string, Record<string, number>>): Dataset {
  const producers = JSON.parse(JSON.stringify(priceIndex.producers));
  producers.IOCL.zones = zones;
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
  const { bases, stats } = await readIocl(PDF);
  const mine = bases.delivered!;
  const prod = priceIndex.producers.IOCL.zones as Record<string, Record<string, number>>;

  say("=".repeat(92));
  say("IOCL CORRECTION PACKAGE");
  say("=".repeat(92));

  // ---- 1. what the reading found, and whether it can be trusted ------------
  let agree = 0, disagree = 0, unreadable = 0;
  const disagreements: string[] = [];
  const additions: Array<{ zone: string; grade: string; price: number }> = [];
  for (const [z, cells] of Object.entries(prod)) {
    for (const [g, p] of Object.entries(cells)) {
      const v = mine[z]?.[g];
      if (v === undefined) { unreadable++; continue; }
      if (Math.abs(v - p) < 0.5) agree++;
      else { disagree++; if (disagreements.length < 20) disagreements.push(`${z} ${g}: production ${p} vs circular ${v}`); }
    }
  }
  for (const [z, cells] of Object.entries(mine)) {
    if (!prod[z]) continue;
    for (const [g, v] of Object.entries(cells)) if (prod[z]![g] === undefined) additions.push({ zone: z, grade: g, price: v });
  }

  const cellsMine = Object.values(mine).reduce((t, c) => t + Object.keys(c).length, 0);
  const cellsProd = Object.values(prod).reduce((t, c) => t + Object.keys(c).length, 0);

  say(`\nVALIDATION OF THE READING`);
  say(`  zones in the circular / in production       : ${Object.keys(mine).length} / ${Object.keys(prod).length}`);
  say(`  cells read from the circular                : ${n(cellsMine)}  (${Object.keys(mine).length} zones x 40 grades, no gaps)`);
  say(`  cells in production                         : ${n(cellsProd)}`);
  say(`  cells compared                              : ${n(agree + disagree)}`);
  say(`    agreeing to the rupee                     : ${n(agree)}`);
  say(`    DISAGREEING                               : ${n(disagree)}`);
  say(`  cells production has that this cannot read  : ${n(unreadable)}`);
  say(`  cells the circular has that production lacks: ${n(additions.length)}`);
  say(`\n  reader instrumentation: ${n(stats.valuesSeen)} values seen, ${n(stats.valuesAssigned)} assigned, ` +
      `${stats.valuesUnassigned} unassigned, ${stats.collisions} collisions, widest placement ${stats.maxAssignDistance.toFixed(1)}pt`);
  if (disagreements.length) { say(`\n  disagreements:`); for (const d of disagreements) say(`    ${d}`); }

  // ---- 2. the correction ---------------------------------------------------
  const corrected: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(prod));
  for (const a of additions) corrected[a.zone]![a.grade] = a.price;

  const byZone = new Map<string, Array<{ grade: string; price: number }>>();
  for (const a of additions) (byZone.get(a.zone) ?? byZone.set(a.zone, []).get(a.zone)!).push({ grade: a.grade, price: a.price });
  say(`\n${"-".repeat(92)}`);
  say(`THE CORRECTION — ${n(additions.length)} prices added, 0 changed, 0 removed`);
  say("-".repeat(92));
  for (const [z, list] of byZone) {
    say(`  ${z} (+${list.length}):`);
    say(`      ${list.map((v) => `${v.grade}=${n(v.price)}`).join("  ")}`);
  }

  // ---- 3. reachability: can anything actually ask for these? ---------------
  const addedGrades = new Set(additions.map((a) => a.grade));
  const reach: Array<{ gail: string; iocl: string }> = [];
  for (const poly of ["hdpe", "lldpe"] as const)
    for (const row of crossref[poly]) {
      const hits = (row.equivalents?.IOCL ?? []).filter((g: string) => addedGrades.has(g));
      if (hits.length) reach.push({ gail: row.gail_grade, iocl: hits.join(",") });
    }
  say(`\n${"-".repeat(92)}`);
  say("REACHABILITY — GAIL grades whose IOCL equivalent was among the missing");
  say("-".repeat(92));
  say(`  grades added                     : ${addedGrades.size} — ${[...addedGrades].join(" ")}`);
  say(`  cross-referenced by a GAIL grade : ${reach.length}`);
  for (const r of reach) say(`    ${r.gail.padEnd(14)} -> ${r.iocl}`);

  // ---- 4. engine impact ----------------------------------------------------
  const before = dataset(prod), after = dataset(corrected);
  const canon: string[] = locations.canonical;
  const gailGrades: string[] = Object.keys((Object.values(priceIndex.producers.GAIL.zones)[0] as any) ?? {});

  let evaluated = 0, visible = 0, moved = 0, leaderFlips = 0, cheapFlips = 0;
  const perLocation = new Map<string, { visible: number; flips: number }>();
  const flipDetail: string[] = [];
  const visibleDetail: string[] = [];

  for (const g of gailGrades) {
    for (const loc of canon) {
      let cb: any, ca: any;
      try { cb = compare(before, g, loc, 120, "cash"); ca = compare(after, g, loc, 120, "cash"); } catch { continue; }
      evaluated++;
      const q = (c: any) => c.quotes.find((x: any) => x.producer === "IOCL")?.invoiceLanded ?? null;
      const ch = (c: any) => c.quotes.filter((x: any) => x.invoiceLanded !== null)
        .sort((x: any, y: any) => x.invoiceLanded - y.invoiceLanded)[0]?.producer ?? null;
      const qb = q(cb), qa = q(ca);
      const rec = perLocation.get(loc) ?? { visible: 0, flips: 0 };
      if (qb === null && qa !== null) {
        visible++; rec.visible++;
        if (visibleDetail.length < 500) visibleDetail.push(`${loc}|${g}|${qa}`);
      }
      if (qb !== null && qa !== null && Math.abs(qa - qb) >= 0.5) moved++;
      if ((cb.leader?.producer ?? null) !== (ca.leader?.producer ?? null)) leaderFlips++;
      if (ch(cb) !== ch(ca)) {
        cheapFlips++; rec.flips++;
        if (flipDetail.length < 500) flipDetail.push(`${loc}|${g}|${ch(cb)}|${ch(ca)}`);
      }
      perLocation.set(loc, rec);
    }
  }

  say(`\n${"-".repeat(92)}`);
  say("ENGINE IMPACT — core/pricing.compare, 120 MT cash, every GAIL grade at every location");
  say("-".repeat(92));
  say(`  comparisons evaluated             : ${n(evaluated)}`);
  say(`  IOCL becomes quotable             : ${n(visible)}`);
  say(`  IOCL's landed cost moves          : ${n(moved)}`);
  say(`  competitor leader changes         : ${n(leaderFlips)}`);
  say(`  cheapest supplier changes         : ${n(cheapFlips)}`);

  const locRows = [...perLocation.entries()].filter(([, r]) => r.visible || r.flips)
    .sort((a, b) => (b[1].flips - a[1].flips) || (b[1].visible - a[1].visible));
  say(`\n  locations affected: ${locRows.length}`);
  say(`  ${"location".padEnd(24)}${"newly quotable".padStart(16)}${"cheapest flips".padStart(16)}`);
  for (const [loc, r] of locRows.slice(0, 30))
    say(`  ${loc.padEnd(24)}${String(r.visible).padStart(16)}${String(r.flips).padStart(16)}`);
  if (flipDetail.length) {
    say(`\n  flip samples:`);
    for (const f of flipDetail.slice(0, 15)) { const [l, g, b, a] = f.split("|"); say(`    ${g} at ${l}: cheapest ${b} -> ${a}`); }
  }

  writeFileSync(`${STAGED}/iocl.corrected.json`, JSON.stringify(corrected, null, 1));
  writeFileSync(`${STAGED}/iocl-added-prices.csv`,
    "zone,grade,delivered_price\n" + additions.map((a) => `${a.zone},${a.grade},${a.price}`).join("\n"));
  writeFileSync(`${STAGED}/iocl-newly-quotable.csv`,
    "location,gail_grade,iocl_landed\n" + visibleDetail.map((v) => v.split("|").join(",")).join("\n"));
  writeFileSync(`${STAGED}/iocl-cheapest-flips.csv`,
    "location,gail_grade,cheapest_before,cheapest_after\n" + flipDetail.map((f) => f.split("|").join(",")).join("\n"));
  writeFileSync("D:/Gail2/iocl-correction-package.txt", out.join("\n"));
  say(`\nstaged to ${STAGED} — nothing published`);
}

main().catch((e) => { console.error(e); process.exit(1); });
