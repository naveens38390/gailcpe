/**
 * Independent read of HMEL's price circular, for comparison against the ETL.
 *
 * Deliberately not a port of extractors/hmel.py. HMEL is the awkward one in the
 * pack for two reasons, and both are the point of reading it separately.
 *
 * Its ex-works price is *derived*, not printed: an Ex-Bathinda basic price per
 * grade, less a locational adjustment per town. Getting the sign wrong would
 * overstate HMEL by twice the adjustment at every location, so the arithmetic
 * is worth an independent check as much as the parsing is.
 *
 * And its grade headers arrive one character at a time — "M 0 2 5 2 S" — so
 * codes have to be rebuilt from character geometry before any column can be
 * identified. Characters inside a code sit within a couple of points of each
 * other; codes are separated by roughly twice that.
 *
 * Every value that fails to reach a column is counted rather than dropped
 * quietly. Read-only: writes a report, changes nothing.
 *
 * STATUS: incomplete, and useful anyway. Unlike the RIL audit this does not
 * reconcile cell-for-cell, because HMEL's grade codes are not one shape. The
 * HDPE pages are regular — a letter, four digits, one or two letters — but the
 * LLDPE pages carry F517LMV and F327LME, three digits with a three-letter
 * suffix, and the off-grade columns are OGHDBD and OGHDES, which have no digits
 * at all. No single pattern reads all of them, so a run of fused codes cannot
 * always be split correctly and the column map for those sections is wrong.
 *
 * That limitation is shared with extractors/hmel.py, which uses the same
 * four-digit pattern — which is why running this was worth it even unfinished:
 * the grades neither reader can see are missing from production too. Finishing
 * it needs HMEL's actual grade list as an authority rather than a pattern
 * guessed from the page.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/hmel-price-audit.ts [pdf] [price_index.json] [report.txt]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readRows, mergeOrphanRows, isNumber, parseNumber, type PdfRow, type Word } from "../modules/circulars/pdf-table-reader";

const [PDF, INDEX, REPORT] = [
  process.argv[2] ?? "D:/Gail/HMEL.pdf",
  process.argv[3] ?? "D:/Gail2/gailcpe/backend/data/normalized/price_index.json",
  process.argv[4] ?? "D:/Gail2/hmel-extraction-audit.txt",
];

/** B0155D, M0252S, P0142SU — a letter, four digits, one or two letters. */
const GRADE_CODE = /^[A-Z]\d{4}[A-Z]{1,2}$/;
const GRADE_CODE_G = /[A-Z]\d{4}[A-Z]{1,2}/g;
// "Ex-Bathinda Price: HDPE Prime Grades:" — the colon after Price is part of
// the heading, so the span between producer and polymer must be allowed to
// cross punctuation.
const SECTION = /Ex-(Bathinda|Depot)[\s\S]{0,40}?(HDPE|LLDPE)\s+(Prime|Non-Prime)/i;
// The basic prices sit on the row reading "Price(Rs/MT)", one line below the
// "Ex Bathinda Basic" caption — the caption row carries no numbers at all.
const BASIC_ROW = /Price\s*\(\s*Rs\s*\/\s*MT/i;
const ADJUST_ROW = /Locational\s*Adjustment/i;
/** Characters closer than this belong to the same token. */
const CHAR_GAP = 3.5;
/** A value must sit this close to a grade column to be attributed to it. */
const COLUMN_RADIUS = 14;

interface Column { grade: string; x: number }

interface Stats {
  orphanRowsJoined: number;
  sectionsFound: number;
  gradeColumnsBuilt: number;
  basicValuesSeen: number; basicAssigned: number; basicUnassigned: number;
  adjustRowsSeen: number; adjustValuesSeen: number; adjustAssigned: number; adjustUnassigned: number;
  collisions: number;
  unassignedSamples: string[];
  collisionSamples: string[];
  maxAssignDistance: number;
}

/** Rebuild whole tokens from a row of individual characters. */
function tokens(words: Word[]): Array<{ text: string; x0: number; x1: number }> {
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  const out: Array<{ text: string; x0: number; x1: number }> = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.x0 - last.x1 <= CHAR_GAP) {
      last.text += w.text;
      last.x1 = w.x1;
    } else {
      out.push({ text: w.text, x0: w.x0, x1: w.x1 });
    }
  }
  return out;
}

/**
 * Split a run of fused codes, requiring the whole run to resolve.
 *
 * A code's suffix is one letter or two, and a plain greedy match takes two
 * whenever it can — which swallows the first letter of the code behind it, so
 * "B0151D" followed by "N0861S" reads as "B0151DN" and then nothing. Trying
 * both suffix lengths and keeping only the split that consumes the entire run
 * removes the ambiguity: "M0861SUB0155D" resolves as M0861SU + B0155D because
 * the six-letter reading leaves "UB0155D", which is not a code.
 */
function splitCodes(text: string): string[] | null {
  const walk = (at: number): string[] | null => {
    if (at === text.length) return [];
    for (const len of [6, 7]) {
      const piece = text.slice(at, at + len);
      if (piece.length !== len || !GRADE_CODE.test(piece)) continue;
      const rest = walk(at + len);
      if (rest) return [piece, ...rest];
    }
    return null;
  };
  return walk(0);
}

/**
 * Separate grade codes that ran together into one token.
 *
 * The gap between characters inside a code and the gap between two codes are
 * not reliably different — 1pt within "M0252S", but 3pt between "M0662D" and
 * "M0861S" against 6pt elsewhere — so no threshold splits them. The codes are
 * a fixed shape, though, so re-read the token against that shape and spread the
 * token's own width across the codes by character count, which is where those
 * columns actually sit.
 */
function splitFusedCodes(
  toks: Array<{ text: string; x0: number; x1: number }>,
): Array<{ text: string; x0: number; x1: number }> {
  const out: Array<{ text: string; x0: number; x1: number }> = [];
  for (const t of toks) {
    const found = splitCodes(t.text);
    if (!found || found.length <= 1) { out.push(t); continue; }
    const total = found.reduce((n, c) => n + c.length, 0);
    const span = t.x1 - t.x0;
    let consumed = 0;
    for (const code of found) {
      out.push({
        text: code,
        x0: t.x0 + (span * consumed) / total,
        x1: t.x0 + (span * (consumed + code.length)) / total,
      });
      consumed += code.length;
    }
  }
  return out;
}

export interface HmelRead {
  basic: Record<string, number>;
  adjustments: Record<string, Record<string, number>>;
  exWorks: Record<string, Record<string, number>>;
  stats: Stats;
}

export async function readHmel(path: string): Promise<HmelRead> {
  const rawRows = await readRows(readFileSync(path));
  const rows = mergeOrphanRows(rawRows);
  const stats: Stats = {
    orphanRowsJoined: rawRows.length - rows.length,
    sectionsFound: 0, gradeColumnsBuilt: 0,
    basicValuesSeen: 0, basicAssigned: 0, basicUnassigned: 0,
    adjustRowsSeen: 0, adjustValuesSeen: 0, adjustAssigned: 0, adjustUnassigned: 0,
    collisions: 0, unassignedSamples: [], collisionSamples: [], maxAssignDistance: 0,
  };

  const basic: Record<string, number> = {};
  const adjustments: Record<string, Record<string, number>> = {};

  let section: { place: string; polymer: string; quality: string } | null = null;
  let columns: Column[] = [];
  let inAdjustment = false;

  const assign = (v: { value: number; x: number }, where: string): Column | null => {
    let best: Column | null = null, bestD = Infinity;
    for (const c of columns) { const d = Math.abs(c.x - v.x); if (d < bestD) { bestD = d; best = c; } }
    if (!best || bestD > COLUMN_RADIUS) {
      if (stats.unassignedSamples.length < 12) {
        stats.unassignedSamples.push(`${where} value=${v.value} x=${v.x.toFixed(0)} nearest=${best?.grade}@${best?.x.toFixed(0)} d=${bestD.toFixed(1)}`);
      }
      return null;
    }
    stats.maxAssignDistance = Math.max(stats.maxAssignDistance, bestD);
    return best;
  };

  for (const row of rows) {
    const flat = row.words.map((w) => w.text).join("");

    const sec = SECTION.exec(row.text) ?? SECTION.exec(flat);
    if (sec) {
      section = { place: sec[1]!.toLowerCase(), polymer: sec[2]!.toUpperCase(), quality: sec[3]!.toLowerCase() };
      stats.sectionsFound++;
      columns = [];
      inAdjustment = false;
      continue;
    }
    if (!section) continue;

    // A row of characters that rebuild into grade codes is a header.
    const toks = splitFusedCodes(tokens(row.words));
    const codes = toks.filter((t) => GRADE_CODE.test(t.text));
    if (codes.length >= 3) {
      for (const c of codes) {
        const x = (c.x0 + c.x1) / 2;
        if (!columns.some((k) => Math.abs(k.x - x) < 2 && k.grade === c.text)) {
          columns.push({ grade: c.text, x });
          stats.gradeColumnsBuilt++;
        }
      }
      continue;
    }

    if (ADJUST_ROW.test(flat)) { inAdjustment = true; continue; }
    if (!columns.length) continue;

    const numeric = row.words.filter((w) => isNumber(w.text));
    if (!numeric.length) continue;
    const values = numeric.map((w) => ({ value: parseNumber(w.text), x: (w.x0 + w.x1) / 2 }));

    if (BASIC_ROW.test(flat) && !inAdjustment) {
      for (const v of values) {
        stats.basicValuesSeen++;
        const col = assign(v, `basic ${section.polymer}/${section.quality}`);
        if (!col) { stats.basicUnassigned++; continue; }
        if (basic[col.grade] !== undefined && basic[col.grade] !== v.value) {
          stats.collisions++;
          if (stats.collisionSamples.length < 12) stats.collisionSamples.push(`basic ${col.grade}: ${basic[col.grade]} vs ${v.value}`);
        }
        basic[col.grade] = v.value;
        stats.basicAssigned++;
      }
      continue;
    }

    if (!inAdjustment || section.place !== "bathinda") continue;

    // A location row: leading text label, then one adjustment per grade column.
    const boundary = Math.min(...numeric.map((w) => w.x0));
    const label = row.words.filter((w) => w.x0 < boundary).map((w) => w.text).join(" ").trim();
    if (!label || /^\d/.test(label)) continue;
    stats.adjustRowsSeen++;
    const cell = (adjustments[label] ??= {});
    for (const v of values) {
      stats.adjustValuesSeen++;
      const col = assign(v, `adj ${label}`);
      if (!col) { stats.adjustUnassigned++; continue; }
      if (cell[col.grade] !== undefined && cell[col.grade] !== v.value) {
        stats.collisions++;
        if (stats.collisionSamples.length < 12) stats.collisionSamples.push(`adj ${label} ${col.grade}: ${cell[col.grade]} vs ${v.value}`);
      }
      cell[col.grade] = v.value;
      stats.adjustAssigned++;
    }
  }

  // ex-works = ex-Bathinda basic less the locational adjustment.
  const exWorks: Record<string, Record<string, number>> = {};
  for (const [location, cells] of Object.entries(adjustments)) {
    for (const [grade, adj] of Object.entries(cells)) {
      const b = basic[grade];
      if (b === undefined) continue;
      (exWorks[location] ??= {})[grade] = b - adj;
    }
  }
  return { basic, adjustments, exWorks, stats };
}

async function main() {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  const read = await readHmel(PDF);
  const theirs = JSON.parse(readFileSync(INDEX, "utf8")).producers.HMEL.zones as Record<string, Record<string, number>>;
  const mine = read.exWorks;

  say("=".repeat(86));
  say("INDEPENDENT HMEL READ");
  say("=".repeat(86));
  say(`orphan rows joined            : ${read.stats.orphanRowsJoined}`);
  say(`sections found                : ${read.stats.sectionsFound}`);
  say(`grade columns rebuilt         : ${read.stats.gradeColumnsBuilt}`);
  say(`distinct basic grades         : ${Object.keys(read.basic).length}`);
  say(`basic values   seen/assigned/unassigned : ${read.stats.basicValuesSeen} / ${read.stats.basicAssigned} / ${read.stats.basicUnassigned}`);
  say(`adjustment rows seen          : ${read.stats.adjustRowsSeen}`);
  say(`adjust values  seen/assigned/unassigned : ${read.stats.adjustValuesSeen} / ${read.stats.adjustAssigned} / ${read.stats.adjustUnassigned}`);
  say(`collisions (overwritten)      : ${read.stats.collisions}`);
  say(`largest assign distance       : ${read.stats.maxAssignDistance.toFixed(1)} pt (radius ${COLUMN_RADIUS})`);
  say(`locations derived             : ${Object.keys(mine).length}`);
  if (read.stats.unassignedSamples.length) { say(`\n  unassigned samples:`); for (const s of read.stats.unassignedSamples) say(`    ${s}`); }
  if (read.stats.collisionSamples.length) { say(`\n  collision samples:`); for (const s of read.stats.collisionSamples) say(`    ${s}`); }

  say(`\n${"=".repeat(86)}`);
  say("COMPARISON AGAINST THE ETL INDEX");
  say("=".repeat(86));
  const myZ = Object.keys(mine).sort(), thZ = Object.keys(theirs).sort();
  say(`zones  mine ${myZ.length}   etl ${thZ.length}`);
  const onlyMine = myZ.filter((z) => !(z in theirs)), onlyEtl = thZ.filter((z) => !(z in mine));
  if (onlyMine.length) say(`  only in mine (${onlyMine.length}): ${onlyMine.slice(0, 12).join(", ")}`);
  if (onlyEtl.length) say(`  only in etl  (${onlyEtl.length}): ${onlyEtl.slice(0, 12).join(", ")}`);

  let same = 0, differ = 0, missEtl = 0, missMine = 0;
  const diffs: string[] = [], gaps: string[] = [];
  for (const z of thZ.filter((z) => z in mine)) {
    const a = mine[z]!, b = theirs[z]!;
    for (const g of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[g], vb = b[g];
      if (va === undefined) { missMine++; if (gaps.length < 15) gaps.push(`${z} ${g} = ${vb} (etl only)`); continue; }
      if (vb === undefined) { missEtl++; if (gaps.length < 15) gaps.push(`${z} ${g} = ${va} (mine only)`); continue; }
      if (Math.abs(va - vb) < 0.005) same++;
      else { differ++; if (diffs.length < 15) diffs.push(`${z} ${g}: etl ${vb} vs mine ${va}`); }
    }
  }
  say(`\ncells identical               : ${same.toLocaleString("en-IN")}`);
  say(`cells differing               : ${differ.toLocaleString("en-IN")}`);
  say(`present in mine, absent in ETL : ${missEtl.toLocaleString("en-IN")}`);
  say(`present in ETL, absent in mine : ${missMine.toLocaleString("en-IN")}`);
  if (diffs.length) { say(`\n  differing samples:`); for (const d of diffs) say(`    ${d}`); }
  if (gaps.length) { say(`\n  coverage-gap samples:`); for (const g of gaps) say(`    ${g}`); }

  writeFileSync(REPORT, out.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
