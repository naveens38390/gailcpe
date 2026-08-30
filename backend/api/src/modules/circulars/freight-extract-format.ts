/**
 * The reading of a freight circular, as handed to the application.
 *
 * The price-side sibling of this file (extract-format.ts) explains the
 * reasoning at length: one contract regardless of who produced the reading, so
 * that moving extraction inside the application later changes nothing
 * downstream. The same applies here, with one shape instead of two.
 *
 * The canonical form is a flat destination book:
 *
 *     { "producer": "HMEL", "effective_date": "2026-06-01",
 *       "destinations": [ { "destination": "Anantapur", "rate_per_mt": 5410 } ] }
 *
 * The ETL's own `freight.json` nests exactly that under `books`, keyed by
 * producer, so a whole freight index is accepted too and the named producer is
 * taken out of it. A bare `{ "Anantapur": 5410 }` object is accepted as well,
 * because that is the shortest honest way to hand over a small correction.
 *
 * What is not accepted is a raw producer spreadsheet dump. HMEL bills by
 * district, HPL by cluster and sector, OPaL by zone code with a separate
 * insurance line; guessing between those layouts is how a rate lands against
 * the wrong town.
 */

import { BadRequestException } from "@nestjs/common";

export interface ParsedFreightRow {
  destination: string;
  ratePerMt: number;
  insurancePerMt: number;
  state?: string;
  district?: string;
  cluster?: string;
  distanceKm?: number;
  transitDays?: number;
}

export interface ParsedFreightExtract {
  effectiveDate?: string;
  rows: ParsedFreightRow[];
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** One row of a producer's freight book, however the reading spelled it. */
function toRow(raw: unknown, at: string): ParsedFreightRow {
  if (!raw || typeof raw !== "object") {
    throw new BadRequestException(`${at} is not a freight row.`);
  }
  const r = raw as Record<string, unknown>;

  const destination = str(r.destination) ?? str(r.location) ?? str(r.name);
  if (!destination) {
    throw new BadRequestException(`${at} has no destination.`);
  }

  const rate = num(r.rate_per_mt) ?? num(r.ratePerMt) ?? num(r.rate);
  // A rate that is not a finite number is a failed read, not a zero — a zero
  // here would publish as "this town is free to ship to".
  if (rate === undefined) {
    throw new BadRequestException(
      `${destination} has rate "${String(r.rate_per_mt ?? r.ratePerMt ?? r.rate)}", which is not a freight rate.`,
    );
  }
  if (rate < 0) throw new BadRequestException(`${destination} has a negative rate.`);

  const insurance =
    num(r.insurance_per_mt) ?? num(r.insurancePerMt) ?? 0;
  if (insurance < 0) {
    throw new BadRequestException(`${destination} has a negative insurance rate.`);
  }

  return {
    destination,
    ratePerMt: rate,
    insurancePerMt: insurance,
    state: str(r.state),
    district: str(r.district),
    cluster: str(r.cluster),
    distanceKm: num(r.distance_km) ?? num(r.distanceKm),
    transitDays: num(r.transit_days) ?? num(r.transitDays),
  };
}

export function parseFreightExtract(
  raw: unknown,
  producer: string,
): ParsedFreightExtract {
  if (!raw || typeof raw !== "object") {
    throw new BadRequestException("That extract is not a JSON object.");
  }
  const doc = raw as Record<string, any>;

  // A whole freight index: take this circular's producer out of it, matching
  // case-insensitively because the ETL keys and ours differ in case (OPaL).
  let node: unknown = doc;
  if (doc.books && typeof doc.books === "object") {
    const key = Object.keys(doc.books).find(
      (k) => k.toLowerCase() === producer.toLowerCase(),
    );
    if (!key) {
      throw new BadRequestException(
        `That extract holds ${Object.keys(doc.books).join(", ")}, but this circular is ${producer}.`,
      );
    }
    node = doc.books[key];
  }

  // A producer named in the file must agree with the circular it is attached
  // to — the same mix-up guard the price extract carries.
  const named = str(doc.producer);
  if (named && named.toLowerCase() !== producer.toLowerCase()) {
    throw new BadRequestException(
      `That extract says it is ${named}, but this circular is ${producer}.`,
    );
  }

  let list: unknown[];
  if (Array.isArray(node)) {
    list = node;
  } else if (Array.isArray((node as any)?.destinations)) {
    list = (node as any).destinations;
  } else if (Array.isArray(doc.destinations)) {
    list = doc.destinations;
  } else {
    // The shorthand: { "Anantapur": 5410 }, either at the top level or under
    // `destinations`. Only accepted when every value is a number, so a nested
    // object shaped like something else fails loudly instead of half-parsing.
    const flat = (node as any)?.destinations ?? doc.destinations ?? node;
    if (!flat || typeof flat !== "object") {
      throw new BadRequestException(
        "That extract has no `destinations`. Expected a destination and a rate per MT.",
      );
    }
    const cells = Object.entries(flat as Record<string, unknown>);
    if (!cells.length || !cells.every(([, v]) => typeof v === "number")) {
      throw new BadRequestException(
        "That extract has no `destinations`. Expected a destination and a rate per MT.",
      );
    }
    list = cells.map(([destination, rate]) => ({ destination, rate_per_mt: rate }));
  }

  const rows = list.map((row, i) => toRow(row, `Row ${i + 1}`));

  if (!rows.length) {
    throw new BadRequestException(
      "That extract has no rates in it. An empty reading would look like every destination being withdrawn.",
    );
  }

  /**
   * Repeated destinations are deliberately *not* rejected here.
   *
   * They look like a read error and are not: HMEL's own book prints Hamirpur
   * twice, at 1,310 and 3,020, for two different districts that share a name,
   * and OPaL prints Dadra twice. Refusing them would reject the producers'
   * genuine circulars — and the ETL's own freight.json along with them.
   *
   * A freight book is keyed on destination alone, here and in the live
   * FreightEntry collection, so only one of each pair can survive. Which one,
   * and the fact that a choice was made at all, is settled in one place for
   * both readings and clones — see FreightCircularsService.build — rather than
   * half here and half there.
   */
  return {
    effectiveDate: str(doc.effective_date) ?? str(doc.effectiveDate),
    rows,
  };
}
