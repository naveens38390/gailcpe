/**
 * Assembles the in-memory dataset the pricing engine works against.
 *
 * A single comparison touches six producers across ~52,000 price rows and four
 * freight books. Doing that as per-request queries would be a dozen round trips
 * for an answer that must land in under a second on a phone on mobile data — so
 * a whole circular round is loaded once and held.
 *
 * The round is the natural cache key: prices change when a circular is
 * published, not otherwise. `invalidate()` is what a publish calls; that is also
 * where Redis slots in when it is provisioned, with the same key.
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import type { Dataset } from "../../core/pricing";
import { useSpellings } from "../../core/pricing";
import type { DiscountTerms, Producer } from "../../core/types";
import {
  DiscountScheme,
  FreightEntry,
  PriceCircular,
  PriceEntry,
} from "../../database/schemas/circular.schema";
import { Location } from "../../database/schemas/catalog.schema";
import { GradeMapping } from "../../database/schemas/catalog.schema";
import { Producer as ProducerDoc } from "../../database/schemas/catalog.schema";
import { PriceCorrection } from "../../database/schemas/correction.schema";
import { DiscountTerms as DiscountTermsDoc } from "../../database/schemas/discount-terms.schema";

/**
 * Towns that more than one document spells differently. GAIL alone spells
 * Silvassa two ways across its own two files, so this is needed before any
 * competitor is considered. Kept beside the resolver rather than in the data so
 * the API and the ETL cannot drift apart silently.
 */
const SPELLINGS: Record<string, string> = {
  SILVAASA: "SILVASSA",
  BHINWANDI: "BHIWANDI",
  NASIK: "NASHIK",
  MANGLORE: "MANGALORE",
  CALCUTTA: "KOLKATA",
  GAZIABAD: "GHAZIABAD",
  BENGALURU: "BANGALORE",
  BHATINDA: "BATHINDA",
  PANJI: "PANAJI",
  VIZAG: "VISAKHAPATNAM",
  VISAK: "VISAKHAPATNAM",
  BARODA: "VADODARA",
  TRIVANDRUM: "THIRUVANANTHAPURAM",
  PONDICHERRY: "PUDUCHERRY",
};

/** Given rows sorted newest-first, keep only the first (= newest) one per producer. */
function dedupeNewestPerProducer<T extends { producer: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.producer)) continue;
    seen.add(row.producer);
    out.push(row);
  }
  return out;
}

/** camelCase (the schema, and what a form posts) -> snake_case (what the engine reads). */
function mapDiscountFields(values: Partial<DiscountTermsDoc>): Partial<DiscountTerms> {
  const out: Partial<DiscountTerms> = {};
  if (values.cashDiscount !== undefined) out.cash_discount = values.cashDiscount;
  if (values.cashDiscountLdpe !== undefined) out.cash_discount_ldpe = values.cashDiscountLdpe;
  if (values.earlyPaymentPerDay !== undefined) out.early_payment_per_day = values.earlyPaymentPerDay;
  if (values.earlyPaymentMaxDays !== undefined) out.early_payment_max_days = values.earlyPaymentMaxDays;
  if (values.interestFreeCreditDays !== undefined)
    out.interest_free_credit_days = values.interestFreeCreditDays;
  if (values.dealerDiscount !== undefined) out.dealer_discount = values.dealerDiscount;
  if (values.metalloceneQdCap !== undefined) out.metallocene_qd_cap = values.metalloceneQdCap;
  if (values.quantitySlabs !== undefined) {
    out.quantity_slabs = values.quantitySlabs;
    // A proposal that sets real slabs retires the "not published" gap message —
    // the engine only emits it when quantity_slabs is falsy, but clearing the
    // status too keeps the dataset internally consistent for anything else that
    // reads it directly.
    out.quantity_slabs_status = undefined;
  }
  return out;
}

@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);
  private readonly cache = new Map<string, Dataset>();

  constructor(
    @InjectModel(PriceCircular.name) private circulars: Model<PriceCircular>,
    @InjectModel(PriceEntry.name) private prices: Model<PriceEntry>,
    @InjectModel(FreightEntry.name) private freight: Model<FreightEntry>,
    @InjectModel(DiscountScheme.name) private discounts: Model<DiscountScheme>,
    @InjectModel(Location.name) private locations: Model<Location>,
    @InjectModel(GradeMapping.name) private mappings: Model<GradeMapping>,
    @InjectModel(PriceCorrection.name) private corrections: Model<PriceCorrection>,
    @InjectModel(DiscountTermsDoc.name) private discountTerms: Model<DiscountTermsDoc>,
    @InjectModel(ProducerDoc.name) private producerDocs: Model<ProducerDoc>,
  ) {
    useSpellings(SPELLINGS);
  }

  /**
   * Each producer's own most recent round — not one shared date. Producers
   * publish independently (GAIL's own Price Circular Management proved this
   * the hard way: publishing GAIL alone under a new date, against the old
   * "one round for everyone" resolver, made every competitor vanish from
   * every comparison because their PriceEntry rows simply didn't exist at
   * GAIL's new date). For a live view this is "whichever circular is
   * currently active"; for `asOf` it's "whichever was most recent as of that
   * date", regardless of whether it has since been superseded — a circular
   * that is superseded *today* can still have been the live one back then.
   */
  private async resolveProducerRounds(asOf?: Date): Promise<Map<string, Date>> {
    const match = asOf ? { effectiveDate: { $lte: asOf } } : { status: "active" };
    const rows = await this.circulars.aggregate<{ _id: string; effectiveDate: Date }>([
      { $match: match },
      { $sort: { effectiveDate: -1 } },
      { $group: { _id: "$producer", effectiveDate: { $first: "$effectiveDate" } } },
    ]);
    return new Map(rows.map((r) => [r._id, r.effectiveDate]));
  }

  async load(asOf?: Date): Promise<Dataset> {
    const producerRounds = await this.resolveProducerRounds(asOf);
    if (!producerRounds.size) {
      throw new NotFoundException(
        asOf
          ? `No price circular was in force on ${asOf.toISOString().slice(0, 10)}.`
          : "No price circular has been loaded. Run the seed first.",
      );
    }
    const key = [...producerRounds.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([producer, date]) => `${producer}:${date.toISOString()}`)
      .join("|");
    const cached = this.cache.get(key);
    if (cached) return asOf ? cached : this.applyLiveOverlay(cached);

    const started = Date.now();
    const [priceRowBatches, freightRows, discountRows, locationRows, mappingRows] =
      await Promise.all([
        Promise.all(
          [...producerRounds.entries()].map(([producer, round]) =>
            this.prices.find({ producer, effectiveDate: round }).lean(),
          ),
        ),
        this.freight.find().sort({ effectiveDate: -1 }).lean(),
        this.discounts
          .find(asOf ? { effectiveDate: { $lte: asOf } } : {})
          .sort({ effectiveDate: -1 })
          .lean(),
        this.locations.find().lean(),
        this.mappings.find().lean(),
      ]);
    const priceRows = priceRowBatches.flat();

    const producers: Dataset["priceIndex"]["producers"] = {} as any;
    const supplyPoint: Record<string, Record<string, Record<string, string>>> = {};
    for (const row of priceRows) {
      const producer = (producers as any)[row.producer] ??= {
        basis: row.basis,
        zones: {},
      };
      (producer.zones[row.zone] ??= {})[row.grade] = row.price;
      if (row.supplyPoint) {
        ((supplyPoint[row.producer] ??= {})[row.zone] ??= {})[row.grade] =
          row.supplyPoint;
      }
    }

    const location_map: Record<string, Record<string, string>> = {};
    const location_tier: Record<string, Record<string, string>> = {};
    const destination_map: Record<string, Record<string, string>> = {};
    for (const row of locationRows) {
      for (const [producer, zone] of Object.entries(row.producerZone ?? {})) {
        (location_map[producer] ??= {})[row.name] = zone as string;
      }
      for (const [producer, tier] of Object.entries(row.producerZoneTier ?? {})) {
        (location_tier[producer] ??= {})[row.name] = tier as string;
      }
      for (const [producer, dest] of Object.entries(row.freightDestination ?? {})) {
        (destination_map[producer] ??= {})[row.name] = dest as string;
      }
    }

    // Only the newest freight round per producer; freight and price circulars
    // move on separate calendars (Jun 2026 freight against Aug 2026 prices).
    const books: Dataset["freight"]["books"] = {};
    const seen = new Set<string>();
    for (const row of freightRows) {
      const stamp = `${row.producer}|${row.effectiveDate.toISOString()}`;
      const already = [...seen].some((s) => s.startsWith(`${row.producer}|`));
      if (already && !seen.has(stamp)) continue;
      seen.add(stamp);
      (books[row.producer] ??= []).push({
        destination: row.destination,
        rate_per_mt: row.ratePerMt,
        insurance_per_mt: row.insurancePerMt,
      });
    }

    // GAIL's own round is the headline date a GAIL officer cares about;
    // any producer's round is a reasonable fallback if GAIL somehow has none.
    const headlineRound = producerRounds.get("GAIL") ?? [...producerRounds.values()][0];

    const dataset: Dataset = {
      priceIndex: {
        effective_date: headlineRound.toISOString().slice(0, 10),
        producers,
        location_map: location_map as any,
        location_tier: location_tier as any,
      },
      freight: {
        effective_date:
          freightRows[0]?.effectiveDate.toISOString().slice(0, 10) ?? "",
        books,
        destination_map,
      },
      discounts: {
        // discountRows is sorted newest-first and no longer filtered to one
        // shared round (see resolveProducerRounds) — keep only each
        // producer's most recent entry, same "newest per producer" shape freight already uses.
        producers: Object.fromEntries(
          dedupeNewestPerProducer(discountRows).map((d) => [
            d.producer,
            {
              cash_discount: d.cashDiscount ?? null,
              cash_discount_ldpe: d.cashDiscountLdpe,
              cash_discount_source: d.cashDiscountSource,
              cash_discount_note: d.cashDiscountNote,
              early_payment_per_day: d.earlyPaymentPerDay ?? null,
              early_payment_max_days: d.earlyPaymentMaxDays,
              interest_free_credit_days: d.interestFreeCreditDays ?? null,
              dealer_discount: d.dealerDiscount,
              metallocene_qd_cap: d.metalloceneQdCap,
              quantity_slabs: d.quantitySlabs,
              quantity_slabs_status: d.quantitySlabsStatus,
            },
          ]),
        ) as any,
      },
      crossref: {
        index: Object.fromEntries(
          mappingRows.map((m) => [
            m.gailGrade,
            {
              gail_grade: m.gailGrade,
              polymer: m.polymer ?? "",
              section: m.section ?? "",
              application: m.application ?? "",
              characteristic: m.characteristic ?? "",
              equivalents: m.equivalents ?? {},
              confidence: m.confidence ?? "",
              status: m.status ?? "active",
            },
          ]),
        ),
      },
    };

    this.cache.set(key, dataset);
    this.logger.log(
      `loaded round ${dataset.priceIndex.effective_date}: ` +
        `${priceRows.length.toLocaleString("en-IN")} prices, ` +
        `${freightRows.length.toLocaleString("en-IN")} freight rows ` +
        `in ${Date.now() - started}ms`,
    );
    return asOf ? dataset : this.applyLiveOverlay(dataset);
  }

  /**
   * Everything that can change without a new circular: approved price and
   * discount corrections, and which producers are currently active. Applied
   * only to the live ("now") view — the cached round itself is never mutated,
   * so a historical `asOf` query still reads exactly what was published, and
   * this re-queries the (small) master-data collections on every live call
   * rather than trying to cache the two views separately.
   */
  private async applyLiveOverlay(dataset: Dataset): Promise<Dataset> {
    const [appliedPrices, liveDiscountTerms, inactiveProducers] = await Promise.all([
      this.corrections.find({ status: "applied" }).lean(),
      this.discountTerms.find().lean(),
      this.producerDocs.find({ active: false }).distinct("code"),
    ]);

    let result = dataset;

    if (inactiveProducers.length) {
      const producers = { ...result.priceIndex.producers };
      for (const code of inactiveProducers) delete (producers as any)[code];
      result = { ...result, priceIndex: { ...result.priceIndex, producers } };
    }

    if (!appliedPrices.length && !liveDiscountTerms.length) return result;

    const gail = result.priceIndex.producers.GAIL;
    if (appliedPrices.length && gail) {
      const zones = { ...gail.zones };
      for (const c of appliedPrices) {
        zones[c.zone] = { ...zones[c.zone], [c.grade]: c.proposedPrice };
      }
      result = {
        ...result,
        priceIndex: {
          ...result.priceIndex,
          producers: { ...result.priceIndex.producers, GAIL: { ...gail, zones } },
        },
      };
    }

    if (liveDiscountTerms.length) {
      const producers = { ...result.discounts.producers };
      for (const t of liveDiscountTerms) {
        const producer = t.producer as Producer;
        producers[producer] = { ...producers[producer], ...mapDiscountFields(t) };
      }
      result = { ...result, discounts: { producers } };
    }

    return result;
  }

  /**
   * Call after publishing anything that changes what a live (non-`asOf`) load
   * returns. No targeted single-key variant: the cache key is now a composite
   * of every producer's own round, so "just this producer's entry" isn't a
   * single key to begin with — every caller already just wants a full reload.
   */
  invalidate(): void {
    this.cache.clear();
  }

  supplyPoints(): Map<string, string> {
    return new Map();
  }
}
