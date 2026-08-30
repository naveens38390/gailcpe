/**
 * The editable, in-progress freight circular.
 *
 * Deliberately a sibling of PriceCircularDraft rather than a reuse of it. The
 * lifecycle is identical — draft -> review -> approved -> published, audit
 * fields, history never mutated — but the row is a different thing: a price
 * row is keyed on zone *and* grade, a freight row on destination alone, and
 * it carries a separate insurance line that OPaL bills and nobody else does.
 * Folding both into one collection would mean half the fields being null on
 * every document and a compound index that fits neither.
 *
 * The other real difference is *destinations*. A price circular's grades are
 * drawn from a governed grade master; a freight circular's destinations are
 * whatever the producer's own spreadsheet calls them, and a new circular can
 * introduce a town the system has never mapped. An unmapped destination is
 * not a failure — it is a genuine new town — but it is invisible to every
 * comparison until someone maps it, so it is recorded per row and has to be
 * acknowledged by a reviewer before the draft can publish.
 *
 * Publishing writes a real FreightCircular + FreightEntry set (circular.schema.ts),
 * the exact collections DatasetService already reads. A published draft is not
 * a parallel source of truth; it becomes the one already in use.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type FreightDraftStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "rejected";

@Schema({ collection: "freightCircularDrafts", timestamps: true })
export class FreightCircularDraft {
  @Prop({ required: true, index: true })
  producer!: string;

  /** The producer's own reference. Freight circulars often carry none, so a
   * placeholder is allowed here where a price circular's is mandatory. */
  @Prop({ required: true })
  circularNumber!: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  @Prop({ type: String, required: true, default: "draft", index: true })
  status!: FreightDraftStatus;

  @Prop({ required: true })
  reason!: string;

  @Prop({ required: true, default: 0 })
  rowCount!: number;

  /** Rows whose rate or insurance differs from the live book. */
  @Prop({ required: true, default: 0 })
  changedRowCount!: number;

  /** Destinations this circular introduces that the live book does not carry. */
  @Prop({ required: true, default: 0 })
  addedRowCount!: number;

  /** Destinations the live book carries that this circular dropped. */
  @Prop({ type: [String], default: [] })
  removedDestinations!: string[];

  /**
   * Destinations no location maps to for this producer. Publishing with these
   * unacknowledged is refused — see FreightCircularsService.publish.
   */
  @Prop({ required: true, default: 0 })
  unmappedCount!: number;

  /** Set when a reviewer approves having been shown the unmapped list. */
  @Prop() unmappedAcknowledgedAt?: Date;

  /**
   * Destinations whose name collapses to the same key as another row in the
   * same book — HMEL prints both "Bilaspur" at 1,320 and "Bilaspur(Ch)" at
   * 4,560, HPL both "KALOL" and "KALOL(MEHSANA)". These matched by key rather
   * than by an exact name, so which live rate they were compared against is a
   * guess. Recorded so a reviewer sees it instead of trusting the diff.
   */
  @Prop({ type: [String], default: [] })
  ambiguousDestinations!: string[];

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

  /** The real FreightCircular this became, once published. */
  @Prop({ type: Types.ObjectId })
  publishedCircular?: Types.ObjectId;
}

@Schema({ collection: "freightCircularDraftRows" })
export class FreightCircularDraftRow {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  draft!: Types.ObjectId;

  @Prop({ required: true, index: true })
  destination!: string;

  @Prop({ required: true })
  ratePerMt!: number;

  /** The rate this row was cloned from. Equal to `ratePerMt` on a new destination. */
  @Prop({ required: true })
  previousRatePerMt!: number;

  @Prop({ required: true, default: 0 })
  insurancePerMt!: number;

  @Prop({ required: true, default: 0 })
  previousInsurancePerMt!: number;

  @Prop({ required: true, default: false, index: true })
  changed!: boolean;

  /** The live book has no such destination for this producer. */
  @Prop({ required: true, default: false, index: true })
  isNew!: boolean;

  /**
   * Whether a GCPE location resolves to this destination for this producer.
   * False means the rate is real but unreachable by any comparison until a
   * location is mapped to it.
   */
  @Prop({ required: true, default: true, index: true })
  mapped!: boolean;

  /** Carried through from the producer's own book, for display only. */
  @Prop() state?: string;
  @Prop() district?: string;
  @Prop() cluster?: string;
  @Prop() distanceKm?: number;
  @Prop() transitDays?: number;
}

export type FreightCircularDraftDocument = HydratedDocument<FreightCircularDraft>;
export type FreightCircularDraftRowDocument = HydratedDocument<FreightCircularDraftRow>;
export const FreightCircularDraftSchema =
  SchemaFactory.createForClass(FreightCircularDraft);
export const FreightCircularDraftRowSchema =
  SchemaFactory.createForClass(FreightCircularDraftRow);

// Not unique: HMEL's own book prints "Hamirpur" and "Shahjahanpur" twice each,
// for two real districts at two real rates. FreightEntry (the live collection
// this publishes into) carries the same two rows with no uniqueness on
// destination either — a draft that refused to represent what the producer
// actually prints would be the one that is wrong. Rows are addressed by _id
// everywhere in this module, never by (draft, destination), so nothing here
// depends on the pair being unique.
FreightCircularDraftRowSchema.index({ draft: 1, destination: 1 });
FreightCircularDraftSchema.index({ producer: 1, status: 1, createdAt: -1 });
