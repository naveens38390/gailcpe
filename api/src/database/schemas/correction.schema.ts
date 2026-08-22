/**
 * GAIL's own price corrections — the answer to "how does anyone fix a price
 * once it's wrong?"
 *
 * Circulars are deliberately append-only (see circular.schema.ts): a correction
 * must not rewrite what a PDF actually said, because a quote given last month
 * has to stay defensible against the circular that was live that day. So a
 * correction is layered on top instead — DatasetService overlays "applied"
 * corrections onto the live price index, but only for the un-dated ("now")
 * view. Any `asOf` query for a past date sees the original circular price,
 * uncorrected, exactly as it was published.
 *
 * Proposing and deciding are separate roles on purpose, matching the MZO
 * workbook's own process: the zonal team asks, corporate pricing grants.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export const CORRECTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "applied",
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

@Schema({ collection: "priceCorrections", timestamps: true })
export class PriceCorrection {
  /** Always "GAIL" today — correcting a competitor's own price makes no sense. */
  @Prop({ required: true, default: "GAIL", index: true })
  producer!: string;

  /** GAIL's own zone name, resolved the same way a comparison resolves it. */
  @Prop({ required: true, index: true })
  zone!: string;

  @Prop({ required: true, index: true })
  grade!: string;

  /** The live basic price at proposal time, so an approver sees what is changing. */
  @Prop({ required: true })
  currentPrice!: number;

  @Prop({ required: true })
  proposedPrice!: number;

  @Prop({ required: true })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  proposedBy!: Types.ObjectId;

  @Prop({ type: String, required: true, default: "pending", index: true })
  status!: CorrectionStatus;

  @Prop({ type: Types.ObjectId, ref: "User" })
  decidedBy?: Types.ObjectId;

  @Prop() decidedAt?: Date;
  @Prop() decisionNote?: string;
}

export type PriceCorrectionDocument = HydratedDocument<PriceCorrection>;
export const PriceCorrectionSchema = SchemaFactory.createForClass(PriceCorrection);

PriceCorrectionSchema.index({ status: 1, createdAt: -1 });
