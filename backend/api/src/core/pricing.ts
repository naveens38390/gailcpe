/**
 * The netback calculation — the core of every module in the product.
 *
 * It follows the ladder the MZO zonal workbook already uses, because that is
 * the comparison GAIL's marketing team argues from:
 *
 *     basic price
 *   − cash discount            (pre-sale, only on cash terms)
 *   = net basic
 *   + freight                  (only for ex-works sellers; delivered already has it)
 *   = invoice landed cost      ← what MZO calls "PRICE NET OF GST"
 *   − quantity discount        (post-sale, settled by credit note next month)
 *   = effective net
 *
 * Two rules keep the answers honest:
 *
 *  1. Freight is added only to ex-works sellers. RIL and IOCL publish delivered
 *     prices. Adding freight to them would make GAIL look better than it is by
 *     roughly the freight amount.
 *  2. A missing input is reported in `gaps`, never treated as zero. A quote with
 *     no freight figure is incomplete, not cheap.
 */

import type {
  Comparison,
  DiscountTerms,
  LocationTier,
  PaymentMode,
  PriceBasis,
  Producer,
  QuantitySlab,
  Quote,
} from "./types";

export interface Dataset {
  priceIndex: {
    effective_date: string;
    producers: Record<
      Producer,
      { basis: PriceBasis; zones: Record<string, Record<string, number>> }
    >;
    location_map: Record<Producer, Record<string, string>>;
    location_tier: Record<Producer, Record<string, LocationTier>>;
  };
  freight: {
    effective_date: string;
    books: Record<
      string,
      Array<{
        destination: string;
        rate_per_mt: number;
        /** OPaL only: a separate per-MT insurance line, billed with freight. */
        insurance_per_mt?: number;
      }>
    >;
    /** Customer location -> the destination this producer bills it as. */
    destination_map: Record<string, Record<string, string>>;
  };
  discounts: { producers: Record<Producer, DiscountTerms> };
  crossref: { index: Record<string, CrossRefEntry> };
}

export interface CrossRefEntry {
  gail_grade: string;
  polymer: string;
  section: string;
  application: string;
  characteristic: string;
  equivalents: Record<string, string[]>;
  confidence: string;
  status?: "active" | "deprecated" | "retired";
  /**
   * What separates two grades that serve the same application. Three blow
   * moulding grades can share one characteristic and still differ by process
   * and density, and that is precisely the choice an officer is making.
   */
  process?: string;
  mfi?: string;
  density?: string;
}

/**
 * Fallback list — only used if a dataset somehow carries no producers at all.
 * The real, current list is `Object.keys(data.priceIndex.producers)`, which
 * DatasetService builds from the live, published Producer collection. Retiring
 * a producer there removes it from every comparison without a code change.
 */
export const PRODUCERS: Producer[] = ["GAIL", "RIL", "IOCL", "HMEL", "OPaL", "HPL"];

/**
 * Spelling variants, loaded from the dataset rather than duplicated here.
 * GAIL spells Silvassa two ways across its own two files; keeping a second copy
 * of that table in TypeScript is how a lookup starts silently missing.
 */
let SPELLINGS: Record<string, string> = {};

export function useSpellings(table: Record<string, string>): void {
  SPELLINGS = table ?? {};
}

/** Fold a place name the same way the ETL's resolver does. */
export function normalise(name: string): string {
  const key = (name ?? "")
    .split("_")
    .pop()!
    .split("/")[0]
    .replace(/\(.*?\)/g, " ")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return SPELLINGS[key] ?? key;
}

/**
 * Fold a grade code for comparison. Circulars and the cross-reference disagree
 * on punctuation for the same grade — HPL's HDT10 is written HDT-10 in the MZO
 * workbook — and a punctuation-only miss reads as "competitor does not make
 * this grade", which is a much worse answer than the right price.
 */
export function normaliseGrade(code: string): string {
  return (code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Fold a free-text location onto GAIL's canonical 313-location list. GAIL's own
 * zone keys *are* that list, so no separate table is needed.
 *
 * A handful of them are compound names — "SILVASSA / DADRA & NAGAR HAVELI",
 * "GAZIABAD/NOIDA" — and an officer types the short form. Without this, the
 * short form fails an exact-match lookup while `freightFor`'s already-normalised
 * comparison happens to still find a rate, producing a quote with a freight
 * figure but no price — worse than failing cleanly on both.
 */
const canonicalLocationCache = new WeakMap<object, Map<string, string>>();

function canonicalLocation(data: Dataset, location: string): string {
  const gailZones = data.priceIndex.producers.GAIL?.zones;
  if (!gailZones || gailZones[location] !== undefined) return location;
  let index = canonicalLocationCache.get(gailZones);
  if (!index) {
    index = new Map();
    // A compound name like "GAZIABAD/NOIDA" names two towns, not one place plus
    // a qualifier — normalise() alone only keeps the half before the slash, so
    // an officer typing the other half needs each segment indexed on its own.
    for (const name of Object.keys(gailZones)) {
      for (const part of name.split("/")) index.set(normalise(part), name);
    }
    canonicalLocationCache.set(gailZones, index);
  }
  return index.get(normalise(location)) ?? location;
}

/** Look a grade up tolerating punctuation differences. */
export function findGrade(
  priced: Record<string, number> | undefined,
  code: string,
): string | null {
  if (!priced) return null;
  if (priced[code] !== undefined) return code;
  const key = normaliseGrade(code);
  return Object.keys(priced).find((g) => normaliseGrade(g) === key) ?? null;
}

export function slabRate(
  slabs: QuantitySlab[] | null,
  quantityMt: number,
): number {
  if (!slabs) return 0;
  let rate = 0;
  for (const slab of slabs) {
    // Between two slabs the lower one applies — every circular in the pack says
    // so explicitly, and rounding up would overstate the discount.
    if (quantityMt >= slab.from_mt) rate = slab.rate_per_mt;
  }
  return rate;
}

/**
 * Delivery cost per MT from this producer's freight circular, and any separate
 * insurance line billed alongside it.
 *
 * OPaL publishes a Rs 30/MT insurance charge in its own column. The MZO
 * workbook is inconsistent about it — folded into freight at Jalgaon, left out
 * at Bhiwandi, Daman, Silvassa and Aurangabad — so it is reported separately
 * rather than silently included or silently dropped. The headline landed cost
 * excludes it, matching how most of the zonal sheets are built; the figure is on
 * the quote so an officer can add it when the customer is paying it.
 */
function freightFor(
  data: Dataset,
  producer: Producer,
  location: string,
): { rate: number; insurance: number } | null {
  const book = data.freight.books[producer];
  if (!book) return null;
  // Resolve through the same map the price zones use: HMEL and HPL both deliver
  // to Goa but bill it as Panaji, and a plain name match would report no rate.
  const destination = data.freight.destination_map?.[producer]?.[location];
  const key = normalise(destination ?? location);
  const hit = book.find((row) => normalise(row.destination) === key);
  if (!hit) return null;
  return { rate: hit.rate_per_mt, insurance: hit.insurance_per_mt ?? 0 };
}

/**
 * Which of this producer's grades matches the GAIL grade, and does the producer
 * actually publish a price for it at this zone? The cross-reference often lists
 * several alternatives; take the first one that is actually priced here.
 */
function equivalentGrade(
  producer: Producer,
  entry: CrossRefEntry | undefined,
  gailGrade: string,
  priced: Record<string, number> | undefined,
): string | null {
  if (producer === "GAIL") return gailGrade;
  const candidates = entry?.equivalents?.[producer] ?? [];
  if (!priced) return candidates[0] ?? null;
  // The cross-reference often lists several interchangeable grades (RIL's
  // 54GB012 and B56003 both substitute for B52A003). Quote the cheapest one
  // that is actually priced here — that is the offer the customer can get, and
  // taking whichever happens to be listed first understates the competitor.
  const available = candidates
    .map((candidate) => findGrade(priced, candidate))
    .filter((g): g is string => g !== null);
  if (!available.length) return candidates[0] ?? null;
  return available.reduce((best, g) => (priced[g] < priced[best] ? g : best));
}

/**
 * GAIL's ex-works sheet lists grades with a trailing form letter (B52A003A)
 * while the cross-reference names the base grade (B52A003). Try the exact code
 * first, then the sheet's own suffixed variants.
 */
function gailGradeKey(
  priced: Record<string, number> | undefined,
  grade: string,
): string | null {
  if (!priced) return null;
  const exact = findGrade(priced, grade);
  if (exact) return exact;
  const key = normaliseGrade(grade);
  const match = Object.keys(priced).find(
    (k) => normaliseGrade(k) === `${key}A` || normaliseGrade(k).replace(/A$/, "") === key,
  );
  return match ?? null;
}

export function quote(
  data: Dataset,
  producer: Producer,
  gailGrade: string,
  location: string,
  quantityMt: number,
  paymentMode: PaymentMode,
): Quote {
  const gaps: string[] = [];
  const entry = data.crossref.index[gailGrade];
  const terms = data.discounts.producers[producer];
  const source = data.priceIndex.producers[producer];

  const canonical = canonicalLocation(data, location);
  const zone =
    producer === "GAIL"
      ? (source?.zones[canonical] ? canonical : null)
      : (data.priceIndex.location_map[producer]?.[canonical] ?? null);
  const tier: LocationTier =
    producer === "GAIL"
      ? zone
        ? "exact"
        : "unresolved"
      : (data.priceIndex.location_tier[producer]?.[canonical] ?? "unresolved");

  if (!zone) gaps.push(`${producer} publishes no price point covering ${location}`);

  const priced = zone ? source?.zones[zone] : undefined;
  const grade =
    producer === "GAIL"
      ? gailGradeKey(priced, gailGrade)
      : equivalentGrade(producer, entry, gailGrade, priced);

  if (!grade) {
    gaps.push(
      producer === "GAIL"
        ? `${gailGrade} is not on GAIL's price sheet`
        : `no ${producer} equivalent recorded for ${gailGrade}`,
    );
  }

  const basic = grade && priced ? (priced[findGrade(priced, grade) ?? grade] ?? null) : null;
  if (grade && zone && basic === null) {
    gaps.push(`${producer} does not price ${grade} at ${zone}`);
  }

  const cashDiscount =
    paymentMode === "cash" ? (terms?.cash_discount ?? 0) : 0;
  if (paymentMode === "cash" && terms?.cash_discount == null) {
    gaps.push(`${producer} cash discount unknown`);
  }

  const netBasic = basic === null ? null : basic - cashDiscount;

  const basis = source?.basis ?? null;
  let freight: number | null = 0;
  let insurance = 0;
  if (basis === "ex_works") {
    const carriage = freightFor(data, producer, canonical);
    if (carriage === null) {
      freight = null;
      gaps.push(`${producer} publishes no freight rate to ${location}`);
    } else {
      freight = carriage.rate;
      insurance = carriage.insurance;
    }
  }

  const invoiceLanded =
    netBasic === null || freight === null ? null : netBasic + freight;

  let quantityDiscount = slabRate(terms?.quantity_slabs ?? null, quantityMt);
  if (terms?.metallocene_qd_cap && grade?.endsWith("M")) {
    quantityDiscount = Math.min(quantityDiscount, terms.metallocene_qd_cap);
  }
  if (!terms?.quantity_slabs && terms?.quantity_slabs_status) {
    gaps.push(`${producer} quantity discount ${terms.quantity_slabs_status}`);
  }

  return {
    producer,
    grade,
    basis,
    basic,
    cashDiscount,
    netBasic,
    freight,
    insurance,
    invoiceLanded,
    quantityDiscount,
    effectiveNet:
      invoiceLanded === null ? null : invoiceLanded - quantityDiscount,
    zone,
    locationTier: tier,
    gaps,
    mappingConfidence: producer === "GAIL" ? null : (entry?.confidence ?? null),
  };
}

export function compare(
  data: Dataset,
  gailGrade: string,
  location: string,
  quantityMt: number,
  paymentMode: PaymentMode,
): Comparison {
  const activeProducers = (Object.keys(data.priceIndex.producers) as Producer[]).length
    ? (Object.keys(data.priceIndex.producers) as Producer[])
    : PRODUCERS;
  const quotes = activeProducers.map((p) =>
    quote(data, p, gailGrade, location, quantityMt, paymentMode),
  );
  const priced = quotes.filter((q) => q.invoiceLanded !== null);
  priced.sort((a, b) => a.invoiceLanded! - b.invoiceLanded!);

  const gail = quotes.find((q) => q.producer === "GAIL") ?? null;
  const competitors = priced.filter((q) => q.producer !== "GAIL");
  const leader = competitors[0] ?? null;

  const warnings: string[] = [];
  const unpriced = quotes.filter((q) => q.invoiceLanded === null);
  if (unpriced.length) {
    warnings.push(
      `Not compared: ${unpriced.map((q) => q.producer).join(", ")} — see each quote's gaps.`,
    );
  }
  const inferred = priced.filter((q) => q.locationTier === "inferred_via_hpl");
  if (inferred.length) {
    warnings.push(
      `Zone inferred from HPL's district map for ${inferred
        .map((q) => q.producer)
        .join(", ")} — confirm before quoting.`,
    );
  }
  const entry = data.crossref.index[gailGrade];
  if (entry && entry.confidence && entry.confidence !== "H") {
    warnings.push(
      `Grade mapping confidence is ${entry.confidence}, not high.`,
    );
  }
  if (entry?.status === "retired") {
    warnings.push(`${gailGrade} is marked retired — confirm before quoting.`);
  } else if (entry?.status === "deprecated") {
    warnings.push(`${gailGrade} is marked deprecated.`);
  }

  return {
    grade: gailGrade,
    location,
    quantityMt,
    paymentMode,
    quotes,
    leader,
    gail,
    gapToLeader:
      gail?.invoiceLanded != null && leader?.invoiceLanded != null
        ? gail.invoiceLanded - leader.invoiceLanded
        : null,
    gailRank:
      gail?.invoiceLanded != null
        ? priced.findIndex((q) => q.producer === "GAIL") + 1
        : null,
    warnings,
  };
}
