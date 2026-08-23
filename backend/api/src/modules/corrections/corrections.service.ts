import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";

import { quote } from "../../core/pricing";
import { PriceCorrection } from "../../database/schemas/correction.schema";
import { DatasetService } from "../dataset/dataset.service";
import { requiresSeparateApprover } from "../../core/approval-policy";

/**
 * Price Corrections — how GAIL's own price actually gets fixed.
 *
 * Everything else in this API answers "how does GAIL compare". This is the one
 * write path into GAIL's own numbers, and it exists because a comparison that
 * only ever reports a gap and never lets anyone close it is not a tool a
 * pricing team can work with day to day.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private dataset: DatasetService,
    @InjectModel(PriceCorrection.name) private corrections: Model<PriceCorrection>,
  ) {}

  /**
   * Snapshot the live GAIL price at this grade/location through the same
   * resolver a comparison uses, so a correction can never target a zone or
   * grade the officer could not actually see on screen.
   */
  async propose(
    input: { grade: string; location: string; proposedPrice: number; reason: string },
    userId: string,
  ) {
    const data = await this.dataset.load();
    const current = quote(data, "GAIL", input.grade, input.location, 1, "cash");
    if (!current.zone || !current.grade || current.basic === null) {
      throw new BadRequestException(
        `GAIL has no live price for ${input.grade} at ${input.location} to correct.`,
      );
    }

    return this.corrections.create({
      producer: "GAIL",
      zone: current.zone,
      grade: current.grade,
      currentPrice: current.basic,
      proposedPrice: input.proposedPrice,
      reason: input.reason,
      proposedBy: userId,
      status: "pending",
    });
  }

  async list(status?: string) {
    return this.corrections
      .find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .populate("proposedBy", "name email role")
      .populate("decidedBy", "name email role")
      .lean();
  }

  /**
   * Approve or reject. A correction is a commercial decision, so the person who
   * asked for it cannot be the one who grants it — enforced here, not just by
   * which roles happen to see the button.
   */
  async decide(id: string, userId: string, approve: boolean, note?: string) {
    const correction = await this.corrections.findById(id);
    if (!correction) throw new NotFoundException("No such correction.");
    if (correction.status !== "pending") {
      throw new BadRequestException(`This correction is already ${correction.status}.`);
    }
    if (requiresSeparateApprover() && String(correction.proposedBy) === userId) {
      throw new ForbiddenException("You cannot decide on your own proposal.");
    }

    correction.status = approve ? "applied" : "rejected";
    correction.decidedBy = new Types.ObjectId(userId);
    correction.decidedAt = new Date();
    correction.decisionNote = note;
    await correction.save();
    return correction;
  }
}
