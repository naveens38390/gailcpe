/**
 * HMEL's grade dictionary, taken from the circular's own structure.
 *
 * The earlier audit could not read HMEL's headers because it looked for a code
 * *shape*, and HMEL does not have one shape: the HDPE pages use M0252S, the
 * LLDPE pages use F517LMV, and the off-grade columns use OGHDBD. Any pattern
 * wide enough to admit all three admits nonsense as well.
 *
 * So this asks the document instead of guessing. Every grade column carries
 * exactly one Ex-Bathinda basic price, and those prices are clean, widely
 * separated words. They therefore *define* the columns: one column per price,
 * centred on it, with boundaries halfway to its neighbours. A column's code is
 * then just the header characters that fall inside it, read left to right —
 * whatever shape they happen to spell.
 *
 * Codes are allowed to stack over two lines, as HMEL sets some of them, so
 * characters are ordered by line and then by x before being joined.
 *
 * Read-only.
 */

import { readFileSync } from "node:fs";
import { readRows, mergeOrphanRows, isNumber, parseNumber, type PdfRow, type Word } from "../modules/circulars/pdf-table-reader";

const SECTION = /Ex-(Bathinda|Depot)[\s\S]{0,40}?(HDPE|LLDPE)\s+(Prime|Non-Prime)/i;
const BASIC_ROW = /Price\s*\(\s*Rs\s*\/\s*MT/i;
const ADJUST_ROW = /Locational\s*Adjustment/i;
/** A basic price is five or six figures; adjustments are smaller. */
const BASIC_MIN = 50_000;
/** Page titles, section headings and captions that are not grade headers. */
const FURNITURE = /HPCL|Mittal|Ex-?\s*Bathinda|Ex-?\s*Depot|Basic|Price|Grades|Locational|Location/i;

export interface Section {
  place: "bathinda" | "depot";
  polymer: "HDPE" | "LLDPE";
  quality: "prime" | "non-prime";
  page: number;
  columns: Array<{ code: string; x: number; lo: number; hi: number; basic: number }>;
  adjustments: Record<string, Record<string, number>>;
}

const flatten = (r: PdfRow) => r.words.map((w) => w.text).join("");

/**
 * Tidy a code read off the page.
 *
 * The leftmost band of a section also catches the polymer label sitting at the
 * page edge, so the first non-prime column reads "PEN0252S" or "LLDPEN0120L".
 * Strip that where a whole code remains behind it. HMEL also stacks two codes
 * in one column over two lines — "R0150S/R0151D" — which is the column offering
 * either grade, and is left as printed rather than silently resolved to one.
 */
function tidyCode(raw: string): string {
  return raw.replace(/^(?:LLDPE|HDPE|PE)(?=[A-Z]\d)/, "");
}

/** Column bands from the basic-price row: one per price, split at the midpoints. */
function bandsFrom(prices: Array<{ v: number; x: number }>) {
  const sorted = [...prices].sort((a, b) => a.x - b.x);
  return sorted.map((p, i) => {
    const prev = sorted[i - 1], next = sorted[i + 1];
    return {
      x: p.x,
      basic: p.v,
      lo: prev ? (prev.x + p.x) / 2 : p.x - 40,
      hi: next ? (p.x + next.x) / 2 : p.x + 40,
    };
  });
}

export async function readSections(path: string): Promise<Section[]> {
  const rows = mergeOrphanRows(await readRows(readFileSync(path)));
  const sections: Section[] = [];

  // Group rows by page so a section's header and prices are found together.
  const byPage = new Map<number, PdfRow[]>();
  for (const r of rows) (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)!).push(r);

  let carried: { place: Section["place"]; polymer: Section["polymer"]; quality: Section["quality"] } | null = null;

  for (const [page, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const head = pageRows.find((r) => SECTION.test(r.text) || SECTION.test(flatten(r)));
    if (head) {
      const m = (SECTION.exec(head.text) ?? SECTION.exec(flatten(head)))!;
      carried = {
        place: m[1]!.toLowerCase() as Section["place"],
        polymer: m[2]!.toUpperCase() as Section["polymer"],
        quality: m[3]!.toLowerCase() as Section["quality"],
      };
    }
    if (!carried) continue;

    const basicRow = pageRows.find(
      (r) => BASIC_ROW.test(flatten(r)) && r.words.some((w) => isNumber(w.text) && parseNumber(w.text) >= BASIC_MIN),
    );
    if (!basicRow) continue;

    const prices = basicRow.words
      .filter((w) => isNumber(w.text) && parseNumber(w.text) >= BASIC_MIN)
      .map((w) => ({ v: parseNumber(w.text), x: (w.x0 + w.x1) / 2 }));
    if (!prices.length) continue;
    const bands = bandsFrom(prices);

    // The grade codes sit on the row nearest above the basic price, under the
    // application labels ("Monofilament", "HDFilm") and the page furniture.
    // Taking everything above the prices sweeps all of that in, so walk up from
    // the prices instead and stop at the first real row — plus the one above it
    // when HMEL has stacked a code over two lines.
    const above = pageRows.filter((r) => r.top < basicRow.top).sort((a, b) => b.top - a.top);
    const codeRows: PdfRow[] = [];
    for (const r of above) {
      if (FURNITURE.test(flatten(r))) continue;
      if (!codeRows.length) { codeRows.push(r); continue; }
      if (codeRows[codeRows.length - 1]!.top - r.top <= 8) codeRows.push(r);
      break;
    }

    const left = Math.min(...bands.map((b) => b.lo));
    const right = Math.max(...bands.map((b) => b.hi));
    const headerChars: Array<Word & { top: number }> = [];
    for (const r of codeRows) {
      for (const w of r.words) {
        // Digits are not skipped here: a code arrives one character at a time,
        // so the "0252" of M0252S is four numeric words. Dropping them leaves
        // "MS", which is how the codes came back truncated at first.
        const mid = (w.x0 + w.x1) / 2;
        if (mid < left || mid > right) continue;
        headerChars.push({ ...w, top: r.top });
      }
    }

    const columns = bands.map((b) => {
      const mine = headerChars
        .filter((c) => { const m = (c.x0 + c.x1) / 2; return m >= b.lo && m < b.hi; })
        .sort((p, q) => (p.top - q.top) || (p.x0 - q.x0));
      return { code: tidyCode(mine.map((c) => c.text).join("").trim()), x: b.x, lo: b.lo, hi: b.hi, basic: b.basic };
    });

    // Locational adjustments, on the same page, under the adjustment caption.
    const adjustments: Record<string, Record<string, number>> = {};
    let inAdjust = false;
    for (const r of pageRows) {
      if (ADJUST_ROW.test(flatten(r))) { inAdjust = true; continue; }
      if (!inAdjust) continue;
      const numeric = r.words.filter((w) => isNumber(w.text));
      if (!numeric.length) continue;
      const boundary = Math.min(...numeric.map((w) => w.x0));
      const label = r.words.filter((w) => w.x0 < boundary).map((w) => w.text).join(" ").trim();
      if (!label || /^\d/.test(label)) continue;
      const cell = (adjustments[label] ??= {});
      for (const w of numeric) {
        const mid = (w.x0 + w.x1) / 2;
        const band = columns.find((c) => mid >= c.lo && mid < c.hi);
        if (band && band.code) cell[band.code] = parseNumber(w.text);
      }
    }

    sections.push({ ...carried, page, columns, adjustments });
  }
  return sections;
}

/**
 * One column, one price, but sometimes two grades.
 *
 * HMEL stacks a pair of codes in a single column — "R0150S/R0151D" — meaning
 * the column serves either grade at that price. Both are real grades and both
 * should be priced; production carries R0151D from exactly this column, which
 * is the check that this reading is right.
 */
export function expandCodes(code: string): string[] {
  return code.split("/").map((c) => c.trim()).filter(Boolean);
}

/** ex-works = ex-Bathinda basic less that location's adjustment. */
export function buildIndex(sections: Section[]) {
  const basic: Record<string, number> = {};
  const exWorks: Record<string, Record<string, number>> = {};
  for (const s of sections) {
    if (s.place !== "bathinda") continue;
    for (const c of s.columns) for (const g of expandCodes(c.code)) basic[g] ??= c.basic;
    for (const [loc, cells] of Object.entries(s.adjustments)) {
      for (const [code, adj] of Object.entries(cells)) {
        for (const g of expandCodes(code)) {
          const b = basic[g];
          if (b === undefined) continue;
          (exWorks[loc] ??= {})[g] = b - adj;
        }
      }
    }
  }
  return { basic, exWorks };
}

async function main() {
  const sections = await readSections(process.argv[2] ?? "D:/Gail/HMEL.pdf");
  console.log(`sections read: ${sections.length}`);
  for (const s of sections) {
    const named = s.columns.filter((c) => c.code).length;
    console.log(`  p${String(s.page).padStart(2)} ${s.place}/${s.polymer}/${s.quality}: ${s.columns.length} columns, ${named} named, ${Object.keys(s.adjustments).length} locations`);
    console.log(`      codes: ${s.columns.map((c) => c.code || "?").slice(0, 14).join(" ")}`);
  }
  const { basic, exWorks } = buildIndex(sections);
  console.log(`\ndistinct grades: ${Object.keys(basic).length}`);
  console.log(`locations: ${Object.keys(exWorks).length}`);
  console.log(`grades: ${Object.keys(basic).sort().join(" ")}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
