/**
 * Read destination/rate rows directly out of a freight circular PDF.
 *
 * The producer-specific column layouts here are not guessed: they are ported
 * from `backend/etl/extractors/freight.py`, which was built and validated
 * against real circulars —
 *
 *     HMEL  serial | state | district | destination | rate
 *     HPL   serial | cluster | state | sector | district | destination | km | days | rate
 *     OPaL  serial | cluster | state | zone code | destination | rate | insurance
 *
 * Each is read by word x-position rather than by splitting text, because
 * destination names contain spaces and OPaL fuses its zone code onto the
 * destination. See pdf-table-reader.ts for why plain text extraction is
 * unsafe here.
 *
 * The output feeds straight into the same `ParsedFreightExtract` shape the
 * JSON-reading path produces (freight-extract-format.ts), so everything
 * downstream of parsing — diff, ambiguous-destination handling, draft
 * building, review, publish — is untouched.
 *
 * No sample PDFs from these producers were available to validate this
 * against when it was written; the layouts are trusted because the Python
 * extractors were built and proven against real documents, not because this
 * port has been. See the confidence gate below — a reading this unsure of
 * itself is reported, not published.
 */

import { BadRequestException } from "@nestjs/common";
import type { ParsedFreightRow } from "./freight-extract-format";
import { joinNumericFragments, readRows, type PdfRow, type Word } from "./pdf-table-reader";
import { detectReferenceInText } from "./reference-detector.service";

export type FreightPdfProducer = "HMEL" | "HPL" | "OPaL";

/** Full names as they appear on a producer's own letterhead, per the seeded producer master. */
const PRODUCER_NAMES: Record<FreightPdfProducer, string[]> = {
  HMEL: ["HPCL-Mittal Energy Limited", "HPCL Mittal Energy Limited", "HMEL"],
  HPL: ["Haldia Petrochemicals Limited", "HPL"],
  OPaL: ["ONGC Petro additions Limited", "ONGC Petro-additions Limited", "OPaL", "OPAL"],
};

export interface FreightPdfExtractResult {
  producer: FreightPdfProducer | null;
  rows: ParsedFreightRow[];
  effectiveDate: string | null;
  circularNumber: string | null;
  /** Total candidate rows (a bare serial number in the first column) seen on the page. */
  candidateRowCount: number;
  /** Of those, how many yielded a destination and a valid rate. */
  parsedRowCount: number;
  confidence: "high" | "low";
  /** Why confidence is low, or empty when it is high. Always shown to the reviewer. */
  warnings: string[];
}

const SERIAL = /^\d+$/;
/** OPaL prints "1000001168Bongaigaon" — a ten-digit zone code fused onto the name. */
const OPAL_ZONE = /^(\d{10})(.*)$/;

/** A row is data when its first word is a bare serial number, per pdfrows.py. */
function numberedRows(rows: PdfRow[]): Word[][] {
  return rows
    .filter((r) => r.words.length && SERIAL.test(r.words[0]!.text))
    .map((r) => joinNumericFragments(r.words));
}

/** The recurring left edges that define this circular's columns. */
function columnEdges(rowWords: Word[][], keep: number): number[] {
  const counts = new Map<number, number>();
  for (const words of rowWords) {
    for (const w of words) {
      const key = Math.round(w.x0 * 10) / 10;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, keep)
    .map(([x]) => x)
    .sort((a, b) => a - b);
}

/** Bucket a row's words into the columns defined by `edges`. */
function cells(words: Word[], edges: number[]): string[] {
  const out: string[][] = edges.map(() => []);
  for (const w of words) {
    let slot = -1;
    for (let i = 0; i < edges.length; i++) {
      if (w.x0 >= edges[i]! - 1.5) slot = i;
    }
    if (slot >= 0) out[slot]!.push(w.text);
  }
  return out.map((c) => c.join(" ").trim());
}

/** Tolerates the space pdfplumber-equivalents leave in "3 ,756.00". */
function rate(text: string): number | null {
  const cleaned = text.replace(/\s+/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function extractHmel(rowWords: Word[][]): ParsedFreightRow[] {
  const edges = columnEdges(rowWords, 5);
  const out: ParsedFreightRow[] = [];
  for (const words of rowWords) {
    const c = cells(words, edges);
    const [state, district, destination, rateText] = c.slice(1, 5);
    const value = rate(rateText ?? "");
    if (value !== null && destination) {
      out.push({ destination, ratePerMt: value, insurancePerMt: 0, state, district });
    }
  }
  return out;
}

function extractHpl(rowWords: Word[][]): ParsedFreightRow[] {
  const edges = columnEdges(rowWords, 9);
  const out: ParsedFreightRow[] = [];
  for (const words of rowWords) {
    const c = cells(words, edges);
    if (c.length < 9) continue;
    const [cluster, state, , district, destination, km, days, rateText] = c.slice(1, 9);
    const value = rate(rateText ?? "");
    if (value === null || !destination) continue;
    out.push({
      destination,
      ratePerMt: value,
      insurancePerMt: 0,
      state,
      district,
      cluster,
      distanceKm: rate(km ?? "") ?? undefined,
      transitDays: rate(days ?? "") ?? undefined,
    });
  }
  return out;
}

function extractOpal(rowWords: Word[][]): ParsedFreightRow[] {
  const edges = columnEdges(rowWords, 6);
  const out: ParsedFreightRow[] = [];
  for (const words of rowWords) {
    const c = cells(words, edges);
    if (c.length < 6) continue;
    const [cluster, state, rawDestination, rateText, insuranceText] = c.slice(1, 6);
    let destination = rawDestination ?? "";
    const fused = OPAL_ZONE.exec(destination);
    if (fused) destination = fused[2]!.trim();
    const value = rate(rateText ?? "");
    if (value === null || !destination) continue;
    out.push({
      destination,
      ratePerMt: value,
      insurancePerMt: rate(insuranceText ?? "") ?? 0,
      state,
      cluster,
    });
  }
  return out;
}

const EXTRACTORS: Record<FreightPdfProducer, (rowWords: Word[][]) => ParsedFreightRow[]> = {
  HMEL: extractHmel,
  HPL: extractHpl,
  OPaL: extractOpal,
};

/** Column count a fully-formed row of this producer's table should have. */
const EXPECTED_COLUMNS: Record<FreightPdfProducer, number> = { HMEL: 5, HPL: 9, OPaL: 6 };

function detectProducer(headText: string): FreightPdfProducer | null {
  for (const [code, names] of Object.entries(PRODUCER_NAMES) as Array<
    [FreightPdfProducer, string[]]
  >) {
    if (names.some((n) => headText.toLowerCase().includes(n.toLowerCase()))) return code;
  }
  return null;
}

/** "w.e.f. 01.06.2026", "with effect from 1st June 2026", "effective date: 01-06-2026". */
const DATE_PATTERNS = [
  /w\.?\s*e\.?\s*f\.?\s*:?\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/i,
  /with\s+effect\s+from\s*:?\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/i,
  /effective\s+(?:date|from)\s*:?\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/i,
];

function detectEffectiveDate(headText: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const hit = pattern.exec(headText);
    if (!hit) continue;
    const [, d, m, y] = hit;
    const year = y!.length === 2 ? `20${y}` : y!;
    const day = d!.padStart(2, "0");
    const month = m!.padStart(2, "0");
    const iso = `${year}-${month}-${day}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  return null;
}

function detectCircularNumber(headText: string): string | null {
  return detectReferenceInText(headText).reference;
}

/**
 * Read a freight circular PDF into the same shape a JSON extract produces.
 *
 * `expectedProducer` is the producer the circular was filed against — a
 * detected producer that disagrees with it is refused outright, the same
 * mix-up guard the JSON path carries. When nothing is detected, the filed
 * producer is trusted and used to select the parser.
 */
export async function extractFreightPdf(
  buffer: Buffer,
  expectedProducer: string,
): Promise<FreightPdfExtractResult> {
  const rows = await readRows(buffer);
  if (!rows.length) {
    throw new BadRequestException(
      "Could not read any text from that PDF. It may be a scanned image with no text layer — attach a JSON reading instead.",
    );
  }

  const headText = rows
    .filter((r) => r.page <= 2)
    .map((r) => r.text)
    .join("\n");
  const detected = detectProducer(headText);
  const normalisedExpected = (Object.keys(PRODUCER_NAMES) as FreightPdfProducer[]).find(
    (p) => p.toLowerCase() === expectedProducer.toLowerCase(),
  );

  if (detected && normalisedExpected && detected !== normalisedExpected) {
    throw new BadRequestException(
      `This PDF's letterhead reads ${detected}, but the circular it is being attached to is filed as ${expectedProducer}.`,
    );
  }

  const producer = detected ?? normalisedExpected ?? null;
  if (!producer) {
    throw new BadRequestException(
      `No PDF parser is available for producer "${expectedProducer}" yet. HMEL, HPL and OPaL are supported — attach a JSON reading for anything else.`,
    );
  }

  const rowWords = numberedRows(rows);
  const parsed = EXTRACTORS[producer](rowWords);

  const warnings: string[] = [];
  const candidateRowCount = rowWords.length;
  const parsedRowCount = parsed.length;
  const successRate = candidateRowCount ? parsedRowCount / candidateRowCount : 0;

  if (parsedRowCount < 10) {
    warnings.push(
      `Only ${parsedRowCount} row(s) parsed. That is too few to be a real ${producer} freight book — the column layout may not match, or this may be the wrong document.`,
    );
  } else if (successRate < 0.5) {
    warnings.push(
      `Only ${Math.round(successRate * 100)}% of the ${candidateRowCount} numbered rows on the page yielded a destination and a rate. The rest were dropped rather than guessed at — this circular's layout may not match the ${producer} format this parser expects.`,
    );
  }
  const expectedColumns = EXPECTED_COLUMNS[producer];
  if (candidateRowCount > 0 && parsedRowCount === 0) {
    warnings.push(
      `None of the ${candidateRowCount} numbered rows produced a valid destination and rate. Expected ${expectedColumns} columns for ${producer}; the detected column positions may not match this document.`,
    );
  }

  return {
    producer,
    rows: parsed,
    effectiveDate: detectEffectiveDate(headText),
    circularNumber: detectCircularNumber(headText),
    candidateRowCount,
    parsedRowCount,
    confidence: warnings.length ? "low" : "high",
    warnings,
  };
}
