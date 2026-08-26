/**
 * The reading of a circular, as handed to the application.
 *
 * One contract, whoever produced it. Today a person runs the ETL and uploads
 * its output; when the extractors run inside the application, they emit this
 * same shape and nothing downstream changes. That is the whole reason to pin
 * it down now rather than accept whatever arrives.
 *
 * The canonical form is the normalised one — zone, then grade, then price:
 *
 *     { "producer": "IOCL", "basis": "delivered",
 *       "zones": { "Jammu": { "012DB54": 142770 } } }
 *
 * The ETL's own `price_index.json` nests that under `producers`, so a whole
 * index is accepted too and the named producer is taken out of it. What is
 * deliberately *not* accepted is a raw per-producer extractor dump: those are
 * shaped differently for every producer — RIL by annexure, HMEL by basic and
 * adjustments, HPL by polymer — and guessing between them is how a price ends
 * up in the wrong zone.
 */

import { BadRequestException } from "@nestjs/common";

export interface ParsedExtract {
  basis?: string;
  effectiveDate?: string;
  /** zone -> grade -> basic price */
  zones: Record<string, Record<string, number>>;
  rowCount: number;
}

export function parseExtract(raw: unknown, producer: string): ParsedExtract {
  if (!raw || typeof raw !== "object") {
    throw new BadRequestException("That extract is not a JSON object.");
  }
  const doc = raw as Record<string, any>;

  // A whole price index: take this circular's producer out of it, matching
  // case-insensitively because the ETL keys are lowercase and ours are not.
  let node: Record<string, any> = doc;
  if (doc.producers && typeof doc.producers === "object") {
    const key = Object.keys(doc.producers).find(
      (k) => k.toLowerCase() === producer.toLowerCase(),
    );
    if (!key) {
      throw new BadRequestException(
        `That extract holds ${Object.keys(doc.producers).join(", ")}, but this circular is ${producer}.`,
      );
    }
    node = doc.producers[key];
  }

  // A producer named in the file must agree with the circular it is attached
  // to. Filing RIL's numbers against an IOCL circular is exactly the mix-up
  // attaching the extract to the record is meant to prevent.
  const named = typeof node.producer === "string" ? node.producer : doc.producer;
  if (typeof named === "string" && named.toLowerCase() !== producer.toLowerCase()) {
    throw new BadRequestException(
      `That extract says it is ${named}, but this circular is ${producer}.`,
    );
  }

  const zonesRaw = node.zones ?? doc.zones;
  if (!zonesRaw || typeof zonesRaw !== "object") {
    throw new BadRequestException(
      "That extract has no `zones`. Expected zone, then grade, then price.",
    );
  }

  const zones: Record<string, Record<string, number>> = {};
  let rowCount = 0;
  for (const [zone, grades] of Object.entries(zonesRaw as Record<string, unknown>)) {
    if (!grades || typeof grades !== "object") {
      throw new BadRequestException(`Zone "${zone}" does not hold a set of grades.`);
    }
    const cells: Record<string, number> = {};
    for (const [grade, price] of Object.entries(grades as Record<string, unknown>)) {
      // A price that is not a finite number is a failed read, not a zero. It
      // has to stop the upload rather than quietly become one.
      if (typeof price !== "number" || !Number.isFinite(price)) {
        throw new BadRequestException(
          `${zone} / ${grade} is "${String(price)}", which is not a price.`,
        );
      }
      if (price < 0) {
        throw new BadRequestException(`${zone} / ${grade} is negative.`);
      }
      cells[grade] = price;
      rowCount++;
    }
    zones[zone] = cells;
  }

  if (!rowCount) {
    throw new BadRequestException(
      "That extract has no prices in it. An empty reading would look like every price being withdrawn.",
    );
  }

  return {
    basis: typeof node.basis === "string" ? node.basis : undefined,
    effectiveDate:
      typeof doc.effective_date === "string"
        ? doc.effective_date
        : typeof doc.effectiveDate === "string"
          ? doc.effectiveDate
          : undefined,
    zones,
    rowCount,
  };
}
