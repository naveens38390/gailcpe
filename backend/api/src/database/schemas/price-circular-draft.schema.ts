/**
 * The editable, in-progress price circular — "many rows, one revision".
 *
 * This is deliberately not built on the single-entity RevisionWorkflow that
 * Producers/Locations/Grades/Discount Terms share: a circular is a header
 * plus up to ~16,589 rows, and cramming that into one revision's `fields`
 * blob would make every draft document balloon toward Mongo's size limits
 * and turn every list query heavy. So the shape here matches what price and
 * freight circulars actually are — one header (PriceCircularDraft) and a
 * separate row collection (PriceCircularDraftRow) — while the *lifecycle*
 * (draft -> review -> approved -> published, audit fields, never mutating
 * history) follows exactly the same principles as the shared engine.
 *
 * Publishing a draft does not invent a new "live" concept: it creates a real
 * PriceCircular + PriceEntry set (circular.schema.ts) — the exact collections
 * DatasetService already reads. A published draft is not a parallel source of
 * truth; it *becomes* the source of truth the pricing engine already trusts.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { PriceBasis } from "./catalog.schema";

export type DraftStatus = "draft" | "review" | "approved" | "published" | "rejected";

@Schema({ collection: "priceCircularDrafts", timestamps: true })
export class PriceCircularDraft {
  @Prop({ required: true, index: true })
  producer!: string;

  @Prop({ required: true })
  circularNumber!: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  @Prop({ type: String, required: true })
  basis!: PriceBasis;

  @Prop({ type: String, required: true, default: "draft", index: true })
  status!: DraftStatus;

  @Prop({ required: true })
  reason!: string;

  @Prop({ required: true, default: 0 })
  rowCount!: number;

  /** How many rows differ from the circular this was cloned from — the "500 rows changed" summary. */
  @Prop({ required: true, default: 0 })
  changedRowCount!: number;

  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop() submittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: "User" })
  reviewedBy?: Types.ObjectId;
  @Prop() reviewedAt?: Date;
  @Prop() reviewNote?: string;

  @Prop({ type: Types.ObjectId, ref: "User" })
  publishedBy?: Types.ObjectId;
  @Prop() publishedAt?: Date;

  /** The real PriceCircular this became, once published. */
  @Prop({ type: Types.ObjectId })
  publishedCircular?: Types.ObjectId;
}

@Schema({ collection: "priceCircularDraftRows" })
export class PriceCircularDraftRow {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  draft!: Types.ObjectId;

  @Prop({ required: true, index: true })
  zone!: string;

  @Prop({ required: true, index: true })
  grade!: string;

  @Prop({ required: true })
  basicPrice!: number;

  /** The price this row was cloned from, for diff display. Same value if untouched. */
  @Prop({ required: true })
  previousPrice!: number;

  @Prop({ required: true, default: false, index: true })
  changed!: boolean;
}

export type PriceCircularDraftDocument = HydratedDocument<PriceCircularDraft>;
export type PriceCircularDraftRowDocument = HydratedDocument<PriceCircularDraftRow>;
export const PriceCircularDraftSchema = SchemaFactory.createForClass(PriceCircularDraft);
export const PriceCircularDraftRowSchema = SchemaFactory.createForClass(PriceCircularDraftRow);

PriceCircularDraftRowSchema.index({ draft: 1, zone: 1, grade: 1 }, { unique: true });
PriceCircularDraftSchema.index({ producer: 1, status: 1, createdAt: -1 });
