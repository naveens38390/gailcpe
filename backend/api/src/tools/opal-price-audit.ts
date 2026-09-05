/**
 * Independent read of OPaL's DTA price circular, for comparison against the ETL.
 *
 * Deliberately not a port of extractors/opal.py. That reader recognises a grade
 * column by a code shape, and it finds the three label columns by taking the
 * three most common left edges in the block — a frequency measurement that a
 * few wrapped state names can move.
 *
 * This takes the header at its word instead. The header row reads
 * "Zone | Pricing Zone | State | <grades...>", so everything right of "State"
 * is a column whatever it spells, and the three label headings are anchors:
 * each label word joins the anchor nearest it. Values are placed by the column
 * band containing them, and anything unplaceable is counted, not dropped.
 *
 * Only the DTA circular feeds the price index (Annexures DTA-HDPE and
 * DTA-LLDPE). The CSA circular is read too, for completeness of the audit.
 *
 * Read-only — writes a report, changes nothing.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/opal-price-audit.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readRows, mergeOrphanRows, isNumber, parseNumber, type PdfRow, type Word } from "../modules/circulars/pdf-table-reader";

const DTA = process.argv[2] ?? "D:/Gail/OPaL Polymers DTA price circular_PE wef 1st August 2026.pdf";
const CSA = process.argv[3] ?? "D:/Gail/OPaL Polymers CSA price circular_PE wef 1st August 2026.pdf";
const INDEX = process.argv[4] ?? "D:/Gail2/gailcpe/backend/data/normalized/price_index.json";
const REPORT = "D:/Gail2/opal-extraction-audit.txt";

const HEADER = /^Zone\s+Pricing\s*Zone\s+State/i;
const ANNEXURE = /Annexure\s+(DTA-\s*(?:HDPE|LLDPE)|CS\d?-PE)/i;
const PRICE_FLOOR = 1000;
/** A data row carries a full set of prices; captions carry a stray digit or two. */
const MIN_VALUES = 5;

/** The shape extractors/opal.py will accept, for comparison only. */
const ETL_GRADE = /^(?=.*\d)[A-Z][A-Z0-9]{2,8}$|^U[A-Z]{3,4}$/;

const mid = (w: Word) => (w.x0 + w.x1) / 2;

interface Band { code: string; x: number; lo: number; hi: number }

export interface OpalRead {
  sheets: Record<string, Record<string, Record<string, number>>>;
  aliases: Record<string, string>;
  columns: Record<string, string[]>;
  stats: {
    orphanRowsJoined: number;
    headerRows: number;
    columnsSeen: number; columnsEtlWouldMiss: string[];
    aliasesSeen: number; aliasesEtlWouldMiss: string[];
    dataRows: number; rowsWithNoPricingZone: number; noZoneSamples: string[];
    continuationRows: number;
    valuesSeen: number; valuesAssigned: number; valuesUnassigned: number; collisions: number;
    unassignedSamples: string[]; collisionSamples: string[];
    maxAssignDistance: number;
    ambiguousLabels: string[];
  };
}

function bandsFrom(words: Word[]): Band[] {
  const sorted = [...words].sort((a, b) => mid(a) - mid(b));
  return sorted.map((w, i) => {
    const prev = sorted[i - 1], next = sorted[i + 1];
    const x = mid(w);
    return {
      // September stacks a pair of codes in one column, "F52H04/" over
      // "F52H02"; the slash belongs to the pairing, not to the grade's name.
      code: w.text.trim().replace(/\/+$/, ""), x,
      lo: prev ? (mid(prev) + x) / 2 : x - 24,
      hi: next ? (x + mid(next)) / 2 : x + 24,
    };
  });
}

export async function readOpal(path: string): Promise<OpalRead> {
  const rawRows = await readRows(readFileSync(path));
  const rows = mergeOrphanRows(rawRows);
  const sheets: OpalRead["sheets"] = {};
  const aliases: OpalRead["aliases"] = {};
  const columns: OpalRead["columns"] = {};
  const stats: OpalRead["stats"] = {
    orphanRowsJoined: rawRows.length - rows.length,
    headerRows: 0, columnsSeen: 0, columnsEtlWouldMiss: [],
    aliasesSeen: 0, aliasesEtlWouldMiss: [],
    dataRows: 0, rowsWithNoPricingZone: 0, noZoneSamples: [], continuationRows: 0,
    valuesSeen: 0, valuesAssigned: 0, valuesUnassigned: 0, collisions: 0,
    unassignedSamples: [], collisionSamples: [], maxAssignDistance: 0,
    ambiguousLabels: [],
  };

  const byPage = new Map<number, PdfRow[]>();
  for (const r of rows) (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)!).push(r);

  for (const [, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...pageRows].sort((a, b) => a.top - b.top);
    const headerRow = sorted.find((r) => HEADER.test(r.text.trim()));
    if (!headerRow) continue;
    const annRow = sorted.find((r) => ANNEXURE.test(r.text));
    const sheet = (ANNEXURE.exec(annRow?.text ?? "")?.[1] ?? "UNKNOWN").toUpperCase().replace(/\s+/g, "");

    // Label anchors and grade columns both come from the header row itself.
    const stateWord = headerRow.words.find((w) => /^State$/i.test(w.text));
    const zoneWord = headerRow.words.find((w) => /^Zone$/i.test(w.text));
    const pzWord = headerRow.words.find((w) => /^Pricing/i.test(w.text));
    if (!stateWord || !zoneWord || !pzWord) continue;
    const anchors = [mid(zoneWord), mid(pzWord), mid(stateWord)];

    const bands = bandsFrom(headerRow.words.filter((w) => w.x0 > stateWord.x1));
    if (!bands.length) continue;
    stats.headerRows++;
    stats.columnsSeen += bands.length;
    for (const b of bands) if (!ETL_GRADE.test(b.code)) stats.columnsEtlWouldMiss.push(b.code);
    columns[sheet] = bands.map((b) => b.code);

    const body = sorted.filter((r) => r.top > headerRow.top);
    let seenData = false;

    for (const r of body) {
      const numeric = r.words.filter((w) => isNumber(w.text) && parseNumber(w.text) >= PRICE_FLOOR);

      if (numeric.length < MIN_VALUES) {
        // Before the first data row, a bare row of codes names alternates for
        // the column above. After it, it is a wrapped state name.
        if (!seenData && r.words.length && r.words.every((w) => !isNumber(w.text))) {
          for (const w of r.words) {
            const x = mid(w);
            const band = bands.find((b) => x >= b.lo && x < b.hi);
            if (!band || band.code === w.text.trim()) continue;
            aliases[w.text.trim()] = band.code;
            stats.aliasesSeen++;
            if (!ETL_GRADE.test(w.text.trim())) stats.aliasesEtlWouldMiss.push(w.text.trim());
          }
        } else if (seenData) stats.continuationRows++;
        continue;
      }

      const boundary = Math.min(...numeric.map((w) => w.x0));
      const labelWords = r.words.filter((w) => w.x0 < boundary);
      const parts: string[][] = [[], [], []];
      for (const w of labelWords) {
        const x = mid(w);
        let slot = 0, bestD = Infinity;
        for (let i = 0; i < anchors.length; i++) {
          const d = Math.abs(anchors[i]! - x);
          if (d < bestD) { bestD = d; slot = i; }
        }
        const others = anchors.map((a) => Math.abs(a - x)).sort((p, q) => p - q);
        if (others[1]! - others[0]! < 6 && stats.ambiguousLabels.length < 12)
          stats.ambiguousLabels.push(`${w.text} x=${x.toFixed(0)} anchors ${anchors.map((a) => a.toFixed(0)).join("/")}`);
        parts[slot]!.push(w.text);
      }
      const pricingZone = parts[1]!.join(" ").trim();
      if (!pricingZone) {
        stats.rowsWithNoPricingZone++;
        if (stats.noZoneSamples.length < 12) stats.noZoneSamples.push(`p${r.page} top=${r.top.toFixed(0)}: ${r.text.slice(0, 90)}`);
        continue;
      }
      seenData = true;
      stats.dataRows++;

      const cell = ((sheets[sheet] ??= {})[pricingZone] ??= {});
      for (const w of numeric) {
        const x = mid(w), v = parseNumber(w.text);
        stats.valuesSeen++;
        let best: Band | null = null, bestD = Infinity;
        for (const b of bands) { const d = Math.abs(b.x - x); if (d < bestD) { bestD = d; best = b; } }
        const band = bands.find((b) => x >= b.lo && x < b.hi) ?? (bestD <= 10 ? best : null);
        if (!band) {
          stats.valuesUnassigned++;
          if (stats.unassignedSamples.length < 12)
            stats.unassignedSamples.push(`${sheet} ${pricingZone} ${v} x=${x.toFixed(0)} nearest ${best?.code}@${best?.x.toFixed(0)} d=${bestD.toFixed(1)}`);
          continue;
        }
        stats.maxAssignDistance = Math.max(stats.maxAssignDistance, Math.abs(band.x - x));
        if (cell[band.code] !== undefined && cell[band.code] !== v) {
          stats.collisions++;
          if (stats.collisionSamples.length < 12) stats.collisionSamples.push(`${sheet} ${pricingZone} ${band.code}: ${cell[band.code]} vs ${v}`);
        }
        cell[band.code] = v;
        stats.valuesAssigned++;
      }
    }
  }
  return { sheets, aliases, columns, stats };
}

/** The OPaL book as build.py assembles it: the two DTA annexures, aliases expanded. */
export function assemble(read: OpalRead): Record<string, Record<string, number>> {
  const zones: Record<string, Record<string, number>> = {};
  for (const sheet of ["DTA-HDPE", "DTA-LLDPE"]) {
    for (const [z, cells] of Object.entries(read.sheets[sheet] ?? {})) Object.assign((zones[z] ??= {}), cells);
  }
  for (const cells of Object.values(zones))
    for (const [alias, primary] of Object.entries(read.aliases))
      if (cells[primary] !== undefined && cells[alias] === undefined) cells[alias] = cells[primary]!;
  return zones;
}

async function main() {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };
  const n = (v: number) => v.toLocaleString("en-IN");

  for (const [tag, path] of [["DTA", DTA], ["CSA", CSA]] as const) {
    const read = await readOpal(path);
    const s = read.stats;
    say("=".repeat(90));
    say(`INDEPENDENT OPaL READ — ${tag}`);
    say("=".repeat(90));
    say(`orphan rows joined             : ${s.orphanRowsJoined}`);
    say(`header rows                    : ${s.headerRows}`);
    say(`column headings seen           : ${s.columnsSeen}`);
    say(`  the ETL's pattern would miss : ${s.columnsEtlWouldMiss.length}${s.columnsEtlWouldMiss.length ? " — " + [...new Set(s.columnsEtlWouldMiss)].join(" | ") : ""}`);
    say(`alias names seen               : ${s.aliasesSeen} (${Object.keys(read.aliases).length} distinct)`);
    say(`  the ETL's pattern would miss : ${s.aliasesEtlWouldMiss.length}${s.aliasesEtlWouldMiss.length ? " — " + [...new Set(s.aliasesEtlWouldMiss)].join(" | ") : ""}`);
    say(`data rows read                 : ${s.dataRows}`);
    say(`wrapped-state continuation rows: ${s.continuationRows}`);
    say(`rows with no pricing zone      : ${s.rowsWithNoPricingZone}`);
    for (const x of s.noZoneSamples) say(`    ${x}`);
    say(`values seen                    : ${n(s.valuesSeen)}`);
    say(`  assigned                     : ${n(s.valuesAssigned)}`);
    say(`  UNASSIGNED                   : ${n(s.valuesUnassigned)}`);
    say(`  collisions                   : ${n(s.collisions)}`);
    say(`largest assign distance        : ${s.maxAssignDistance.toFixed(1)} pt`);
    for (const x of s.unassignedSamples) say(`    unassigned: ${x}`);
    for (const x of s.collisionSamples) say(`    collision:  ${x}`);
    if (s.ambiguousLabels.length) { say(`  near-ambiguous label words:`); for (const x of s.ambiguousLabels) say(`    ${x}`); }
    for (const [k, v] of Object.entries(read.sheets)) {
      const cells = Object.values(v).reduce((t, c) => t + Object.keys(c).length, 0);
      say(`  ${k.padEnd(12)} ${String(Object.keys(v).length).padStart(3)} pricing zones, ${n(cells)} cells`);
    }
    say(`  aliases: ${Object.entries(read.aliases).map(([a, p]) => `${a}->${p}`).join("  ")}`);
    say("");

    if (tag !== "DTA") continue;

    // ---- reconciliation --------------------------------------------------
    const mine = assemble(read);
    const theirs = JSON.parse(readFileSync(INDEX, "utf8")).producers.OPaL.zones as Record<string, Record<string, number>>;
    say("=".repeat(90));
    say("COMPARISON AGAINST THE ETL INDEX (ex-works)");
    say("=".repeat(90));
    const myZ = Object.keys(mine).sort(), thZ = Object.keys(theirs).sort();
    say(`pricing zones  mine ${myZ.length}   etl ${thZ.length}`);
    const onlyMine = myZ.filter((z) => !(z in theirs)), onlyEtl = thZ.filter((z) => !(z in mine));
    if (onlyMine.length) say(`  only in mine (${onlyMine.length}): ${onlyMine.join(" | ")}`);
    if (onlyEtl.length) say(`  only in etl  (${onlyEtl.length}): ${onlyEtl.join(" | ")}`);

    let same = 0, differ = 0, missEtl = 0, missMine = 0;
    const diffs: string[] = [], gaps = new Map<string, number>();
    for (const z of thZ.filter((z) => z in mine)) {
      const a = mine[z]!, b = theirs[z]!;
      for (const g of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const va = a[g], vb = b[g];
        if (va === undefined) { missMine++; if (diffs.length < 30) diffs.push(`ETL-ONLY ${z} ${g} = ${vb}`); continue; }
        if (vb === undefined) { missEtl++; gaps.set(g, (gaps.get(g) ?? 0) + 1); continue; }
        if (Math.abs(va - vb) < 0.005) same++;
        else { differ++; if (diffs.length < 30) diffs.push(`${z} ${g}: etl ${vb} vs mine ${va}`); }
      }
    }
    say(`\ncells identical                : ${n(same)}`);
    say(`cells differing                : ${n(differ)}`);
    say(`present in mine, absent in ETL : ${n(missEtl)}${gaps.size ? ` across ${gaps.size} grades` : ""}`);
    say(`present in ETL, absent in mine : ${n(missMine)}`);
    if (gaps.size) for (const [g, c] of [...gaps].sort((a, b) => b[1] - a[1])) say(`    ${g.padEnd(12)} missing at ${c} zones`);
    if (diffs.length) { say(`\n  differences:`); for (const d of diffs) say(`    ${d}`); }
  }

  writeFileSync(REPORT, out.join("\n"));
  console.log(`\n(written to ${REPORT})`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
