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
  "changes_requested",
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CORRECTION_EVENT_TYPES = [
  "proposed",
  "approved",
  "rejected",
  "changes_requested",
] as const;
export type CorrectionEventType = (typeof CORRECTION_EVENT_TYPES)[number];

/** One entry in a correction's timeline. Embedded, not a collection of its own:
 * it is always read together with the correction, never independently. */
@Schema({ _id: false })
export class CorrectionEvent {
  @Prop({ type: String, required: true })
  type!: CorrectionEventType;

  @Prop({ type: Types.ObjectId, ref: "User", required: true })
  by!: Types.ObjectId;

  @Prop({ required: true, default: Date.now })
  at!: Date;

  @Prop() note?: string;
}

export const CorrectionEventSchema = SchemaFactory.createForClass(CorrectionEvent);

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

  /** The full timeline: proposed, then whatever decisions followed. */
  @Prop({ type: [CorrectionEventSchema], default: [] })
  events!: CorrectionEvent[];
}

export type PriceCorrectionDocument = HydratedDocument<PriceCorrection>;
export const PriceCorrectionSchema = SchemaFactory.createForClass(PriceCorrection);

PriceCorrectionSchema.index({ status: 1, createdAt: -1 });
