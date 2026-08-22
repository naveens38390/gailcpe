import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { simulate } from "../../core/deal";
import type { DealSimulation, PaymentMode } from "../../core/types";
import { DatasetService } from "../dataset/dataset.service";
import { DealSimulationDoc } from "../../database/schemas/activity.schema";

/**
 * Deal Simulator.
 *
 * Persists every simulation, and lets an officer record what actually happened.
 * That outcome is the only feedback the pricing team gets on whether a
 * correction they granted won the order — without it, the system can tell them
 * the gap but never whether closing it worked.
 */
@Injectable()
export class DealsService {
  constructor(
    private dataset: DatasetService,
    @InjectModel(DealSimulationDoc.name)
    private simulations: Model<DealSimulationDoc>,
  ) {}

  async simulate(
    input: {
      customer?: string;
      grade: string;
      location: string;
      quantityMt: number;
      paymentMode: PaymentMode;
      asOf?: Date;
    },
    userId?: string,
  ): Promise<DealSimulation & { id: string; effectiveDate: string }> {
    const data = await this.dataset.load(input.asOf);
    const result = simulate(
      data,
      input.grade,
      input.location,
      input.quantityMt,
      input.paymentMode,
      input.customer ?? null,
    );

    const saved = await this.simulations.create({
      user: userId,
      customer: input.customer,
      grade: input.grade,
      location: input.location,
      quantityMt: input.quantityMt,
      paymentMode: input.paymentMode,
      effectiveDate: new Date(data.priceIndex.effective_date),
      result: result as unknown as Record<string, unknown>,
      outcome: "pending",
    });

    return {
      ...result,
      id: String(saved._id),
      effectiveDate: data.priceIndex.effective_date,
    };
  }

  async recordOutcome(
    id: string,
    outcome: "won" | "lost",
    correctionRequestedPerMt?: number,
  ) {
    const updated = await this.simulations.findByIdAndUpdate(
      id,
      { outcome, correctionRequestedPerMt },
      { new: true },
    );
    if (!updated) throw new NotFoundException("No such simulation.");
    return updated;
  }

  async recent(userId?: string, limit = 20) {
    return this.simulations
      .find(userId ? { user: userId } : {})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}
