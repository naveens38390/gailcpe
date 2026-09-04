/**
 * Independent read of GAIL's ex-works and stock-point sheets.
 *
 * Deliberately not a port of extractors/gail.py. That reader recognises a grade
 * column by matching a code shape against each header *word*, and eighteen of
 * GAIL's codes are not one word: the sheet sets them as "I56A200U A", the form
 * letter pushed off the end of a code too long for its cell. Matching per word
 * takes the first half and drops the rest, so the column is named "I56A200U".
 *
 * This takes the header at its word instead: everything right of the
 * "LOCATION/GRADE" heading is a column, whatever it spells and however many
 * spaces it contains. Label columns are found from their own headings rather
 * than by token position, and values are placed by the band containing them.
 *
 * Only the ex-works sheet feeds the price index; the stock-point sheet is read
 * for completeness.
 *
 * Read-only — writes a report, changes nothing.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/gail-price-audit.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readRows, mergeOrphanRows, isNumber, parseNumber, joinNumericFragments, type PdfRow, type Word } from "../modules/circulars/pdf-table-reader";

const EX_WORKS = "D:/Gail/GAIL EX WORKS.pdf";
const STOCK_POINT = "D:/Gail/GAIL STOCK POINT.pdf";
const INDEX = "D:/Gail2/gailcpe/backend/data/normalized/price_index.json";
const REPORT = "D:/Gail2/gail-extraction-audit.txt";

const HEADER = /^Sl\.\s*No\.?\s+SAP\s+(CODE|Code)\s+(LOCATION\/GRADE|STOCKPOINT)/i;
const LABEL_HEAD = /^(LOCATION\/GRADE|STOCKPOINT\s+LOCATION|STOCKPOINT)$/i;
const PRICE_FLOOR = 1000;

/** The shape extractors/gail.py will accept, for comparison only. */
const ETL_GRADE = /^[A-Z]{1,2}\d[0-9A-Z]{3,}$/;

const mid = (w: Word) => (w.x0 + w.x1) / 2;
/** "I56A200U A" is one code the sheet had to break; the space is not part of it. */
const tidy = (s: string) => s.replace(/\s+/g, "");

interface Band { code: string; x: number; lo: number; hi: number }

export interface GailRead {
  table: Record<string, Record<string, number>>;
  grades: string[];
  stats: {
    orphanRowsJoined: number;
    headerRows: number; blocks: number;
    columnsSeen: number;
    columnsWithSpace: string[];
    columnsEtlWouldTruncate: string[];
    dataRows: number; rowsWithNoLocation: number; noLocationSamples: string[];
    valuesSeen: number; valuesAssigned: number; valuesUnassigned: number; collisions: number;
    unassignedSamples: string[]; collisionSamples: string[];
    maxAssignDistance: number;
  };
}

function bandsFrom(words: Word[]): Band[] {
  const sorted = [...words].sort((a, b) => mid(a) - mid(b));
  return sorted.map((w, i) => {
    const prev = sorted[i - 1], next = sorted[i + 1];
    const x = mid(w);
    return {
      code: tidy(w.text), x,
      lo: prev ? (mid(prev) + x) / 2 : x - 24,
      hi: next ? (x + mid(next)) / 2 : x + 24,
    };
  });
}

export async function readGail(path: string): Promise<GailRead> {
  const rawRows = await readRows(readFileSync(path));
  const rows = mergeOrphanRows(rawRows);
  const table: GailRead["table"] = {};
  const grades: string[] = [];
  const stats: GailRead["stats"] = {
    orphanRowsJoined: rawRows.length - rows.length,
    headerRows: 0, blocks: 0, columnsSeen: 0, columnsWithSpace: [], columnsEtlWouldTruncate: [],
    dataRows: 0, rowsWithNoLocation: 0, noLocationSamples: [],
    valuesSeen: 0, valuesAssigned: 0, valuesUnassigned: 0, collisions: 0,
    unassignedSamples: [], collisionSamples: [], maxAssignDistance: 0,
  };

  const byPage = new Map<number, PdfRow[]>();
  for (const r of rows) (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)!).push(r);

  const seenBlocks = new Set<string>();

  for (const [, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...pageRows].sort((a, b) => a.top - b.top);
    const headerRow = sorted.find((r) => HEADER.test(r.text.trim()));
    if (!headerRow) continue;
    stats.headerRows++;

    const labelHead = headerRow.words.find((w) => LABEL_HEAD.test(w.text.trim()));
    if (!labelHead) continue;
    const bands = bandsFrom(headerRow.words.filter((w) => w.x0 > labelHead.x1));
    if (!bands.length) continue;

    const key = bands.map((b) => b.code).join("|");
    if (!seenBlocks.has(key)) {
      seenBlocks.add(key);
      stats.blocks++;
      stats.columnsSeen += bands.length;
      for (const b of bands) {
        if (!grades.includes(b.code)) grades.push(b.code);
        const raw = headerRow.words.find((w) => tidy(w.text) === b.code)?.text ?? b.code;
        if (/\s/.test(raw)) {
          stats.columnsWithSpace.push(raw);
          // Per-word matching keeps only the fragment that matches the shape.
          const kept = raw.split(/\s+/).filter((t) => ETL_GRADE.test(t)).join("");
          if (kept !== b.code) stats.columnsEtlWouldTruncate.push(`${raw.replace(/\s+/g, "\u2423")} -> ${kept || "(dropped)"}`);
        }
      }
    }

    // Where the label ends: the left edge of the first grade band.
    const labelLimit = bands[0]!.lo;

    for (const r of sorted.filter((x) => x.top > headerRow.top)) {
      const joined = joinNumericFragments(r.words);
      const values = joined.filter((w) => isNumber(w.text) && parseNumber(w.text) >= PRICE_FLOOR && mid(w) >= labelLimit);
      if (!values.length) continue;

      // The label is everything left of the first grade column; strip the
      // serial and the SAP code, both of which are short alphanumeric tokens.
      const labelWords = r.words.filter((w) => mid(w) < labelLimit);
      const tokens = labelWords.map((w) => w.text);
      while (tokens.length && (/^\d{1,4}$/.test(tokens[0]!) || /^[A-Z0-9]{1,2}$/.test(tokens[0]!))) tokens.shift();
      const location = tokens.join(" ").trim();
      if (!location) {
        stats.rowsWithNoLocation++;
        if (stats.noLocationSamples.length < 12) stats.noLocationSamples.push(`p${r.page} top=${r.top.toFixed(0)}: ${r.text.slice(0, 80)}`);
        continue;
      }
      stats.dataRows++;

      const cell = (table[location] ??= {});
      for (const w of values) {
        const x = mid(w), v = parseNumber(w.text);
        stats.valuesSeen++;
        let best: Band | null = null, bestD = Infinity;
        for (const b of bands) { const d = Math.abs(b.x - x); if (d < bestD) { bestD = d; best = b; } }
        const band = bands.find((b) => x >= b.lo && x < b.hi) ?? (bestD <= 14 ? best : null);
        if (!band) {
          stats.valuesUnassigned++;
          if (stats.unassignedSamples.length < 12)
            stats.unassignedSamples.push(`${location} ${v} x=${x.toFixed(0)} nearest ${best?.code}@${best?.x.toFixed(0)} d=${bestD.toFixed(1)}`);
          continue;
        }
        stats.maxAssignDistance = Math.max(stats.maxAssignDistance, Math.abs(band.x - x));
        if (cell[band.code] !== undefined && cell[band.code] !== v) {
          stats.collisions++;
          if (stats.collisionSamples.length < 12) stats.collisionSamples.push(`${location} ${band.code}: ${cell[band.code]} vs ${v}`);
        }
        cell[band.code] = v;
        stats.valuesAssigned++;
      }
    }
  }
  return { table, grades, stats };
}

async function main() {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };
  const n = (v: number) => v.toLocaleString("en-IN");

  for (const [tag, path] of [["EX-WORKS", EX_WORKS], ["STOCK POINT", STOCK_POINT]] as const) {
    const read = await readGail(path);
    const s = read.stats;
    say("=".repeat(92));
    say(`INDEPENDENT GAIL READ — ${tag}`);
    say("=".repeat(92));
    say(`orphan rows joined             : ${s.orphanRowsJoined}`);
    say(`header rows / distinct blocks  : ${s.headerRows} / ${s.blocks}`);
    say(`column headings seen           : ${s.columnsSeen} (${read.grades.length} distinct grades)`);
    say(`headings the sheet split       : ${s.columnsWithSpace.length}`);
    say(`  the ETL would truncate       : ${s.columnsEtlWouldTruncate.length}`);
    for (const t of s.columnsEtlWouldTruncate) say(`      ${t}`);
    say(`data rows read                 : ${s.dataRows}`);
    say(`rows with no location          : ${s.rowsWithNoLocation}`);
    for (const x of s.noLocationSamples) say(`      ${x}`);
    say(`values seen                    : ${n(s.valuesSeen)}`);
    say(`  assigned                     : ${n(s.valuesAssigned)}`);
    say(`  UNASSIGNED                   : ${n(s.valuesUnassigned)}`);
    say(`  collisions                   : ${n(s.collisions)}`);
    say(`largest assign distance        : ${s.maxAssignDistance.toFixed(1)} pt`);
    for (const x of s.unassignedSamples) say(`      unassigned: ${x}`);
    for (const x of s.collisionSamples) say(`      collision:  ${x}`);
    say(`locations                      : ${Object.keys(read.table).length}`);
    const counts = new Map<number, number>();
    for (const c of Object.values(read.table)) counts.set(Object.keys(c).length, (counts.get(Object.keys(c).length) ?? 0) + 1);
    say(`locations by grade count       : ${[...counts].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}->${v}`).join("  ")}`);
    say(`grades: ${read.grades.join(" ")}`);
    say("");

    if (tag !== "EX-WORKS") continue;

    const theirs = JSON.parse(readFileSync(INDEX, "utf8")).producers.GAIL.zones as Record<string, Record<string, number>>;
    const mine = read.table;
    say("=".repeat(92));
    say("COMPARISON AGAINST THE ETL INDEX (ex-works)");
    say("=".repeat(92));
    const myZ = Object.keys(mine).sort(), thZ = Object.keys(theirs).sort();
    say(`locations  mine ${myZ.length}   etl ${thZ.length}`);
    const onlyMine = myZ.filter((z) => !(z in theirs)), onlyEtl = thZ.filter((z) => !(z in mine));
    if (onlyMine.length) say(`  only in mine (${onlyMine.length}): ${onlyMine.slice(0, 20).join(" | ")}`);
    if (onlyEtl.length) say(`  only in etl  (${onlyEtl.length}): ${onlyEtl.slice(0, 20).join(" | ")}`);

    // Grade names differ by the truncation, so compare on the ETL's own naming.
    const fold = (g: string) => g.replace(/A$/, "");
    let same = 0, differ = 0, missEtl = 0, missMine = 0, renamed = 0;
    const diffs: string[] = [], renames = new Set<string>();
    for (const z of thZ.filter((z) => z in mine)) {
      const a = mine[z]!, b = theirs[z]!;
      for (const g of Object.keys(a)) {
        let vb = b[g];
        if (vb === undefined && b[fold(g)] !== undefined) { vb = b[fold(g)]; renamed++; renames.add(`${g} -> ${fold(g)}`); }
        const va = a[g]!;
        if (vb === undefined) { missEtl++; if (diffs.length < 20) diffs.push(`MISSING-IN-ETL ${z} ${g} = ${va}`); continue; }
        if (Math.abs(va - vb) < 0.005) same++;
        else { differ++; if (diffs.length < 20) diffs.push(`${z} ${g}: etl ${vb} vs mine ${va}`); }
      }
      for (const g of Object.keys(b)) if (a[g] === undefined && !Object.keys(a).some((k) => fold(k) === g)) missMine++;
    }
    say(`\ncells identical (values)       : ${n(same)}`);
    say(`cells differing (values)       : ${n(differ)}`);
    say(`present in mine, absent in ETL : ${n(missEtl)}`);
    say(`present in ETL, absent in mine : ${n(missMine)}`);
    say(`cells matched only after undoing the ETL's name truncation: ${n(renamed)}`);
    if (renames.size) { say(`\n  truncated grade names (${renames.size}):`); for (const r of renames) say(`    ${r}`); }
    if (diffs.length) { say(`\n  differences:`); for (const d of diffs) say(`    ${d}`); }
  }

  writeFileSync(REPORT, out.join("\n"));
  console.log(`\n(written to ${REPORT})`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
