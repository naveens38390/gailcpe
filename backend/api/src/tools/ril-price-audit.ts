/**
 * Independent read of RIL's price circular, for comparison against the ETL.
 *
 * Deliberately not a port of extractors/ril.py. It reads the same document with
 * a different engine (pdfjs rather than pdfplumber) and a different column
 * rule, so where the two agree the agreement means something. Every value that
 * fails to reach a column is counted rather than discarded quietly — that is
 * the whole point of the exercise.
 *
 * Read-only. Writes a report; changes nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readRows, mergeOrphanRows, isNumber, parseNumber } from "../modules/circulars/pdf-table-reader";

/**
 * Run it against a new circular with:
 *   npx ts-node -r tsconfig-paths/register src/tools/ril-price-audit.ts <pdf> <price_index.json> [report.txt]
 */
const [PDF, INDEX, REPORT] = [
  process.argv[2] ?? "D:/Gail/RIL.pdf",
  process.argv[3] ?? "D:/Gail2/gailcpe/backend/data/normalized/price_index.json",
  process.argv[4] ?? "D:/Gail2/ril-extraction-audit.txt",
];

const ANNEXURE = /Annexure\s*-\s*([IVX]+[A-Z]?)/i;
const HEADER = /^Sr\.No/;
/** The annexures the price index is actually built from. */
const DOMESTIC = ["IA", "IB", "IC", "ID", "IE", "IF", "IIA", "IIB", "IIC"];
/** Below this a row's numbers are page furniture, not prices. */
const PRICE_FLOOR = 1000;

interface Column { grade: string; x: number }

export interface RilRead {
  /** annexure -> zone -> grade -> price */
  annexures: Record<string, Record<string, Record<string, number>>>;
  stats: {
    dataRows: number;
    valuesSeen: number;
    valuesAssigned: number;
    valuesUnassigned: number;
    collisions: number;
    furnitureRows: number;
    unassignedSamples: string[];
    collisionSamples: string[];
    maxAssignDistance: number;
  };
}

export async function readRil(path: string): Promise<RilRead> {
  const rows = mergeOrphanRows(await readRows(readFileSync(path)));
  const annexures: Record<string, Record<string, Record<string, number>>> = {};
  const stats: RilRead["stats"] = {
    dataRows: 0, valuesSeen: 0, valuesAssigned: 0, valuesUnassigned: 0,
    collisions: 0, furnitureRows: 0, unassignedSamples: [], collisionSamples: [],
    maxAssignDistance: 0,
  };

  let current: string | null = null;
  let columns: Column[] = [];

  for (const row of rows) {
    const found = ANNEXURE.exec(row.text);
    if (found) {
      current = found[1]!.toUpperCase();
      annexures[current] ??= {};
      continue;
    }
    if (HEADER.test(row.text)) {
      // Columns are the header words to the right of "State".
      const state = row.words.find((w) => w.text === "State");
      const cutoff = state ? state.x1 : 0;
      columns = row.words
        .filter((w) => w.x0 > cutoff)
        .map((w) => ({ grade: w.text, x: (w.x0 + w.x1) / 2 }));
      continue;
    }
    if (!current || !columns.length) continue;

    // Split the row into its leading label and its numeric cells.
    const numeric = row.words.filter((w) => isNumber(w.text));
    if (!numeric.length) continue;
    const boundary = Math.min(...numeric.map((w) => w.x0));
    const label = row.words.filter((w) => w.x0 < boundary).map((w) => w.text).join(" ").trim();
    if (!label) continue;

    const values = numeric.map((w) => ({ value: parseNumber(w.text), x: (w.x0 + w.x1) / 2 }));
    if (Math.max(...values.map((v) => v.value)) < PRICE_FLOOR) { stats.furnitureRows++; continue; }

    // "1 AGARTALA TR" -> zone AGARTALA. Serial fused or spaced, state code last.
    let zone = label.replace(/^\d+\s*/, "").trim();
    zone = zone.replace(/\s+[A-Z]{2}$/, "").trim();
    if (!zone) continue;

    stats.dataRows++;
    const cell = (annexures[current]![zone] ??= {});
    for (const v of values) {
      stats.valuesSeen++;
      let best: Column | null = null;
      let bestD = Infinity;
      for (const c of columns) {
        const d = Math.abs(c.x - v.x);
        if (d < bestD) { bestD = d; best = c; }
      }
      // A value more than half a column-pitch from every header is not safely
      // attributable to any of them.
      const pitch = columns.length > 1 ? (columns[columns.length - 1]!.x - columns[0]!.x) / (columns.length - 1) : 60;
      if (!best || bestD > pitch * 0.75) {
        stats.valuesUnassigned++;
        if (stats.unassignedSamples.length < 12) {
          stats.unassignedSamples.push(`${current} ${zone} value=${v.value} x=${v.x.toFixed(0)} nearest=${best?.grade}@${best?.x.toFixed(0)} d=${bestD.toFixed(0)} pitch=${pitch.toFixed(0)}`);
        }
        continue;
      }
      stats.maxAssignDistance = Math.max(stats.maxAssignDistance, bestD);
      if (cell[best.grade] !== undefined && cell[best.grade] !== v.value) {
        stats.collisions++;
        if (stats.collisionSamples.length < 12) {
          stats.collisionSamples.push(`${current} ${zone} ${best.grade}: ${cell[best.grade]} vs ${v.value}`);
        }
      }
      cell[best.grade] = v.value;
      stats.valuesAssigned++;
    }
  }
  return { annexures, stats };
}

/** Cheapest across the domestic annexures, exactly as build.py merges them. */
export function toIndex(read: RilRead): Record<string, Record<string, number>> {
  const zones: Record<string, Record<string, number>> = {};
  for (const a of DOMESTIC) {
    for (const [zone, grades] of Object.entries(read.annexures[a] ?? {})) {
      const cell = (zones[zone] ??= {});
      for (const [g, p] of Object.entries(grades)) {
        if (cell[g] === undefined || p < cell[g]!) cell[g] = p;
      }
    }
  }
  return zones;
}

async function main() {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  const read = await readRil(PDF);
  const mine = toIndex(read);
  const theirs = JSON.parse(
    readFileSync(INDEX, "utf8"),
  ).producers.RIL.zones as Record<string, Record<string, number>>;

  say("=".repeat(84));
  say("INDEPENDENT RIL READ");
  say("=".repeat(84));
  say(`annexures found              : ${Object.keys(read.annexures).length}`);
  say(`data rows read               : ${read.stats.dataRows}`);
  say(`page-furniture rows skipped  : ${read.stats.furnitureRows}`);
  say(`values seen                  : ${read.stats.valuesSeen}`);
  say(`  assigned to a grade column : ${read.stats.valuesAssigned}`);
  say(`  UNASSIGNED (dropped)       : ${read.stats.valuesUnassigned}`);
  say(`  collisions (overwritten)   : ${read.stats.collisions}`);
  say(`largest assign distance      : ${read.stats.maxAssignDistance.toFixed(1)} pt`);
  if (read.stats.unassignedSamples.length) {
    say(`\n  unassigned samples:`);
    for (const s of read.stats.unassignedSamples) say(`    ${s}`);
  }
  if (read.stats.collisionSamples.length) {
    say(`\n  collision samples:`);
    for (const s of read.stats.collisionSamples) say(`    ${s}`);
  }

  // ---- compare the merged index -----------------------------------------
  const myZones = Object.keys(mine).sort();
  const theirZones = Object.keys(theirs).sort();
  const onlyMine = myZones.filter((z) => !(z in theirs));
  const onlyTheirs = theirZones.filter((z) => !(z in mine));

  say(`\n${"=".repeat(84)}`);
  say("COMPARISON AGAINST THE ETL INDEX");
  say("=".repeat(84));
  say(`zones  mine ${myZones.length}   etl ${theirZones.length}`);
  if (onlyMine.length) say(`  only in mine (${onlyMine.length}): ${onlyMine.slice(0, 10).join(", ")}`);
  if (onlyTheirs.length) say(`  only in etl  (${onlyTheirs.length}): ${onlyTheirs.slice(0, 10).join(", ")}`);

  let same = 0, differ = 0, missingFromEtl = 0, missingFromMine = 0;
  const diffs: string[] = [];
  const gaps: string[] = [];
  for (const z of theirZones.filter((z) => z in mine)) {
    const a = mine[z]!, b = theirs[z]!;
    for (const g of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[g], vb = b[g];
      if (va === undefined) { missingFromMine++; continue; }
      if (vb === undefined) {
        missingFromEtl++;
        if (gaps.length < 15) gaps.push(`${z} ${g} = ${va} (absent from the ETL)`);
        continue;
      }
      if (Math.abs(va - vb) < 0.005) same++;
      else { differ++; if (diffs.length < 15) diffs.push(`${z} ${g}: etl ${vb} vs mine ${va}`); }
    }
  }
  say(`\ncells identical              : ${same.toLocaleString("en-IN")}`);
  say(`cells differing              : ${differ.toLocaleString("en-IN")}`);
  say(`present in mine, absent in ETL: ${missingFromEtl.toLocaleString("en-IN")}`);
  say(`present in ETL, absent in mine: ${missingFromMine.toLocaleString("en-IN")}`);
  if (diffs.length) { say(`\n  differing samples:`); for (const d of diffs) say(`    ${d}`); }
  if (gaps.length) { say(`\n  absent-from-ETL samples:`); for (const g of gaps) say(`    ${g}`); }

  writeFileSync("D:/Gail2/ril-extraction-audit.txt", out.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
