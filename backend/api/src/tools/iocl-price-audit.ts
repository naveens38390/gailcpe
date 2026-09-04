/**
 * Independent read of IOCL's price list, for comparison against the ETL.
 *
 * Deliberately not a port of extractors/iocl.py. That reader decides what is a
 * column by testing each header word against two patterns — a grade shape and a
 * utility shape — and a column matching neither is not merely skipped: its
 * values then snap to whichever column was recognised nearest, which is how
 * HMEL's prices ended up on the wrong grades.
 *
 * So this takes the structure at its word. The header row begins with "Grades";
 * every word after it is a column, whatever it spells. Nothing is required to
 * look like anything. Values are placed by nearest header midpoint, and every
 * value that cannot be placed is counted rather than dropped in silence.
 *
 * Read-only — writes a report, changes nothing.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/iocl-price-audit.ts [pdf] [index] [report]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readRows, mergeOrphanRows, isNumber, parseNumber, type PdfRow } from "../modules/circulars/pdf-table-reader";

const [PDF, INDEX, REPORT] = [
  process.argv[2] ?? "D:/Gail/IOCL.pdf",
  process.argv[3] ?? "D:/Gail2/gailcpe/backend/data/normalized/price_index.json",
  process.argv[4] ?? "D:/Gail2/iocl-extraction-audit.txt",
];

/** Delivered prices are the only basis the price index is built from. */
const DELIVERED_PAGES = [2, 3, 4];
const DEPOT_PAGES = [5, 6];
const SECTIONS: Record<string, string> = {
  "Delivered Price": "delivered",
  "Ex DOPW Price": "ex_dopw",
  "Ex RSC Price": "ex_rsc",
};
/** A price is five or six figures; a slab number or a footnote is not. */
const PRICE_FLOOR = 1000;
/** How far a value may sit from a header and still belong to it. */
const RADIUS = 22;

/** The two shapes extractors/iocl.py will accept, for comparison only. */
const ETL_GRADE = /\d{3}[A-Z]{1,2}\d{2}[A-Z]?/;
const ETL_UTILITY = /^[A-Z]{2,5}(?:-Al)?$/;

interface Column { grade: string; x: number }

export interface IoclRead {
  bases: Record<string, Record<string, Record<string, number>>>;
  stats: {
    orphanRowsJoined: number;
    headerRows: number;
    columnsSeen: number;
    columnsEtlWouldMiss: string[];
    zoneRows: number;
    wrappedZoneNames: number;
    valuesSeen: number; valuesAssigned: number; valuesUnassigned: number;
    collisions: number;
    carriedValues: number;
    unassignedSamples: string[];
    collisionSamples: string[];
    maxAssignDistance: number;
  };
}

export async function readIocl(path: string): Promise<IoclRead> {
  const rawRows = await readRows(readFileSync(path));
  const rows = mergeOrphanRows(rawRows);
  const bases: IoclRead["bases"] = { delivered: {}, ex_dopw: {}, ex_rsc: {} };
  const stats: IoclRead["stats"] = {
    orphanRowsJoined: rawRows.length - rows.length,
    headerRows: 0, columnsSeen: 0, columnsEtlWouldMiss: [],
    zoneRows: 0, wrappedZoneNames: 0,
    valuesSeen: 0, valuesAssigned: 0, valuesUnassigned: 0, collisions: 0, carriedValues: 0,
    unassignedSamples: [], collisionSamples: [], maxAssignDistance: 0,
  };

  let columns: Column[] = [];
  let basis: string | null = null;
  let pending = "";
  let carried: Array<{ v: number; x: number }> = [];

  for (const row of rows) {
    if (!DELIVERED_PAGES.includes(row.page) && !DEPOT_PAGES.includes(row.page)) continue;
    const text = row.text;

    if (text.startsWith("Grades")) {
      // Every word after "Grades" is a column. No shape is required of it.
      columns = row.words
        .filter((w) => w.text !== "Grades" && !/^Grades/.test(w.text))
        .map((w) => ({ grade: w.text.replace(/^`+/, ""), x: (w.x0 + w.x1) / 2 }));
      stats.headerRows++;
      stats.columnsSeen += columns.length;
      for (const c of columns) {
        if (!ETL_GRADE.test(c.grade) && !ETL_UTILITY.test(c.grade)) stats.columnsEtlWouldMiss.push(c.grade);
      }
      basis = DELIVERED_PAGES.includes(row.page) ? "delivered" : basis;
      continue;
    }
    const matched = Object.entries(SECTIONS).find(([k]) => text.startsWith(k));
    if (matched) {
      basis = matched[1];
      // The caption row can also carry the tail of the first zone's prices.
      // Jammu's last two land here, on the same baseline as "Delivered Price,
      // Rs/MT (Applicable for all districts...)", and the generic row-merge
      // will not take them because the caption's own text starts where a zone
      // label starts. Hold them for the zone row that follows.
      carried = row.words
        .filter((w) => isNumber(w.text) && parseNumber(w.text) >= PRICE_FLOOR)
        .map((w) => ({ v: parseNumber(w.text), x: (w.x0 + w.x1) / 2 }));
      if (carried.length) stats.carriedValues += carried.length;
      continue;
    }
    if (!basis || !columns.length) continue;

    const numeric = row.words.filter((w) => isNumber(w.text));
    if (!numeric.length) {
      // A zone name too long for its cell sits alone; its prices are next row.
      const label = row.words.map((w) => w.text).join(" ").trim();
      if (label && !/^\d/.test(label)) { pending = label; stats.wrappedZoneNames++; }
      continue;
    }
    const boundary = Math.min(...numeric.map((w) => w.x0));
    let zone = row.words.filter((w) => w.x0 < boundary).map((w) => w.text).join(" ").trim();
    if (!zone) { zone = pending; pending = ""; }
    if (!zone) continue;

    const values = numeric.map((w) => ({ v: parseNumber(w.text), x: (w.x0 + w.x1) / 2 }));
    // Values stranded on the caption row belong to this, the first zone under it.
    if (carried.length) { values.push(...carried); carried = []; }
    if (Math.max(...values.map((v) => v.v)) < PRICE_FLOOR) continue;

    stats.zoneRows++;
    const cell = (bases[basis]![zone] ??= {});
    for (const v of values) {
      if (v.v < PRICE_FLOOR) continue;
      stats.valuesSeen++;
      let best: Column | null = null, bestD = Infinity;
      for (const c of columns) { const d = Math.abs(c.x - v.x); if (d < bestD) { bestD = d; best = c; } }
      if (!best || bestD > RADIUS) {
        stats.valuesUnassigned++;
        if (stats.unassignedSamples.length < 12) {
          stats.unassignedSamples.push(`${basis} ${zone} ${v.v} x=${v.x.toFixed(0)} nearest ${best?.grade}@${best?.x.toFixed(0)} d=${bestD.toFixed(1)}`);
        }
        continue;
      }
      stats.maxAssignDistance = Math.max(stats.maxAssignDistance, bestD);
      if (cell[best.grade] !== undefined && cell[best.grade] !== v.v) {
        stats.collisions++;
        if (stats.collisionSamples.length < 12) stats.collisionSamples.push(`${basis} ${zone} ${best.grade}: ${cell[best.grade]} vs ${v.v}`);
      }
      cell[best.grade] = v.v;
      stats.valuesAssigned++;
    }
  }
  return { bases, stats };
}

async function main() {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };
  const n = (v: number) => v.toLocaleString("en-IN");

  const read = await readIocl(PDF);
  const mine = read.bases.delivered!;
  const theirs = JSON.parse(readFileSync(INDEX, "utf8")).producers.IOCL.zones as Record<string, Record<string, number>>;

  say("=".repeat(86));
  say("INDEPENDENT IOCL READ");
  say("=".repeat(86));
  say(`orphan rows joined            : ${read.stats.orphanRowsJoined}`);
  say(`header rows                   : ${read.stats.headerRows}`);
  say(`column headings seen          : ${read.stats.columnsSeen}`);
  say(`  headings the ETL's patterns would not accept: ${read.stats.columnsEtlWouldMiss.length}${read.stats.columnsEtlWouldMiss.length ? " — " + [...new Set(read.stats.columnsEtlWouldMiss)].join(" ") : ""}`);
  say(`zone rows read                : ${read.stats.zoneRows}`);
  say(`wrapped zone names held over  : ${read.stats.wrappedZoneNames}`);
  say(`values seen                   : ${n(read.stats.valuesSeen)}`);
  say(`  assigned                    : ${n(read.stats.valuesAssigned)}`);
  say(`  UNASSIGNED                  : ${n(read.stats.valuesUnassigned)}`);
  say(`  collisions                  : ${n(read.stats.collisions)}`);
  say(`values held over from caption rows: ${read.stats.carriedValues}`);
  say(`largest assign distance       : ${read.stats.maxAssignDistance.toFixed(1)} pt (radius ${RADIUS})`);
  if (read.stats.unassignedSamples.length) { say(`\n  unassigned samples:`); for (const s of read.stats.unassignedSamples) say(`    ${s}`); }
  if (read.stats.collisionSamples.length) { say(`\n  collision samples:`); for (const s of read.stats.collisionSamples) say(`    ${s}`); }

  say(`\n${"=".repeat(86)}`);
  say("COMPARISON AGAINST THE ETL INDEX (delivered)");
  say("=".repeat(86));
  const myZ = Object.keys(mine).sort(), thZ = Object.keys(theirs).sort();
  say(`zones  mine ${myZ.length}   etl ${thZ.length}`);
  const onlyMine = myZ.filter((z) => !(z in theirs)), onlyEtl = thZ.filter((z) => !(z in mine));
  if (onlyMine.length) say(`  only in mine (${onlyMine.length}): ${onlyMine.join(", ")}`);
  if (onlyEtl.length) say(`  only in etl  (${onlyEtl.length}): ${onlyEtl.join(", ")}`);

  let same = 0, differ = 0, missEtl = 0, missMine = 0;
  const diffs: string[] = [], gaps: string[] = [];
  const differByGrade = new Map<string, number>();
  for (const z of thZ.filter((z) => z in mine)) {
    const a = mine[z]!, b = theirs[z]!;
    for (const g of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[g], vb = b[g];
      if (va === undefined) { missMine++; continue; }
      if (vb === undefined) { missEtl++; if (gaps.length < 15) gaps.push(`${z} ${g} = ${va} (absent from the ETL)`); continue; }
      if (Math.abs(va - vb) < 0.005) same++;
      else { differ++; differByGrade.set(g, (differByGrade.get(g) ?? 0) + 1); if (diffs.length < 15) diffs.push(`${z} ${g}: etl ${vb} vs mine ${va}`); }
    }
  }
  say(`\ncells identical               : ${n(same)}`);
  say(`cells differing               : ${n(differ)}${differByGrade.size ? ` across ${differByGrade.size} grades` : ""}`);
  say(`present in mine, absent in ETL : ${n(missEtl)}`);
  say(`present in ETL, absent in mine : ${n(missMine)}`);
  if (diffs.length) { say(`\n  differing samples:`); for (const d of diffs) say(`    ${d}`); }
  if (gaps.length) { say(`\n  absent-from-ETL samples:`); for (const g of gaps) say(`    ${g}`); }

  writeFileSync(REPORT, out.join("\n"));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
