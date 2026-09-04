/**
 * Measure what a corrected producer book would change in the pricing engine.
 *
 * Runs core/pricing.compare twice over the same grid — every GAIL grade at
 * every canonical location — once against the production price index and once
 * against the index with one producer's zones replaced. Reports what becomes
 * quotable, what moves, and where the ranking changes.
 *
 * Read-only: builds datasets in memory, writes nothing.
 */

import { readFileSync } from "node:fs";
import { compare, useSpellings, type Dataset } from "../core/pricing";

const N = "D:/Gail2/gailcpe/backend/data/normalized";

export const priceIndex = JSON.parse(readFileSync(`${N}/price_index.json`, "utf8"));
const crossref = JSON.parse(readFileSync(`${N}/crossref.json`, "utf8"));
const discounts = JSON.parse(readFileSync(`${N}/discounts.json`, "utf8"));
const freight = JSON.parse(readFileSync(`${N}/freight.json`, "utf8"));
export const locations = JSON.parse(readFileSync(`${N}/locations.json`, "utf8"));
useSpellings(locations.spellings ?? {});

export type Zones = Record<string, Record<string, number>>;

export function datasetWith(producer: string, zones: Zones): Dataset {
  const producers = JSON.parse(JSON.stringify(priceIndex.producers));
  producers[producer].zones = zones;
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

export interface Impact {
  evaluated: number;
  becameQuotable: number;
  landedMoved: number;
  leaderFlips: number;
  cheapestFlips: number;
  worstMove: number;
  perLocation: Map<string, { quotable: number; moved: number; flips: number; worst: number }>;
  flips: string[];
  quotable: string[];
  moves: string[];
}

/** Which GAIL grades name this producer in the cross-reference, and for what. */
export function crossReferenced(producer: string, grades: Iterable<string>): Array<{ gail: string; hit: string }> {
  const want = new Set(grades);
  const out: Array<{ gail: string; hit: string }> = [];
  for (const poly of ["hdpe", "lldpe"] as const)
    for (const row of crossref[poly]) {
      const hits = (row.equivalents?.[producer] ?? []).filter((g: string) => want.has(g));
      if (hits.length) out.push({ gail: row.gail_grade, hit: hits.join(",") });
    }
  return out;
}

export function measure(producer: string, before: Zones, after: Zones, quantityMt = 120, mode = "cash"): Impact {
  const db = datasetWith(producer, before), da = datasetWith(producer, after);
  const canon: string[] = locations.canonical;
  const gailGrades: string[] = Object.keys((Object.values(priceIndex.producers.GAIL.zones)[0] as any) ?? {});

  const r: Impact = {
    evaluated: 0, becameQuotable: 0, landedMoved: 0, leaderFlips: 0, cheapestFlips: 0, worstMove: 0,
    perLocation: new Map(), flips: [], quotable: [], moves: [],
  };

  const landed = (c: any) => c.quotes.find((x: any) => x.producer === producer)?.invoiceLanded ?? null;
  const cheapest = (c: any) => c.quotes.filter((x: any) => x.invoiceLanded !== null)
    .sort((x: any, y: any) => x.invoiceLanded - y.invoiceLanded)[0]?.producer ?? null;

  for (const g of gailGrades) {
    for (const loc of canon) {
      let cb: any, ca: any;
      try { cb = compare(db, g, loc, quantityMt, mode as any); ca = compare(da, g, loc, quantityMt, mode as any); }
      catch { continue; }
      r.evaluated++;
      const rec = r.perLocation.get(loc) ?? { quotable: 0, moved: 0, flips: 0, worst: 0 };
      const qb = landed(cb), qa = landed(ca);
      if (qb === null && qa !== null) {
        r.becameQuotable++; rec.quotable++;
        if (r.quotable.length < 500) r.quotable.push(`${loc}|${g}|${qa}`);
      }
      if (qb !== null && qa !== null && Math.abs(qa - qb) >= 0.5) {
        r.landedMoved++; rec.moved++;
        const d = Math.abs(qa - qb);
        rec.worst = Math.max(rec.worst, d); r.worstMove = Math.max(r.worstMove, d);
        if (r.moves.length < 500) r.moves.push(`${loc}|${g}|${qb}|${qa}`);
      }
      if ((cb.leader?.producer ?? null) !== (ca.leader?.producer ?? null)) r.leaderFlips++;
      const chb = cheapest(cb), cha = cheapest(ca);
      if (chb !== cha) {
        r.cheapestFlips++; rec.flips++;
        if (r.flips.length < 500) r.flips.push(`${loc}|${g}|${chb}|${cha}`);
      }
      r.perLocation.set(loc, rec);
    }
  }
  return r;
}

export function reportImpact(say: (s?: string) => void, producer: string, r: Impact) {
  const n = (v: number) => v.toLocaleString("en-IN");
  say(`  comparisons evaluated             : ${n(r.evaluated)}`);
  say(`  ${producer} becomes quotable`.padEnd(36) + `: ${n(r.becameQuotable)}`);
  say(`  ${producer}'s landed cost moves`.padEnd(36) + `: ${n(r.landedMoved)}${r.worstMove ? `  (worst ${r.worstMove.toFixed(2)}/MT)` : ""}`);
  say(`  competitor leader changes         : ${n(r.leaderFlips)}`);
  say(`  cheapest supplier changes         : ${n(r.cheapestFlips)}`);
  const rows = [...r.perLocation.entries()].filter(([, v]) => v.quotable || v.moved || v.flips)
    .sort((a, b) => (b[1].flips - a[1].flips) || (b[1].moved - a[1].moved) || (b[1].quotable - a[1].quotable));
  say(`  locations affected                : ${rows.length}`);
  if (rows.length) {
    say(`\n  ${"location".padEnd(26)}${"newly quotable".padStart(16)}${"moved".padStart(9)}${"flips".padStart(8)}${"worst /MT".padStart(12)}`);
    for (const [loc, v] of rows.slice(0, 25))
      say(`  ${loc.padEnd(26)}${String(v.quotable).padStart(16)}${String(v.moved).padStart(9)}${String(v.flips).padStart(8)}${v.worst.toFixed(2).padStart(12)}`);
  }
  if (r.flips.length) {
    say(`\n  flip samples:`);
    for (const f of r.flips.slice(0, 12)) { const [l, g, b, a] = f.split("|"); say(`    ${g} at ${l}: cheapest ${b} -> ${a}`); }
  }
}
