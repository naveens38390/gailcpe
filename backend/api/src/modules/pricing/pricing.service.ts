import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { compare, equivalentOptions, type GradeOption } from "../../core/pricing";
import type { Comparison, PaymentMode, PricingBasis, Producer } from "../../core/types";
import { DatasetService } from "../dataset/dataset.service";
import { ComparisonHistory } from "../../database/schemas/activity.schema";

/**
 * Price Comparison.
 *
 * The netback ladder itself lives in `core/pricing.ts` and is shared with the
 * Deal Simulator, so a recommendation can never disagree with the comparison
 * shown above it.
 */
@Injectable()
export class PricingService {
  constructor(
    private dataset: DatasetService,
    @InjectModel(ComparisonHistory.name)
    private history: Model<ComparisonHistory>,
  ) {}

  async compare(
    grade: string,
    location: string,
    quantityMt: number,
    paymentMode: PaymentMode,
    options: {
      asOf?: Date;
      userId?: string;
      gradeOverrides?: Partial<Record<Producer, string>>;
      basisOverrides?: Partial<Record<Producer, PricingBasis>>;
      defaultBasis?: PricingBasis;
    } = {},
  ): Promise<Comparison & { effectiveDate: string; freightDate: string }> {
    const data = await this.dataset.load(options.asOf);
    const result = compare(
      data,
      grade,
      location,
      quantityMt,
      paymentMode,
      options.gradeOverrides,
      options.basisOverrides,
      options.defaultBasis,
    );

    // Stored with the result embedded: re-running this next month would give a
    // different answer, and the record exists to show what the officer was told.
    await this.history.create({
      user: options.userId,
      grade,
      location,
      quantityMt,
      paymentMode,
      pricingBasis: options.defaultBasis ?? "ex_works",
      basisOverrides:
        options.basisOverrides && Object.keys(options.basisOverrides).length
          ? options.basisOverrides
          : undefined,
      effectiveDate: new Date(data.priceIndex.effective_date),
      result: result as unknown as Record<string, unknown>,
    });

    return {
      ...result,
      effectiveDate: data.priceIndex.effective_date,
      freightDate: data.freight.effective_date,
    };
  }

  /**
   * Every competitor code an officer could substitute in for this grade at
   * this location, priced where available — what fills the grade dropdown on
   * each producer's card in Compare.
   */
  async gradeOptions(
    grade: string,
    location: string,
  ): Promise<Partial<Record<Producer, GradeOption[]>>> {
    const data = await this.dataset.load();
    return equivalentOptions(data, grade, location);
  }

  /**
   * @param pricingBasis Restrict to comparisons whose GLOBAL basis was this one.
   *   A record with a per-card override still matches on its own global basis,
   *   the same field Compare sends as `pricingBasis` — it does not search inside
   *   `basisOverrides` or the embedded quotes. A record saved before this field
   *   existed has none and is excluded by an explicit filter, matching "history
   *   predates ex-depot" rather than silently counting as ex_works.
   */
  async recent(userId?: string, limit = 20, pricingBasis?: PricingBasis) {
    return this.history
      .find({
        ...(userId ? { user: userId } : {}),
        ...(pricingBasis ? { pricingBasis } : {}),
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * GAIL's full live price book, flattened to one row per zone/grade — what
   * the Price Book grid browses. Nothing else in the API returns the raw
   * 16,589-row matrix; every other endpoint answers one comparison at a time.
   */
  async gailBook(): Promise<Array<{ zone: string; grade: string; price: number }>> {
    const data = await this.dataset.load();
    const gail = data.priceIndex.producers.GAIL;
    if (!gail) return [];
    const rows: Array<{ zone: string; grade: string; price: number }> = [];
    for (const [zone, grades] of Object.entries(gail.zones)) {
      for (const [grade, price] of Object.entries(grades)) {
        rows.push({ zone, grade, price });
      }
    }
    return rows;
  }
}
