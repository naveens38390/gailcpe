/**
 * Independent read of HPL's (Haldia's) price list, for comparison against the ETL.
 *
 * Deliberately not a port of extractors/haldia.py. That reader recognises a
 * grade column by a code *shape* — one token, letters and digits, three to ten
 * characters — and HPL's off-grade columns are not that shape: they are set as
 * "HD OG (E)", three tokens with a space and brackets. A header word failing
 * the shape is not merely skipped; in the alias pass it never becomes an alias
 * at all, and in the column pass its values snap to whichever column was
 * recognised nearest.
 *
 * So this takes the structure at its word. The widest header row under a
 * section caption *is* the column list, whatever its words spell; the rows
 * below it, up to "PRICE POINTS", are alternate names for the column they sit
 * over. Values are placed by the column band containing them, and anything
 * unplaceable is counted rather than dropped in silence.
 *
 * Annexure I  — HDPE ex-works   (feeds the price index)
 * Annexure II — HDPE ex-stock   (not used by the index; read for completeness)
 * Annexure III— LLDPE, ex-works and ex-stock side by side in one table
 *
 * Read-only — writes a report, changes nothing.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/hpl-price-audit.ts [pdf] [index] [report]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readRows, mergeOrphanRows, isNumber, parseNumber, type PdfRow, type Word } from "../modules/circulars/pdf-table-reader";

const [PDF, INDEX, REPORT] = [
  process.argv[2] ?? "D:/Gail/Haldia.pdf",
  process.argv[3] ?? "D:/Gail2/gailcpe/backend/data/normalized/price_index.json",
  process.argv[4] ?? "D:/Gail2/hpl-extraction-audit.txt",
];

const ANNEXURE = /^Annexure\s*-\s*([IVX]+)/;
/** The last line of the header block, immediately above the first data row. */
const POINTS_ROW = /^PRICE\s*POINTS/i;
/** Captions that open a price block; the header rows follow them. */
const CAPTION = /Basic\s*Price|Ex-Works\s*Price|Ex-Stock\s*Point\s*Price/i;
/** A price here is five or six figures. */
const PRICE_FLOOR = 1000;
/** Words left of the table proper: the "Grades" and "PRICE POINTS" stubs. */
const STUB = /^(Grades|PRICE\s*POINTS|Basic|Price|\(Rs\.?\/MT\))/i;

/** The shape extractors/haldia.py will accept, for comparison only. */
const ETL_GRADE = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9][A-Z0-9-]{2,9}$/;

export interface Band { code: string; x: number; lo: number; hi: number }

export interface HplRead {
  /** Annexure -> block -> point -> grade -> price. */
  blocks: Record<string, Record<string, Record<string, number>>>;
  /** alias -> primary column code. */
  aliases: Record<string, string>;
  columns: Record<string, string[]>;
  stats: {
    orphanRowsJoined: number;
    headerBlocks: number;
    columnsSeen: number;
    columnsEtlWouldMiss: string[];
    aliasesSeen: number;
    aliasesEtlWouldMiss: string[];
    dataRows: number;
    labelsHeldOver: number;
    rowsDroppedNoLabel: number;
    droppedSamples: string[];
    valuesSeen: number; valuesAssigned: number; valuesUnassigned: number; collisions: number;
    unassignedSamples: string[]; collisionSamples: string[];
    maxAssignDistance: number;
  };
}

const mid = (w: Word) => (w.x0 + w.x1) / 2;

/** Column bands from the primary header row: one per code, split at midpoints. */
function bandsFrom(words: Word[]): Band[] {
  const sorted = [...words].sort((a, b) => mid(a) - mid(b));
  return sorted.map((w, i) => {
    const prev = sorted[i - 1], next = sorted[i + 1];
    const x = mid(w);
    return {
      code: w.text.trim(),
      x,
      lo: prev ? (mid(prev) + x) / 2 : x - 30,
      hi: next ? (x + mid(next)) / 2 : x + 30,
    };
  });
}

export async function readHpl(path: string): Promise<HplRead> {
  const rawRows = await readRows(readFileSync(path));
  const rows = mergeOrphanRows(rawRows);
  const blocks: HplRead["blocks"] = {};
  const aliases: HplRead["aliases"] = {};
  const columns: HplRead["columns"] = {};
  const stats: HplRead["stats"] = {
    orphanRowsJoined: rawRows.length - rows.length,
    headerBlocks: 0, columnsSeen: 0, columnsEtlWouldMiss: [],
    aliasesSeen: 0, aliasesEtlWouldMiss: [],
    dataRows: 0, labelsHeldOver: 0, rowsDroppedNoLabel: 0, droppedSamples: [],
    valuesSeen: 0, valuesAssigned: 0, valuesUnassigned: 0, collisions: 0,
    unassignedSamples: [], collisionSamples: [], maxAssignDistance: 0,
  };

  const byPage = new Map<number, PdfRow[]>();
  for (const r of rows) (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)!).push(r);

  let annexure: string | null = null;
  let bands: Band[] = [];
  /** Annexure III sets two blocks side by side; blank for the single-block ones. */
  let split: { boundary: number; left: string; right: string } | null = null;

  for (const [page, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...pageRows].sort((a, b) => a.top - b.top);

    for (const r of sorted) {
      const m = ANNEXURE.exec(r.text.trim());
      if (m) { annexure = m[1]!; bands = []; split = null; }
    }
    if (!annexure) continue;

    // ---- locate this page's header block -----------------------------------
    const pointsRow = sorted.find((r) => POINTS_ROW.test(r.text.trim()));
    const captionRow = [...sorted].reverse().find((r) => CAPTION.test(r.text) && (!pointsRow || r.top < pointsRow.top));
    if (pointsRow && captionRow) {
      const headerRows = sorted.filter((r) => r.top > captionRow.top && r.top < pointsRow.top);
      // Words belonging to the table, not the left-hand stubs.
      const tableWords = (r: PdfRow) => r.words.filter((w) => !STUB.test(w.text) && !isNumber(w.text));
      const widest = headerRows.reduce<PdfRow | null>(
        (best, r) => (!best || tableWords(r).length > tableWords(best).length ? r : best), null);
      if (widest && tableWords(widest).length >= 4) {
        bands = bandsFrom(tableWords(widest));
        stats.headerBlocks++;
        stats.columnsSeen += bands.length;
        for (const b of bands) if (!ETL_GRADE.test(b.code)) stats.columnsEtlWouldMiss.push(b.code);
        columns[`${annexure}@p${page}`] = bands.map((b) => b.code);

        // A header whose second half repeats its first is two blocks side by
        // side. That repetition, not the centred caption, marks the seam.
        const half = bands.length / 2;
        if (Number.isInteger(half) && half > 0 &&
            bands.slice(0, half).map((b) => b.code).join("|") === bands.slice(half).map((b) => b.code).join("|")) {
          split = { boundary: (bands[half - 1]!.x + bands[half]!.x) / 2, left: "ex_works", right: "ex_stock" };
        }

        // Rows under the widest one name alternates for the column above them.
        for (const r of headerRows) {
          if (r === widest || r.top < widest.top) continue;
          for (const w of tableWords(r)) {
            const x = mid(w);
            const band = bands.find((b) => x >= b.lo && x < b.hi);
            if (!band || !band.code || band.code === w.text.trim()) continue;
            aliases[w.text.trim()] = band.code;
            stats.aliasesSeen++;
            if (!ETL_GRADE.test(w.text.trim())) stats.aliasesEtlWouldMiss.push(w.text.trim());
          }
        }
      }
    }
    if (!bands.length) continue;

    // ---- data rows ---------------------------------------------------------
    const start = pointsRow ? pointsRow.top : -Infinity;
    const body = sorted.filter((r) => r.top > start);
    let pending = "";

    for (const r of body) {
      const numeric = r.words.filter((w) => isNumber(w.text) && parseNumber(w.text) >= PRICE_FLOOR);
      if (!numeric.length) {
        const label = r.words.map((w) => w.text).join(" ").trim();
        if (label && !STUB.test(label) && !/^\d/.test(label)) { pending = label; stats.labelsHeldOver++; }
        continue;
      }
      const boundary = Math.min(...numeric.map((w) => w.x0));
      let label = r.words.filter((w) => w.x0 < boundary).map((w) => w.text).join(" ").trim();
      if (!label) { label = pending; pending = ""; }
      if (!label) {
        stats.rowsDroppedNoLabel++;
        if (stats.droppedSamples.length < 12) stats.droppedSamples.push(`p${r.page} top=${r.top.toFixed(0)} ${numeric.length} values: ${r.text.slice(0, 80)}`);
        continue;
      }
      stats.dataRows++;

      const place = (block: string, words: Word[]) => {
        const cell = ((blocks[`${annexure}:${block}`] ??= {})[label] ??= {});
        for (const w of words) {
          const x = mid(w), v = parseNumber(w.text);
          stats.valuesSeen++;
          let best: Band | null = null, bestD = Infinity;
          for (const b of bands) { const d = Math.abs(b.x - x); if (d < bestD) { bestD = d; best = b; } }
          const band = bands.find((b) => x >= b.lo && x < b.hi) ?? (bestD <= 12 ? best : null);
          if (!band) {
            stats.valuesUnassigned++;
            if (stats.unassignedSamples.length < 12)
              stats.unassignedSamples.push(`${annexure} ${label} ${v} x=${x.toFixed(0)} nearest ${best?.code}@${best?.x.toFixed(0)} d=${bestD.toFixed(1)}`);
            continue;
          }
          stats.maxAssignDistance = Math.max(stats.maxAssignDistance, Math.abs(band.x - x));
          if (cell[band.code] !== undefined && cell[band.code] !== v) {
            stats.collisions++;
            if (stats.collisionSamples.length < 12) stats.collisionSamples.push(`${annexure} ${label} ${band.code}: ${cell[band.code]} vs ${v}`);
          }
          cell[band.code] = v;
          stats.valuesAssigned++;
        }
      };

      if (split) {
        place(split.left, numeric.filter((w) => mid(w) < split!.boundary));
        place(split.right, numeric.filter((w) => mid(w) >= split!.boundary));
      } else {
        place("main", numeric);
      }
    }
  }

  return { blocks, aliases, columns, stats };
}

/** The HPL book as build.py assembles it: Annexure I plus Annexure III ex-works. */
export function assemble(read: HplRead): Record<string, Record<string, number>> {
  const zones: Record<string, Record<string, number>> = {};
  for (const key of ["I:main", "III:ex_works"]) {
    for (const [point, cells] of Object.entries(read.blocks[key] ?? {})) {
      Object.assign((zones[point] ??= {}), cells);
    }
  }
  for (const cells of Object.values(zones)) {
    for (const [alias, primary] of Object.entries(read.aliases)) {
      if (cells[primary] !== undefined && cells[alias] === undefined) cells[alias] = cells[primary]!;
    }
  }
  return zones;
}

async function main() {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };
  const n = (v: number) => v.toLocaleString("en-IN");

  const read = await readHpl(PDF);
  const s = read.stats;

  say("=".repeat(90));
  say("INDEPENDENT HPL (HALDIA) READ");
  say("=".repeat(90));
  say(`orphan rows joined             : ${s.orphanRowsJoined}`);
  say(`header blocks located          : ${s.headerBlocks}`);
  say(`column headings seen           : ${s.columnsSeen}`);
  say(`  the ETL's pattern would miss : ${s.columnsEtlWouldMiss.length}${s.columnsEtlWouldMiss.length ? " — " + [...new Set(s.columnsEtlWouldMiss)].join(" | ") : ""}`);
  say(`alias names seen               : ${s.aliasesSeen} (${Object.keys(read.aliases).length} distinct)`);
  say(`  the ETL's pattern would miss : ${s.aliasesEtlWouldMiss.length}${s.aliasesEtlWouldMiss.length ? " — " + [...new Set(s.aliasesEtlWouldMiss)].join(" | ") : ""}`);
  say(`data rows read                 : ${s.dataRows}`);
  say(`labels held over to next row   : ${s.labelsHeldOver}`);
  say(`rows dropped for want of label : ${s.rowsDroppedNoLabel}`);
  for (const d of s.droppedSamples) say(`    ${d}`);
  say(`values seen                    : ${n(s.valuesSeen)}`);
  say(`  assigned                     : ${n(s.valuesAssigned)}`);
  say(`  UNASSIGNED                   : ${n(s.valuesUnassigned)}`);
  say(`  collisions                   : ${n(s.collisions)}`);
  say(`largest assign distance        : ${s.maxAssignDistance.toFixed(1)} pt`);
  for (const u of s.unassignedSamples) say(`    unassigned: ${u}`);
  for (const c of s.collisionSamples) say(`    collision:  ${c}`);

  say(`\nblocks read:`);
  for (const [k, v] of Object.entries(read.blocks)) {
    const cells = Object.values(v).reduce((t, c) => t + Object.keys(c).length, 0);
    say(`  ${k.padEnd(16)} ${String(Object.keys(v).length).padStart(3)} price points, ${n(cells)} cells`);
  }
  say(`\ncolumn lists:`);
  for (const [k, v] of Object.entries(read.columns)) say(`  ${k.padEnd(12)} (${v.length}) ${v.join(" ")}`);
  say(`\naliases (${Object.keys(read.aliases).length}):`);
  for (const [a, p] of Object.entries(read.aliases)) say(`  ${a.padEnd(12)} -> ${p}`);

  // ---- reconciliation ------------------------------------------------------
  const mine = assemble(read);
  const theirs = JSON.parse(readFileSync(INDEX, "utf8")).producers.HPL.zones as Record<string, Record<string, number>>;

  say(`\n${"=".repeat(90)}`);
  say("COMPARISON AGAINST THE ETL INDEX (ex-works)");
  say("=".repeat(90));
  const myZ = Object.keys(mine).sort(), thZ = Object.keys(theirs).sort();
  say(`price points  mine ${myZ.length}   etl ${thZ.length}`);
  const onlyMine = myZ.filter((z) => !(z in theirs)), onlyEtl = thZ.filter((z) => !(z in mine));
  if (onlyMine.length) say(`  only in mine (${onlyMine.length}): ${onlyMine.join(" | ")}`);
  if (onlyEtl.length) say(`  only in etl  (${onlyEtl.length}): ${onlyEtl.join(" | ")}`);

  let same = 0, differ = 0, missEtl = 0, missMine = 0;
  const diffs: string[] = [], gaps = new Map<string, number>(), gapSamples: string[] = [];
  for (const z of thZ.filter((z) => z in mine)) {
    const a = mine[z]!, b = theirs[z]!;
    for (const g of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[g], vb = b[g];
      if (va === undefined) { missMine++; if (diffs.length < 40) diffs.push(`ETL-ONLY ${z} ${g} = ${vb}`); continue; }
      if (vb === undefined) {
        missEtl++; gaps.set(g, (gaps.get(g) ?? 0) + 1);
        if (gapSamples.length < 10) gapSamples.push(`${z} ${g} = ${va}`);
        continue;
      }
      if (Math.abs(va - vb) < 0.005) same++;
      else { differ++; if (diffs.length < 40) diffs.push(`${z} ${g}: etl ${vb} vs mine ${va}`); }
    }
  }
  say(`\ncells identical                : ${n(same)}`);
  say(`cells differing                : ${n(differ)}`);
  say(`present in mine, absent in ETL : ${n(missEtl)}${gaps.size ? ` across ${gaps.size} grades` : ""}`);
  say(`present in ETL, absent in mine : ${n(missMine)}`);
  if (gaps.size) { say(`\n  grades the ETL lacks:`); for (const [g, c] of [...gaps].sort((a, b) => b[1] - a[1])) say(`    ${g.padEnd(12)} ${c} price points`); }
  for (const g of gapSamples) say(`    e.g. ${g}`);
  if (diffs.length) { say(`\n  differences:`); for (const d of diffs) say(`    ${d}`); }

  writeFileSync(REPORT, out.join("\n"));
  console.log(`\n(written to ${REPORT})`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
