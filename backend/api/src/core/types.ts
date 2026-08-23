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

/** How confidently a customer location was matched to a producer's zone. */
export type LocationTier =
  | "exact"
  | "alias"
  | "published_map"
  | "inferred_via_hpl"
  | "unresolved";

export interface QuantitySlab {
  from_mt: number;
  to_mt: number | null;
  rate_per_mt: number;
}

export interface DiscountTerms {
  cash_discount: number | null;
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

  basic: number | null;
  cashDiscount: number;
  netBasic: number | null;
  freight: number | null;
  /**
   * A separate per-MT insurance charge, where the producer bills one (OPaL
   * only). Excluded from `invoiceLanded` — the zonal workbook usually leaves it
   * out — but reported so it can be added when the customer bears it.
   */
  insurance: number;
  /** Comparable pre-GST landed cost. This is what the MZO workbook compares. */
  invoiceLanded: number | null;
  /** Post-sale quantity discount, settled by credit note the following month. */
  quantityDiscount: number;
  /** invoiceLanded less the post-sale credit note. */
  effectiveNet: number | null;

  zone: string | null;
  locationTier: LocationTier;
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
