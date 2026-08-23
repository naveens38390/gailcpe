import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { compare } from "../../core/pricing";
import type { Comparison, PaymentMode } from "../../core/types";
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
    options: { asOf?: Date; userId?: string } = {},
  ): Promise<Comparison & { effectiveDate: string; freightDate: string }> {
    const data = await this.dataset.load(options.asOf);
    const result = compare(data, grade, location, quantityMt, paymentMode);

    // Stored with the result embedded: re-running this next month would give a
    // different answer, and the record exists to show what the officer was told.
    await this.history.create({
      user: options.userId,
      grade,
      location,
      quantityMt,
      paymentMode,
      effectiveDate: new Date(data.priceIndex.effective_date),
      result: result as unknown as Record<string, unknown>,
    });

    return {
      ...result,
      effectiveDate: data.priceIndex.effective_date,
      freightDate: data.freight.effective_date,
    };
  }

  async recent(userId?: string, limit = 20) {
    return this.history
      .find(userId ? { user: userId } : {})
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
