/**
 * Price and freight circulars, and the entries they carry.
 *
 * Circulars are append-only. A new one never edits its predecessor, because a
 * quote given last month has to stay defensible: `asOf` queries resolve to the
 * circular that was live on that date.
 *
 * Entries are split out of the circular document rather than nested. One price
 * circular holds ~21,500 entries for RIL alone, well past what belongs in a
 * single document — and the read pattern is always "this grade at this zone",
 * never "the whole circular".
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { PriceBasis } from "./catalog.schema";

export type CircularKind = "price" | "freight";
export type CircularStatus = "draft" | "active" | "superseded";

@Schema({ collection: "priceCirculars", timestamps: true })
export class PriceCircular {
  @Prop({ required: true, index: true })
  producer!: string;

  /** The producer's own reference, e.g. PE/2026-27/016. */
  @Prop({ required: true })
  reference!: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  @Prop({ type: String, required: true, default: "active", index: true })
  status!: CircularStatus;

  @Prop({ type: String, required: true })
  basis!: PriceBasis;

  /**
   * Where the source document is stored, relative to the circular store. The
   * file itself never goes in MongoDB. Written as an S3 key originally; the
   * store is a mounted disk today, and the key is opaque either way so moving
   * to object storage later does not change this field's meaning.
   */
  @Prop() sourceKey?: string;
  /** What the uploader called it, kept for display only — never used as a path. */
  @Prop() sourceFilename?: string;

  /** Who put this document into the system, and when it arrived. */
  @Prop({ type: Types.ObjectId, ref: "User" })
  uploadedBy?: Types.ObjectId;
  @Prop() uploadedAt?: Date;

  /**
   * The extracted reading of this circular, kept beside the source it came
   * from. Two files, one business event: asked why a price moved on a given
   * day, someone can open both the circular as published and the numbers that
   * were read out of it.
   */
  @Prop() extractKey?: string;
  @Prop() extractFilename?: string;
  @Prop() extractedAt?: Date;

  /** The draft this circular's extract generated, once one exists. */
  @Prop({ type: Types.ObjectId })
  draft?: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  stats!: Record<string, number>;
}

@Schema({ collection: "priceEntries" })
export class PriceEntry {
  @Prop({ type: Types.ObjectId, ref: "PriceCircular", required: true, index: true })
  circular!: Types.ObjectId;

  @Prop({ required: true, index: true })
  producer!: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  /** The producer's own zone or location name, not GAIL's. */
  @Prop({ required: true, index: true })
  zone!: string;

  @Prop({ required: true, index: true })
  grade!: string;

  @Prop({ required: true })
  price!: number;

  @Prop({ type: String, required: true })
  basis!: PriceBasis;

  /**
   * Which plant this price is supplied from, where the producer publishes more
   * than one. RIL delivers B56003 into Mumbai at 140,636 ex-Hazira and 140,629
   * ex-Dahej; the cheaper is what a customer can actually get.
   */
  @Prop() supplyPoint?: string;
}

@Schema({ collection: "freightCirculars", timestamps: true })
export class FreightCircular {
  @Prop({ required: true, index: true })
  producer!: string;

  @Prop() reference?: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  @Prop({ type: String, required: true, default: "active", index: true })
  status!: CircularStatus;

  /** See PriceCircular.sourceKey — same store, same meaning. */
  @Prop() sourceKey?: string;
  @Prop() sourceFilename?: string;

  @Prop({ type: Types.ObjectId, ref: "User" })
  uploadedBy?: Types.ObjectId;
  @Prop() uploadedAt?: Date;

  @Prop({ type: Object, default: {} })
  stats!: Record<string, number>;
}

@Schema({ collection: "freightEntries" })
export class FreightEntry {
  @Prop({ type: Types.ObjectId, ref: "FreightCircular", required: true, index: true })
  circular!: Types.ObjectId;

  @Prop({ required: true, index: true })
  producer!: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  @Prop({ required: true, index: true })
  destination!: string;

  @Prop({ required: true })
  ratePerMt!: number;

  /**
   * OPaL bills a separate per-MT insurance line. It is kept out of the headline
   * landed cost — the zonal workbook usually omits it — but stored so it can be
   * added when the customer bears it.
   */
  @Prop({ default: 0 })
  insurancePerMt!: number;

  @Prop() state?: string;
  @Prop() district?: string;
  @Prop() cluster?: string;
  @Prop() distanceKm?: number;
  @Prop() transitDays?: number;
}

/** Cash/quantity/early-payment terms, versioned with the price round. */
@Schema({ collection: "discountSchemes", timestamps: true })
export class DiscountScheme {
  @Prop({ required: true, index: true })
  producer!: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  @Prop() cashDiscount?: number;
  @Prop() cashDiscountLdpe?: number;
  @Prop() cashDiscountSource?: string;
  @Prop() cashDiscountNote?: string;
  @Prop() earlyPaymentPerDay?: number;
  @Prop() earlyPaymentMaxDays?: number;
  @Prop() interestFreeCreditDays?: number;
  @Prop() dealerDiscount?: number;
  @Prop() metalloceneQdCap?: number;

  @Prop({ type: [Object], default: null })
  quantitySlabs!: Array<{ from_mt: number; to_mt: number | null; rate_per_mt: number }> | null;

  /**
   * Set when the slabs are genuinely unknown rather than zero. GAIL's own
   * quantity scheme is not in the supplied circulars, and an engine that
   * silently assumed parity would understate every competitor's effective net.
   */
  @Prop() quantitySlabsStatus?: string;
}

export type PriceCircularDocument = HydratedDocument<PriceCircular>;
export type PriceEntryDocument = HydratedDocument<PriceEntry>;
export type FreightCircularDocument = HydratedDocument<FreightCircular>;
export type FreightEntryDocument = HydratedDocument<FreightEntry>;
export type DiscountSchemeDocument = HydratedDocument<DiscountScheme>;

export const PriceCircularSchema = SchemaFactory.createForClass(PriceCircular);
export const PriceEntrySchema = SchemaFactory.createForClass(PriceEntry);
export const FreightCircularSchema = SchemaFactory.createForClass(FreightCircular);
export const FreightEntrySchema = SchemaFactory.createForClass(FreightEntry);
export const DiscountSchemeSchema = SchemaFactory.createForClass(DiscountScheme);

PriceCircularSchema.index({ producer: 1, effectiveDate: -1 });
FreightCircularSchema.index({ producer: 1, effectiveDate: -1 });
DiscountSchemeSchema.index({ producer: 1, effectiveDate: -1 }, { unique: true });
// The engine's hot path: one grade, one zone, one round.
PriceEntrySchema.index({ producer: 1, effectiveDate: -1, zone: 1, grade: 1 });
FreightEntrySchema.index({ producer: 1, effectiveDate: -1, destination: 1 });
