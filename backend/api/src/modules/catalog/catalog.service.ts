/**
 * The pickers.
 *
 * Every selectable value in the app is served from here, derived from the
 * published circular round rather than typed by hand — so a grade that appears
 * in a dropdown is a grade that exists in a circular, and a location is one
 * GAIL actually prices.
 *
 * Each option also carries what is *available* for it, which is what lets the
 * screens narrow the next choice instead of letting someone pick a combination
 * that has no answer. Nothing is hidden: a grade GAIL does not price still
 * appears, labelled, because an officer asked about it needs to see that
 * rather than wonder why it is missing.
 */

import { Injectable } from "@nestjs/common";

import { normaliseGrade } from "../../core/pricing";
import type { Dataset } from "../../core/pricing";
import type { Producer } from "../../core/types";
import { DatasetService } from "../dataset/dataset.service";

/** How much of an answer a grade can produce, given what the circulars hold. */
export type GradeAvailability =
  /** GAIL prices it and at least one competitor is mapped — a full ladder. */
  | "comparable"
  /** GAIL prices it, but the cross-reference maps no competitor grade. */
  | "gail_only"
  /** Cross-referenced, but absent from GAIL's own price book. */
  | "no_gail_price";

export interface CatalogGrade {
  gailGrade: string;
  polymer: string;
  section: string;
  application: string;
  characteristic: string;
  mfi?: string;
  density?: string;
  confidence?: string;
  status?: string;
  availability: GradeAvailability;
  /** Producers with a mapped equivalent grade, GAIL included when priced. */
  competitors: string[];
  /** How many of GAIL's 313 ex-works locations carry a price for this grade. */
  locationCount: number;
}

export interface CatalogLocation {
  name: string;
  sapCode?: string;
  /** Producers publishing a price this location resolves to. */
  producers: string[];
}

export interface CatalogProducer {
  code: string;
  name: string;
  basis: string;
  isSelf: boolean;
}

/** GAIL's sheet suffixes its grades (B52A003A); the cross-reference does not. */
function gailKeyFor(priced: Record<string, number>, grade: string): string | null {
  const target = normaliseGrade(grade);
  for (const key of Object.keys(priced)) {
    const k = normaliseGrade(key);
    if (k === target || k === `${target}A` || k.replace(/A$/, "") === target) return key;
  }
  return null;
}

function pricedCodeFor(
  data: Dataset,
  producer: Producer,
  zone: string,
  gailGrade: string,
): string | null {
  const cells = data.priceIndex.producers[producer]?.zones?.[zone];
  if (!cells) return null;
  if (producer === "GAIL") return gailKeyFor(cells, gailGrade);
  const candidates = data.crossref.index[gailGrade]?.equivalents?.[producer] ?? [];
  for (const candidate of candidates) {
    const target = normaliseGrade(candidate);
    const hit = Object.keys(cells).find((k) => normaliseGrade(k) === target);
    if (hit) return hit;
  }
  return null;
}

/** Which zone of this producer's book a customer location resolves to. */
function zoneFor(data: Dataset, producer: Producer, location: string): string | null {
  const mapped = data.priceIndex.location_map?.[producer]?.[location];
  if (mapped) return mapped;
  return data.priceIndex.producers[producer]?.zones?.[location] ? location : null;
}

@Injectable()
export class CatalogService {
  constructor(private dataset: DatasetService) {}

  async catalog(): Promise<{
    effectiveDate: string;
    producers: CatalogProducer[];
    grades: CatalogGrade[];
    locations: CatalogLocation[];
  }> {
    const data = await this.dataset.load();
    return {
      effectiveDate: data.priceIndex.effective_date,
      producers: this.producers(data),
      grades: this.grades(data),
      locations: this.locations(data),
    };
  }

  private producers(data: Dataset): CatalogProducer[] {
    const names: Record<string, string> = {
      GAIL: "GAIL (India) Limited",
      RIL: "Reliance Industries Limited",
      IOCL: "Indian Oil Corporation Limited",
      HMEL: "HPCL-Mittal Energy Limited",
      OPaL: "ONGC Petro additions Limited",
      HPL: "Haldia Petrochemicals Limited",
    };
    return Object.entries(data.priceIndex.producers).map(([code, book]) => ({
      code,
      name: names[code] ?? code,
      basis: book.basis,
      isSelf: code === "GAIL",
    }));
  }

  /**
   * Every grade the documents describe — the cross-referenced ones and the
   * ones GAIL prices without a mapping — each labelled with what it can answer.
   */
  private grades(data: Dataset): CatalogGrade[] {
    const gailZones = data.priceIndex.producers.GAIL?.zones ?? {};
    const gailLocations = Object.keys(gailZones);
    const out: CatalogGrade[] = [];
    const seen = new Set<string>();

    for (const [code, entry] of Object.entries(data.crossref.index)) {
      seen.add(normaliseGrade(code));
      const competitors = Object.entries(entry.equivalents ?? {})
        .filter(([producer, codes]) => codes.length > 0 && producer in data.priceIndex.producers)
        .map(([producer]) => producer);
      let locationCount = 0;
      for (const zone of gailLocations) {
        if (gailKeyFor(gailZones[zone]!, code)) locationCount++;
      }
      const availability: GradeAvailability =
        locationCount === 0 ? "no_gail_price" : competitors.length ? "comparable" : "gail_only";
      out.push({
        gailGrade: code,
        polymer: entry.polymer,
        section: entry.section,
        application: entry.application,
        characteristic: entry.characteristic,
        mfi: (entry as { mfi?: string }).mfi,
        density: (entry as { density?: string }).density,
        confidence: entry.confidence,
        status: entry.status,
        availability,
        competitors,
        locationCount,
      });
    }

    // Codes GAIL prices that the cross-reference does not carry. They can be
    // quoted but not compared, and hiding them would misrepresent the book.
    const pricedCodes = new Set<string>();
    for (const cells of Object.values(gailZones)) {
      for (const code of Object.keys(cells)) pricedCodes.add(code);
    }
    for (const code of pricedCodes) {
      const folded = normaliseGrade(code);
      const base = folded.replace(/A$/, "");
      if (seen.has(folded) || seen.has(base)) continue;
      seen.add(folded);
      let locationCount = 0;
      for (const zone of gailLocations) if (gailZones[zone]![code] !== undefined) locationCount++;
      out.push({
        gailGrade: code,
        polymer: code.startsWith("F") || code.startsWith("R") ? "LLDPE" : "HDPE",
        section: "UNMAPPED",
        application: "Not in the cross-reference",
        characteristic: "Priced by GAIL; no competitor equivalence published",
        availability: "gail_only",
        competitors: [],
        locationCount,
      });
    }

    return out.sort((a, b) => a.gailGrade.localeCompare(b.gailGrade));
  }

  private locations(data: Dataset): CatalogLocation[] {
    const gailZones = data.priceIndex.producers.GAIL?.zones ?? {};
    return Object.keys(gailZones)
      .sort()
      .map((name) => ({
        name,
        producers: (Object.keys(data.priceIndex.producers) as Producer[]).filter(
          (producer) => zoneFor(data, producer, name) !== null,
        ),
      }));
  }

  /**
   * The dependent step: given a grade, which locations can answer for it and
   * which producers are in play there. Drives Location and Competitor once a
   * grade is chosen, so no one can select a combination with no price behind it.
   */
  async availability(gailGrade: string): Promise<{
    grade: string;
    known: boolean;
    locations: Array<{ name: string; producers: string[]; gailPriced: boolean }>;
    producers: string[];
  }> {
    const data = await this.dataset.load();
    const target = normaliseGrade(gailGrade);
    const canonical =
      Object.keys(data.crossref.index).find((k) => normaliseGrade(k) === target) ?? gailGrade;

    const gailZones = data.priceIndex.producers.GAIL?.zones ?? {};
    const allProducers = Object.keys(data.priceIndex.producers) as Producer[];
    const locations: Array<{ name: string; producers: Producer[]; gailPriced: boolean }> = [];
    const producerSet = new Set<string>();

    for (const name of Object.keys(gailZones).sort()) {
      const here: Producer[] = [];
      for (const producer of allProducers) {
        const zone = zoneFor(data, producer, name);
        if (!zone) continue;
        if (pricedCodeFor(data, producer, zone, canonical)) here.push(producer);
      }
      if (!here.length) continue;
      here.forEach((p) => producerSet.add(p));
      locations.push({ name, producers: here, gailPriced: here.includes("GAIL") });
    }

    return {
      grade: canonical,
      known: canonical in data.crossref.index || locations.length > 0,
      locations,
      producers: allProducers.filter((p) => producerSet.has(p)),
    };
  }
}
