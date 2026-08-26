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

import { crossRefFor, normaliseGrade } from "../../core/pricing";
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
  process?: string;
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

/**
 * The cross-reference marks an additive package inside the characteristic —
 * "General purpose, <5L (NA additive)". That is a real difference in the
 * product and must stay visible, but it does not change what the customer
 * asked for, so it is stripped when deciding which grades answer one
 * requirement. Only an additive parenthetical is removed; every other
 * parenthetical is left alone rather than risk merging unrelated grades.
 */
function requirementKey(characteristic: string): string {
  return characteristic.replace(/\s*\([^)]*additive[^)]*\)\s*$/i, "").trim();
}

/** One grade a customer could be quoted for a given product need. */
export interface GradeVariant {
  gailGrade: string;
  polymer: string;
  /** Full text, additive marker included — what makes this one different. */
  characteristic: string;
  process?: string;
  mfi?: string;
  density?: string;
  confidence?: string;
  status?: string;
  availability: GradeAvailability;
  competitors: string[];
  /** GAIL's basic price at the requested location; null if not priced there. */
  gailPrice: number | null;
  /** The code GAIL's own book uses — B52A003 is published as B52A003A. */
  pricedAs: string | null;
}

export interface ProductVariants {
  /** What the customer is buying, which is what the grades are variants of. */
  product: { section: string; application: string; characteristic: string };
  location: string | null;
  selected: string;
  variants: GradeVariant[];
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
  const candidates = crossRefFor(data, gailGrade)?.equivalents?.[producer] ?? [];
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
        process: entry.process,
        mfi: entry.mfi,
        density: entry.density,
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

      // An additive variant the sheet never wrote a row for still substitutes
      // for the same competitor grades its base does — where the sheet wrote
      // both rows it published identical equivalents — so it inherits them and
      // is comparable, rather than being stranded as GAIL-only.
      const inherited = crossRefFor(data, code);
      if (inherited) {
        const competitors = Object.entries(inherited.equivalents ?? {})
          .filter(([producer, codes]) => codes.length > 0 && producer in data.priceIndex.producers)
          .map(([producer]) => producer);
        out.push({
          gailGrade: code,
          polymer: inherited.polymer,
          section: inherited.section,
          application: inherited.application,
          // Same wording the sheet uses on the one variant it did write.
          characteristic: `${inherited.characteristic} (NA additive)`,
          process: inherited.process,
          mfi: inherited.mfi,
          density: inherited.density,
          confidence: inherited.confidence,
          status: inherited.status,
          availability:
            locationCount === 0 ? "no_gail_price" : competitors.length ? "comparable" : "gail_only",
          competitors,
          locationCount,
        });
        continue;
      }

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

  /**
   * Every grade that answers the same need as this one.
   *
   * A customer asks for a material, not a code — "blow moulding, general
   * purpose, under five litres" is served by three GAIL grades that differ by
   * ~Rs 2,500/MT. Selecting one of them should not hide the other two, because
   * choosing between them is the officer's actual decision.
   *
   * Grades are grouped off the cross-reference's own section / application /
   * characteristic, which is the sheet's existing statement of "these serve
   * the same purpose". Nothing new is asserted here.
   */
  async variants(gailGrade: string, location?: string): Promise<ProductVariants> {
    const data = await this.dataset.load();
    const target = normaliseGrade(gailGrade);

    // Derived from the same method that builds the picker, so a variant can
    // never disagree with the grade row the officer selected it from.
    const all = this.grades(data);
    const selected = all.find((g) => normaliseGrade(g.gailGrade) === target);

    const product = {
      section: selected?.section ?? "UNMAPPED",
      application: selected?.application ?? "Not in the cross-reference",
      characteristic: requirementKey(selected?.characteristic ?? ""),
    };

    // An unmapped code has no published purpose, so it has no siblings — no
    // grouping every unmapped grade into one meaningless "product".
    const group =
      selected && selected.section !== "UNMAPPED"
        ? all.filter(
            (g) =>
              g.section === product.section &&
              g.application === product.application &&
              requirementKey(g.characteristic) === requirementKey(product.characteristic),
          )
        : selected
          ? [selected]
          : [];

    const gailZones = data.priceIndex.producers.GAIL?.zones ?? {};
    const cells = location ? gailZones[location] : undefined;

    const variants: GradeVariant[] = group.map((g) => {
      const pricedAs = cells ? gailKeyFor(cells, g.gailGrade) : null;
      return {
        gailGrade: g.gailGrade,
        polymer: g.polymer,
        characteristic: g.characteristic,
        process: g.process,
        mfi: g.mfi,
        density: g.density,
        confidence: g.confidence,
        status: g.status,
        availability: g.availability,
        competitors: g.competitors,
        gailPrice: pricedAs && cells ? (cells[pricedAs] ?? null) : null,
        pricedAs,
      };
    });

    // Cheapest first once a location is known — that is the order the choice
    // is actually made in. Without a location there is no price to rank by.
    variants.sort((a, b) => {
      if (a.gailPrice !== null && b.gailPrice !== null) return a.gailPrice - b.gailPrice;
      if (a.gailPrice !== null) return -1;
      if (b.gailPrice !== null) return 1;
      return a.gailGrade.localeCompare(b.gailGrade);
    });

    return {
      product,
      location: location ?? null,
      selected: selected?.gailGrade ?? gailGrade,
      variants,
    };
  }
}
