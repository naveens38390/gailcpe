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

import { buildLocationMatch, inferredCaveat, tierGroup } from "./location-match";
import type {
  Comparison,
  DiscountTerms,
  LocationMeta,
  LocationTier,
  PaymentMode,
  PriceBasis,
  PricingBasis,
  Producer,
  QuantitySlab,
  Quote,
} from "./types";

/**
 * Decision 0010 §6/§10 kill-switch: off treats every `inferred`-group quote
 * as unresolved. Default on (fail-open for the feature, fail-safe direction
 * is *disabling* it). Set once at boot from `LOCATION_FALLBACK`
 * (`DatasetService`), not read from `process.env` here — this module stays a
 * pure function library, the same reason `useSpellings` exists as a setter.
 */
let LOCATION_FALLBACK_ENABLED = true;

export function useLocationFallback(enabled: boolean): void {
  LOCATION_FALLBACK_ENABLED = enabled;
}

export interface Dataset {
  priceIndex: {
    effective_date: string;
    producers: Record<
      Producer,
      { basis: PriceBasis; zones: Record<string, Record<string, number>> }
    >;
    location_map: Record<Producer, Record<string, string>>;
    location_tier: Record<Producer, Record<string, LocationTier>>;
    /**
     * Fallback provenance (decision 0010) — present only for a town/producer
     * pair the fallback table filled in, never for an exact/alias/evidence or
     * a genuine HPL district match the resolver found on its own.
     */
    location_meta?: Partial<Record<Producer, Record<string, LocationMeta>>>;
    /**
     * Each producer's second price list, for stock the customer collects from a
     * depot or warehouse. Absent for a producer whose list is not loaded for
     * the round, which reads as "not available", never as zero.
     */
    depot?: Partial<Record<Producer, { zones: Record<string, Record<string, number>> }>>;
    depot_location_map?: Partial<Record<Producer, Record<string, string>>>;
    depot_location_tier?: Partial<Record<Producer, Record<string, LocationTier>>>;
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
 * Who comes first when two producers land at exactly the same price. Fixed and
 * documented so the same grade, town and prices always name the same leader and
 * rank; without it the tie fell to the order rows happened to load in, which
 * changed between restarts. GAIL first means GAIL ranks ahead of a competitor it
 * ties with. (Owner-approved order, 2026-09-22.)
 */
export const TIE_BREAK_ORDER: Producer[] = ["GAIL", "IOCL", "HMEL", "HPL", "OPaL", "RIL"];
const tieRank = (p: Producer) => {
  const i = TIE_BREAK_ORDER.indexOf(p);
  return i === -1 ? TIE_BREAK_ORDER.length : i;
};

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
 * The base grade an additive variant is a variant of, or null.
 *
 * GAIL's book carries a `NA` additive form of eleven grades. Only one of them
 * — B52A003NA — was given its own cross-reference row; the rest were left out
 * of the sheet entirely.
 */
export function additiveBaseOf(code: string): string | null {
  const folded = normaliseGrade(code);
  return folded.endsWith("NA") ? folded.slice(0, -2) : null;
}

/**
 * The base grade behind a trailing form letter, or null.
 *
 * GAIL's price sheet names a grade with the form letter it ships as —
 * B52A003A — while the cross-reference master names the grade itself,
 * B52A003. `gailGradeKey` already reconciles the two when looking up a price
 * from a cross-reference row; this is the same rule for the other direction,
 * finding the row that governs a code read off the sheet.
 *
 * `NA` is left to `additiveBaseOf`: there the last two characters are the
 * additive, not a form letter, and stripping one would leave a stray N.
 */
export function formBaseOf(code: string): string | null {
  const folded = normaliseGrade(code);
  if (!folded.endsWith("A") || folded.endsWith("NA")) return null;
  return folded.slice(0, -1);
}

/**
 * The cross-reference row that governs a grade.
 *
 * Where the sheet wrote both a base grade and its additive variant, it
 * published byte-identical competitor equivalents for the pair — B52A003 and
 * B52A003NA carry the same six producers and the same codes, as do W52A009
 * and W52ASR009. The additive changes the material, not which competitor
 * grade substitutes for it.
 *
 * So a variant the sheet never got round to writing inherits its base grade's
 * row rather than being treated as having no competitors at all, which is what
 * left ten grades GAIL prices everywhere marked "GAIL only".
 */
export function crossRefFor(data: Dataset, gailGrade: string): CrossRefEntry | undefined {
  const direct = data.crossref.index[gailGrade];
  if (direct) return direct;

  const folded = normaliseGrade(gailGrade);
  const exact = Object.keys(data.crossref.index).find((k) => normaliseGrade(k) === folded);
  if (exact) return data.crossref.index[exact];

  // Both fallbacks run only once an exact match has failed, so neither can
  // change a grade that already resolves — they can only give a row to one
  // that had none. The additive rule goes first: for a code ending NA those
  // two characters are the additive, and the form-letter rule declines it.
  for (const base of [additiveBaseOf(gailGrade), formBaseOf(gailGrade)]) {
    if (!base) continue;
    const key = Object.keys(data.crossref.index).find((k) => normaliseGrade(k) === base);
    if (key) return data.crossref.index[key];
  }
  return undefined;
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

export interface GradeOption {
  code: string;
  /** Ex-works basic price; null when the cross-reference lists this code but it is not priced here. */
  price: number | null;
  /** The same code's ex-depot basic price at this location, null where the depot list does not carry it. */
  depotPrice: number | null;
}

/**
 * Every competitor code the cross-reference lists for this GAIL grade, priced
 * at each producer's zone for this location — the full set `equivalentGrade`
 * picks its cheapest-priced entry from, exposed so an officer can override
 * that choice one producer at a time instead of always getting the cheapest.
 */
export function equivalentOptions(
  data: Dataset,
  gailGrade: string,
  location: string,
): Partial<Record<Producer, GradeOption[]>> {
  const entry = crossRefFor(data, gailGrade);
  const canonical = canonicalLocation(data, location);
  const result: Partial<Record<Producer, GradeOption[]>> = {};
  for (const producer of Object.keys(data.priceIndex.producers) as Producer[]) {
    if (producer === "GAIL") continue;
    const candidates = entry?.equivalents?.[producer] ?? [];
    if (!candidates.length) continue;
    const source = data.priceIndex.producers[producer];
    const zone = data.priceIndex.location_map[producer]?.[canonical] ?? null;
    const priced = zone ? source?.zones[zone] : undefined;
    const depotZone = data.priceIndex.depot_location_map?.[producer]?.[canonical] ?? null;
    const depotPriced = depotZone ? data.priceIndex.depot?.[producer]?.zones[depotZone] : undefined;
    result[producer] = candidates.map((code) => {
      const key = findGrade(priced, code);
      const depotKey = findGrade(depotPriced, code);
      return {
        code,
        price: key && priced ? (priced[key] ?? null) : null,
        depotPrice: depotKey && depotPriced ? (depotPriced[depotKey] ?? null) : null,
      };
    });
  }
  return result;
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

/**
 * Where a producer's price for one grade sits on one of its two price lists:
 * which zone serves the location, which of its grades applies, and the basic
 * price. Everything downstream — the ladder, and whether the other list is
 * worth offering — reads from this.
 */
function priceLookup(
  data: Dataset,
  producer: Producer,
  entry: CrossRefEntry | undefined,
  gailGrade: string,
  canonical: string,
  location: string,
  overrideGrade: string | undefined,
  pricingBasis: PricingBasis,
): {
  zone: string | null;
  tier: LocationTier;
  grade: string | null;
  basic: number | null;
  gaps: string[];
} {
  const gaps: string[] = [];
  const depot = pricingBasis === "ex_depot";
  const zones = depot
    ? data.priceIndex.depot?.[producer]?.zones
    : data.priceIndex.producers[producer]?.zones;

  let zone = depot
    ? (data.priceIndex.depot_location_map?.[producer]?.[canonical] ?? null)
    : producer === "GAIL"
      ? (zones?.[canonical] ? canonical : null)
      : (data.priceIndex.location_map[producer]?.[canonical] ?? null);
  let tier: LocationTier = depot
    ? zone
      ? (data.priceIndex.depot_location_tier?.[producer]?.[canonical] ?? "unresolved")
      : "unresolved"
    : producer === "GAIL"
      ? zone
        ? "exact"
        : "unresolved"
      : (data.priceIndex.location_tier[producer]?.[canonical] ?? "unresolved");

  // Defence in depth on top of the data (decision 0010 §7): a depot price is
  // where the customer physically collects, never a guess by distance, and
  // the ETL never writes a fallback tier into depot coverage — but a future
  // bug placing one there must not silently ship as if it were published.
  if (depot && (tier === "state_zone" || tier === "inferred_location")) {
    zone = null;
    tier = "unresolved";
  }
  // Kill-switch (§6/§10): off treats every inferred-group quote as
  // unresolved, fail-safe direction. Territory Match is unaffected — it is a
  // producer's own published statement, not an inference.
  if (!LOCATION_FALLBACK_ENABLED && tierGroup(tier) === "inferred") {
    zone = null;
    tier = "unresolved";
  }

  if (!zone) {
    gaps.push(
      depot
        ? zones
          ? `${producer} has no depot price covering ${location}`
          : `${producer}'s ex-depot price list is not loaded for this round`
        : `${producer} publishes no price point covering ${location}`,
    );
  }

  const priced = zone ? zones?.[zone] : undefined;
  const grade =
    producer === "GAIL"
      ? gailGradeKey(priced, gailGrade)
      : overrideGrade
        ? (findGrade(priced, overrideGrade) ?? overrideGrade)
        : equivalentGrade(producer, entry, gailGrade, priced);

  if (!grade) {
    gaps.push(
      producer === "GAIL"
        ? `${gailGrade} is not on GAIL's ${depot ? "stock-point" : "ex-works"} price sheet`
        : `no ${producer} equivalent recorded for ${gailGrade}`,
    );
  }

  const basic = grade && priced ? (priced[findGrade(priced, grade) ?? grade] ?? null) : null;
  if (grade && zone && basic === null) {
    gaps.push(`${producer} does not price ${grade} ${depot ? "ex-depot " : ""}at ${zone}`);
  }
  return { zone, tier, grade, basic, gaps };
}

export function quote(
  data: Dataset,
  producer: Producer,
  gailGrade: string,
  location: string,
  quantityMt: number,
  paymentMode: PaymentMode,
  /** Quote this exact competitor code instead of the auto-picked cheapest equivalent. Ignored for GAIL. */
  overrideGrade?: string,
  /** Which of the producer's two price lists to read. Ex works unless asked otherwise. */
  pricingBasis: PricingBasis = "ex_works",
): Quote {
  const entry = crossRefFor(data, gailGrade);
  const terms = data.discounts.producers[producer];
  const source = data.priceIndex.producers[producer];
  const canonical = canonicalLocation(data, location);
  const depot = pricingBasis === "ex_depot";

  const chosen = priceLookup(
    data, producer, entry, gailGrade, canonical, location, overrideGrade, pricingBasis,
  );
  const other = priceLookup(
    data, producer, entry, gailGrade, canonical, location, overrideGrade,
    depot ? "ex_works" : "ex_depot",
  );
  const basisAvailability: Record<PricingBasis, boolean> = {
    ex_works: (depot ? other : chosen).basic !== null,
    ex_depot: (depot ? chosen : other).basic !== null,
  };
  const { zone, tier, grade, basic } = chosen;
  const gaps = [...chosen.gaps];
  const meta = depot ? undefined : data.priceIndex.location_meta?.[producer]?.[canonical];
  const locationMatch = buildLocationMatch(tier, zone, meta);

  // A depot sale carries its own cash-discount rate where the producer prints
  // one (GAIL and OPaL give none); otherwise it is the ordinary rate.
  const rate = depot
    ? (terms?.cash_discount_depot !== undefined ? terms.cash_discount_depot : terms?.cash_discount)
    : terms?.cash_discount;
  const cashDiscount = paymentMode === "cash" ? (rate ?? 0) : 0;
  if (paymentMode === "cash" && rate == null) {
    gaps.push(`${producer} cash discount unknown`);
  }

  // RIL's dealer discount is a term of its depot sales, and it comes off the
  // price on cash and credit alike. An ex-works quote never carries it.
  const dealerDiscount = depot ? (terms?.dealer_discount ?? 0) : 0;
  const netBasic = basic === null ? null : basic - cashDiscount - dealerDiscount;

  // A depot price is collected from the depot, so there is no carriage step.
  const basis = source?.basis ?? null;
  let freight: number | null = 0;
  let insurance = 0;
  if (!depot && basis === "ex_works") {
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

  /**
   * Terms the dataset carries that this ladder does not model.
   *
   * The early-payment incentive and the interest-free credit period are real
   * money — HMEL's EPI is worth Rs 1,040/MT against RIL's Rs 720 — but turning
   * either into a number needs a commercial rule nobody has written down yet:
   * whether the incentive stacks with the cash discount, and what a day of
   * free credit is worth. Guessing would move quoted prices.
   *
   * So they are reported rather than applied. Naming them once per producer
   * keeps the caveat honest without burying the two gaps that mean a figure is
   * actually missing.
   */
  const unmodelled: string[] = [];

  // Early payment and interest-free credit are terms of a *credit* sale. A
  // buyer paying cash has taken the cash discount instead and is never offered
  // them, so raising them against a cash quote describes a deal that is not on
  // the table — which is what the client saw on the Compare screen.
  if (paymentMode !== "cash") {
    if (terms?.early_payment_per_day) {
      const cap = terms.early_payment_max_days ? ` up to ${terms.early_payment_max_days} days` : "";
      unmodelled.push(`early payment Rs ${terms.early_payment_per_day}/MT/day${cap}`);
    }
    if (terms?.interest_free_credit_days) {
      unmodelled.push(`${terms.interest_free_credit_days} days interest-free credit`);
    }
  }

  if (unmodelled.length) {
    gaps.push(`${producer} also offers ${unmodelled.join(" and ")} — on record, not in this ladder`);
  }

  return {
    producer,
    grade,
    basis,
    pricingBasis,
    basisAvailability,
    basic,
    cashDiscount,
    tradeDiscount: 0,
    preSaleDiscount: 0,
    dealerDiscount,
    netBasic,
    freight,
    basicPlusFreight: depot || netBasic === null || freight === null ? null : netBasic + freight,
    insurance,
    invoiceLanded,
    priceNetOfGst: invoiceLanded,
    priceDelta: null,
    quantityDiscount,
    effectiveNet:
      invoiceLanded === null ? null : invoiceLanded - quantityDiscount,
    zone,
    locationTier: tier,
    locationMatch,
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
  /** Per-producer override of which equivalent competitor grade to quote. */
  gradeOverrides?: Partial<Record<Producer, string>>,
  /** Which price list each producer is read from; the default applies where a producer is not named. */
  basisOverrides?: Partial<Record<Producer, PricingBasis>>,
  /** The list every producer starts on before `basisOverrides` is applied. */
  defaultBasis: PricingBasis = "ex_works",
): Comparison {
  const activeProducers = [
    ...((Object.keys(data.priceIndex.producers) as Producer[]).length
      ? (Object.keys(data.priceIndex.producers) as Producer[])
      : PRODUCERS),
  ].sort((a, b) => tieRank(a) - tieRank(b));
  const quotes = activeProducers.map((p) =>
    quote(
      data, p, gailGrade, location, quantityMt, paymentMode, gradeOverrides?.[p],
      basisOverrides?.[p] ?? defaultBasis,
    ),
  );
  // The zonal workbook's "PRICE DELTA (@ 1 MT) (GAIL - Competitor)": both sides
  // net of GST, before any quantity credit, measured against GAIL as it is
  // currently shown — whichever price list that is.
  const gailNet = quotes.find((q) => q.producer === "GAIL")?.priceNetOfGst ?? null;
  for (const q of quotes) {
    q.priceDelta =
      q.producer !== "GAIL" && gailNet !== null && q.priceNetOfGst !== null
        ? gailNet - q.priceNetOfGst
        : null;
  }
  const priced = quotes.filter((q) => q.invoiceLanded !== null);
  priced.sort(
    (a, b) => a.invoiceLanded! - b.invoiceLanded! || tieRank(a.producer) - tieRank(b.producer),
  );

  const gail = quotes.find((q) => q.producer === "GAIL") ?? null;
  const competitors = priced.filter((q) => q.producer !== "GAIL");
  const leader = competitors[0] ?? null;

  const warnings: string[] = [];
  const unpriced = quotes.filter((q) => q.invoiceLanded === null);
  // A producer with no depot list for this grade and town has published nothing
  // — different from a price that could not be worked out.
  const unpublished = unpriced.filter(
    (q) => q.pricingBasis === "ex_depot" && !q.basisAvailability.ex_depot,
  );
  const unresolved = unpriced.filter((q) => !unpublished.includes(q));
  if (unpublished.length) {
    warnings.push(
      `Not published ex depot: ${unpublished.map((q) => q.producer).join(", ")}.`,
    );
  }
  if (unresolved.length) {
    warnings.push(
      `Not compared: ${unresolved.map((q) => q.producer).join(", ")} — see each quote's gaps.`,
    );
  }
  // Group test (decision 0010), not the bare tier string: catches both the
  // fallback table's inferred_location and a legacy inferred_via_hpl record.
  const inferred = priced.filter((q) => tierGroup(q.locationTier) === "inferred");
  if (inferred.length) {
    const detail = inferred
      .map((q) => (q.locationMatch ? inferredCaveat(q.producer, location, q.locationMatch) : q.producer))
      .join("; ");
    warnings.push(
      `Inferred Location Match: ${detail}. These are published zones near the customer's town, not the town itself. Confirm before quoting.`,
    );
  }
  const entry = crossRefFor(data, gailGrade);
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
