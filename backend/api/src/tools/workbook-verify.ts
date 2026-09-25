/**
 * Validates the engine against the client-approved Competitor Presence and
 * Fallback Mapping workbook (2026-09-25), which is the business reference for
 * per-location behavior. The workbook FILE is the oracle: it is read as-is,
 * and every one of the 313 locations x 5 competitors the engine produces is
 * compared with what the workbook shows —
 *
 *   directly available        -> Exact Published Match, the competitor's own zone
 *   missing, approved mapping -> that mapped location, that distance, that classification
 *   missing, no mapping       -> no price (unresolved)
 *
 * plus GAIL at every location, and the Summary sheet's totals.
 *
 * Offline against a staged data/normalized directory (no database):
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/workbook-verify.ts [dataDir] [workbook.xlsx]
 *
 * `validateAgainstWorkbook` is exported so the same check runs against a
 * database-built dataset (workbook.integration.spec.ts: fresh seed, and M1
 * applied on post-M0 data).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

import { compare, useSpellings, type Dataset } from "../core/pricing";
import type { Producer } from "../core/types";

export const COMPETITORS: Producer[] = ["IOCL", "RIL", "HMEL", "HPL", "OPaL"];
/** Repo-relative, so a clean clone of the release commit finds the approved workbook. */
export const WORKBOOK_DEFAULT = join(__dirname, "..", "..", "..", "..", "docs", "client-review", "Competitor_Presence_and_Fallback_Mapping.xlsx");
const DATA_DEFAULT = join(__dirname, "..", "..", "..", "data", "normalized");

export type Classification =
  | "Exact Published Match"
  | "Territory Match"
  | "Inferred Location Match"
  | "Retained Existing Mapping"
  | "No Approved Mapping";

export interface ExpectedCell {
  classification: Classification;
  zone: string | null;
  km: number | null;
}

export interface ApprovedWorkbook {
  locations: string[];
  /** key `${competitor}|${location}` */
  cells: Map<string, ExpectedCell>;
  gailEverywhere: boolean;
  summary: Record<string, number>;
}

const text = (v: ExcelJS.CellValue): string => (v === null || v === undefined ? "" : String(v).trim());

export async function readApprovedWorkbook(path: string): Promise<ApprovedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  const presence = wb.getWorksheet("Competitor Presence");
  const fallback = wb.getWorksheet("Fallback Mapping");
  const summarySheet = wb.getWorksheet("Summary");
  if (!presence || !fallback || !summarySheet) throw new Error(`${path}: expected sheets Competitor Presence, Fallback Mapping, Summary`);

  const cells = new Map<string, ExpectedCell>();
  const locations: string[] = [];
  let gailEverywhere = true;
  presence.eachRow((row, n) => {
    if (n < 5) return; // title, subtitle, blank, header
    const location = text(row.getCell(1).value);
    if (!location) return;
    locations.push(location);
    const available = text(row.getCell(2).value).split(",").map((s) => s.trim()).filter(Boolean);
    if (!available.includes("GAIL")) gailEverywhere = false;
    for (const c of available) {
      if (c === "GAIL") continue;
      cells.set(`${c}|${location}`, { classification: "Exact Published Match", zone: null, km: null });
    }
  });

  fallback.eachRow((row, n) => {
    if (n < 5) return;
    const location = text(row.getCell(1).value);
    const competitor = text(row.getCell(2).value);
    if (!location || !competitor) return;
    const classification = text(row.getCell(5).value) as Classification;
    const zoneCell = text(row.getCell(3).value);
    const kmCell = row.getCell(4).value;
    const key = `${competitor}|${location}`;
    if (cells.has(key)) throw new Error(`${path}: ${key} is both available (Sheet 1) and missing (Sheet 2)`);
    cells.set(key, {
      classification,
      zone: classification === "No Approved Mapping" ? null : zoneCell,
      km: typeof kmCell === "number" ? kmCell : null,
    });
  });

  const summary: Record<string, number> = {};
  summarySheet.eachRow((row) => {
    const label = text(row.getCell(1).value);
    const value = row.getCell(2).value;
    if (label && typeof value === "number") summary[label] = value;
  });

  return { locations, cells, gailEverywhere, summary };
}

export interface ValidationResult {
  checked: number;
  mismatches: string[];
  counts: Record<Classification, number>;
}

type MatchQuote = {
  producer: string;
  zone: string | null;
  locationMatch?: { group: string; label: string; distanceKm?: number };
};

/** The workbook classification the engine's quote corresponds to. */
export function engineClassification(q: { zone: string | null; locationMatch?: { group: string; label: string } }): Classification {
  if (!q.zone || !q.locationMatch) return "No Approved Mapping";
  if (q.locationMatch.group === "exact") return "Exact Published Match";
  return q.locationMatch.label as Classification;
}

export function validateAgainstWorkbook(data: Dataset, wb: ApprovedWorkbook): ValidationResult {
  const mismatches: string[] = [];
  const counts: Record<Classification, number> = {
    "Exact Published Match": 0,
    "Territory Match": 0,
    "Inferred Location Match": 0,
    "Retained Existing Mapping": 0,
    "No Approved Mapping": 0,
  };
  let checked = 0;
  const miss = (line: string) => mismatches.push(line);

  if (wb.locations.length !== 313) miss(`workbook lists ${wb.locations.length} locations, expected 313`);
  if (!wb.gailEverywhere) miss("workbook does not show GAIL available at every location");

  for (const location of wb.locations) {
    // Zone resolution does not depend on the grade; one comparison per location, ex works
    // (the workbook describes the Ex-Works fallback only).
    const c = compare(data, "B52A003", location, 1, "cash", undefined, undefined, "ex_works");
    checked += COMPETITORS.length;
    mismatches.push(...checkLocation(location, c.quotes, wb, counts));
  }

  const summaryChecks: Array<[string, number]> = [
    ["Total application locations", wb.locations.length],
    ["Total direct / published presences", counts["Exact Published Match"]],
    ["Total fallback mappings (Territory + Inferred + Retained)",
      counts["Territory Match"] + counts["Inferred Location Match"] + counts["Retained Existing Mapping"]],
    ...(Object.keys(counts) as Classification[]).map((k) => [k, counts[k]] as [string, number]),
  ];
  for (const [label, engineValue] of summaryChecks) {
    const workbookValue = wb.summary[label];
    if (workbookValue === undefined) miss(`Summary: "${label}" not found in the workbook`);
    else if (workbookValue !== engineValue) miss(`Summary: "${label}" workbook ${workbookValue}, engine ${engineValue}`);
  }

  return { checked, mismatches, counts };
}

/**
 * One location's six quotes (from the engine, or from a live API response) against the
 * workbook: GAIL exact, and each competitor's classification, mapped zone and distance.
 * Adds each competitor's classification to `counts` when given.
 */
export function checkLocation(
  location: string,
  quotes: MatchQuote[],
  wb: ApprovedWorkbook,
  counts?: Record<Classification, number>,
): string[] {
  const out: string[] = [];
  const gail = quotes.find((q) => q.producer === "GAIL");
  if (!gail?.zone || gail.locationMatch?.group !== "exact") out.push(`GAIL ${location}: not an exact match`);
  for (const competitor of COMPETITORS) {
    const key = `${competitor}|${location}`;
    const expected = wb.cells.get(key);
    const q = quotes.find((x) => x.producer === competitor);
    if (!expected) { out.push(`${key}: not in the workbook at all`); continue; }
    if (!q) { out.push(`${key}: no quote returned`); continue; }
    const got = engineClassification(q);
    if (counts) counts[got]++;
    if (got !== expected.classification) {
      out.push(`${key}: workbook says ${expected.classification}, got ${got} (${q.zone ?? "no zone"})`);
      continue;
    }
    if (expected.classification === "Exact Published Match" || expected.classification === "No Approved Mapping") continue;
    if (q.zone !== expected.zone) out.push(`${key}: workbook maps to ${expected.zone}, got ${q.zone}`);
    const km = q.locationMatch?.distanceKm ?? null;
    if (km !== expected.km) out.push(`${key}: workbook distance ${expected.km ?? "none"} km, got ${km ?? "none"} km`);
  }
  return out;
}

export function loadStagedDataset(dir: string): Dataset {
  const load = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  const priceIndex = load("price_index");
  const freight = load("freight");
  const discounts = load("discounts");
  const crossref = load("crossref");
  useSpellings(load("locations").spellings ?? {});
  return {
    priceIndex,
    freight: { effective_date: freight.effective_date, books: freight.books, destination_map: freight.destination_map },
    discounts: { producers: discounts.producers },
    crossref: { index: crossref.index },
  } as Dataset;
}

export function printResult(result: ValidationResult): void {
  console.log(`  ${result.checked.toLocaleString("en-IN")} competitor-location cells checked`);
  for (const [k, v] of Object.entries(result.counts)) console.log(`    ${k.padEnd(27)} ${v}`);
  if (result.mismatches.length) {
    console.log(`\n  ${result.mismatches.length} MISMATCH(ES):`);
    for (const m of result.mismatches.slice(0, 40)) console.log(`    ${m}`);
    if (result.mismatches.length > 40) console.log(`    ... and ${result.mismatches.length - 40} more`);
  }
}

async function main() {
  const dir = process.argv[2] ?? DATA_DEFAULT;
  const path = process.argv[3] ?? WORKBOOK_DEFAULT;
  console.log(`workbook: ${path}\ndata:     ${dir}\n`);
  const wb = await readApprovedWorkbook(path);
  const result = validateAgainstWorkbook(loadStagedDataset(dir), wb);
  printResult(result);
  console.log(result.mismatches.length ? "\nFAIL" : "\nMATCHES THE APPROVED WORKBOOK");
  process.exit(result.mismatches.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
