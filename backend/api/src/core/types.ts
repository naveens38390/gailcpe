export type Producer = "GAIL" | "RIL" | "IOCL" | "HMEL" | "OPaL" | "HPL";

/**
 * How a producer's published price is quoted. This decides whether freight is
 * added, and getting it wrong is the fastest way to a confident wrong answer.
 *
 *   delivered — RIL and IOCL. Freight to the customer is already inside the
 *               published number. Adding freight again overstates them.
 *   ex_works  — GAIL, HMEL, OPaL, HPL. Freight comes from that producer's own
 *               freight circular and must be added.
 *   ex_depot  — customer collects from a depot and arranges their own transport.
 */
export type PriceBasis = "delivered" | "ex_works" | "ex_depot";

export type PaymentMode = "cash" | "credit_ifc";

/**
 * Which of a producer's two price lists a quote is read from. Not the same
 * thing as `PriceBasis`: that says whether a published price already carries
 * freight, this says whether the customer is buying at the works or from a
 * depot. RIL and IOCL's "ex works" column is their delivered price, which is how
 * the zonal comparison workbook treats it.
 */
export type PricingBasis = "ex_works" | "ex_depot";

/**
 * How confidently a customer location was matched to a producer's zone.
 *
 * `evidence` was always emitted by the ETL (a price the zonal workbook
 * proves) but missing from this union (R13) — added here, not new behaviour.
 * `state_zone` and `inferred_location` are decision 0010's fallback tiers.
 * `inferred_via_hpl` is a read-only legacy alias: never written after the
 * fallback table exists, but a stored `comparisonHistory` / `dealSimulations`
 * record keeps it forever (saved as served, never migrated) — see
 * `core/location-match.ts`, which is what actually groups these for display.
 */
export type LocationTier =
  | "exact"
  | "alias"
  | "evidence"
  | "published_map"
  | "state_zone"
  | "inferred_location"
  | "inferred_via_hpl"
  | "unresolved";

/** One producer's fallback provenance for one town — meaningful only for a `territory`/`inferred` match. */
export interface LocationMeta {
  /** Straight-line distance in km to the matched zone; null for a whole-state zone (no single point). */
  km: number | null;
  crossesState: boolean;
  /** Whether HPL's own Annexure V corroborates the match. */
  corroborated: boolean;
  /** `retained`: one of the 60 option-3 rows (today's live mapping, kept) — shown as Retained Existing Mapping. */
  source: "annexure_v" | "state_zone" | "nearest" | "retained";
  /**
   * true: the approved table supplied this zone (the producer publishes nothing for the town).
   * false: the table confirms a zone the producer's own published data already gives.
   * Absent on data built before 2026-09-25, which only carried supplied rows.
   */
  supplied?: boolean;
}

/**
 * What a `Quote` carries instead of the app interpreting `locationTier`
 * itself — the server sends the group and label already resolved (`core/location-match.ts`).
 */
export interface LocationMatch {
  group: "exact" | "territory" | "inferred" | "none";
  label: string;
  matchedZone: string | null;
  distanceKm?: number;
  crossesState?: boolean;
  corroborated?: boolean;
  source?: string;
}

export interface QuantitySlab {
  from_mt: number;
  to_mt: number | null;
  rate_per_mt: number;
}

export interface DiscountTerms {
  cash_discount: number | null;
  /** Cash discount on a depot sale, where it differs — GAIL and OPaL give none. */
  cash_discount_depot?: number | null;
  cash_discount_ldpe?: number;
  cash_discount_source?: string;
  early_payment_per_day: number | null;
  early_payment_max_days?: number;
  interest_free_credit_days: number | null;
  quantity_slabs: QuantitySlab[] | null;
  quantity_slabs_status?: string;
  metallocene_qd_cap?: number;
  dealer_discount?: number;
  cash_discount_note?: string;
}

/** One producer's offer for a specific grade, location, quantity and terms. */
export interface Quote {
  producer: Producer;
  grade: string | null;
  basis: PriceBasis | null;

  /** Which price list this quote was read from. */
  pricingBasis: PricingBasis;
  /** Whether this producer has a price for this grade at this location on each list. */
  basisAvailability: Record<PricingBasis, boolean>;

  basic: number | null;
  cashDiscount: number;
  /** No producer publishes either in this round; the zonal workbook carries them at zero. */
  tradeDiscount: number;
  preSaleDiscount: number;
  /** RIL's Rs 350/MT, taken off ex-depot prices only. Zero on every ex-works quote. */
  dealerDiscount: number;
  netBasic: number | null;
  /** Ex-works only. A depot price has no freight step. */
  freight: number | null;
  basicPlusFreight: number | null;
  /**
   * A separate per-MT insurance charge, where the producer bills one (OPaL
   * only). Excluded from `invoiceLanded` — the zonal workbook usually leaves it
   * out — but reported so it can be added when the customer bears it.
   */
  insurance: number;
  /** Comparable pre-GST landed cost. This is what the MZO workbook compares. */
  invoiceLanded: number | null;
  /** The workbook's "PRICE NET OF GST" — the same figure as `invoiceLanded`. */
  priceNetOfGst: number | null;
  /**
   * GAIL's price net of GST less this producer's, per MT. Positive means GAIL is
   * dearer. Null on GAIL's own quote, and where either side could not be priced.
   */
  priceDelta: number | null;
  /** Post-sale quantity discount, settled by credit note the following month. */
  quantityDiscount: number;
  /** invoiceLanded less the post-sale credit note. */
  effectiveNet: number | null;

  zone: string | null;
  locationTier: LocationTier;
  /**
   * Optional: absent when `zone` is null (unresolved, nothing to report).
   * `locationTier` stays on the Quote unchanged for compatibility; this is
   * the field a new app reads instead of interpreting the tier string itself.
   */
  locationMatch?: LocationMatch;
  /** Why this quote is incomplete, if it is. Never silently zero-filled. */
  gaps: string[];
  /** Confidence carried from the cross-reference sheet (H / M / L). */
  mappingConfidence: string | null;
}

export interface Comparison {
  grade: string;
  location: string;
  quantityMt: number;
  paymentMode: PaymentMode;
  quotes: Quote[];
  /** Cheapest producer with a complete quote, or null if none could be priced. */
  leader: Quote | null;
  gail: Quote | null;
  /** Positive means GAIL is dearer than the leader by this much per MT. */
  gapToLeader: number | null;
  /** 1 = cheapest. Null when GAIL could not be priced. */
  gailRank: number | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Deal Simulator
// ---------------------------------------------------------------------------

export type DealOutcome = "leading" | "matched" | "behind" | "not_priced";

/** One option a sales officer can act on, priced through the same ladder. */
export interface DealOption {
  label: string;
  /** Rupees per MT taken off GAIL's price. */
  correctionPerMt: number;
  /** GAIL's landed cost after the correction. */
  gailLanded: number;
  /** Positive means still dearer than the cheapest competitor. */
  gapAfter: number;
  outcome: DealOutcome;
  /** What the correction costs across the whole order. */
  totalCost: number;
  recommended: boolean;
}

export interface DealSimulation {
  customer: string | null;
  grade: string;
  location: string;
  quantityMt: number;
  paymentMode: PaymentMode;
  /** Which price list every producer in this simulation was read from. */
  pricingBasis: PricingBasis;

  comparison: Comparison;
  /** Where GAIL sits today, before any correction. */
  outcome: DealOutcome;
  options: DealOption[];
  /**
   * Plain-language reasoning a sales officer can put in front of a manager.
   * Never a bare number — the officer has to defend the ask.
   */
  narrative: string[];
  /**
   * Confidence in the numbers themselves, not in winning the deal. Downgraded
   * by inferred locations, medium-confidence grade mappings and missing inputs.
   */
  dataConfidence: "high" | "medium" | "low";
  dataCaveats: string[];
}
