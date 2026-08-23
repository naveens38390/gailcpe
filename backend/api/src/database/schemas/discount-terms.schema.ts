/**
 * GAIL's own live discount terms — the master-data entity, not the
 * historical per-round DiscountScheme (circular.schema.ts). That collection
 * stays exactly what it was: one immutable row per producer per circular
 * round, read for `asOf` defensibility. This collection holds the current,
 * editable override — Draft -> Review -> Approved -> Published, through the
 * same RevisionWorkflow as Producers, Locations and Grades — and
 * DatasetService overlays it onto the live round only, never a historical one.
 *
 * Kept as explicit, named fields rather than a JSON blob for the same reason
 * Producer and Location are: every field here is something a reviewer reads
 * and a reason references, not an opaque payload.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export interface QuantitySlab {
  from_mt: number;
  to_mt: number | null;
  rate_per_mt: number;
}

@Schema({ collection: "discountTerms", timestamps: true })
export class DiscountTerms {
  /** Always "GAIL" today — the entity id, same role as Producer.code. */
  @Prop({ required: true, unique: true, index: true })
  producer!: string;

  @Prop() cashDiscount?: number;
  @Prop() cashDiscountLdpe?: number;
  @Prop() earlyPaymentPerDay?: number;
  @Prop() earlyPaymentMaxDays?: number;
  @Prop() interestFreeCreditDays?: number;
  @Prop() dealerDiscount?: number;
  @Prop() metalloceneQdCap?: number;

  @Prop({ type: [Object], default: null })
  quantitySlabs?: QuantitySlab[] | null;

  /** When the currently-published terms took effect — set at publish time. */
  @Prop() effectiveFrom?: Date;

  /** Which published revision this row reflects — see the shared Revision schema. */
  @Prop({ type: Types.ObjectId })
  currentRevision?: Types.ObjectId;

  @Prop({ default: 0 })
  currentVersion!: number;
}

export type DiscountTermsDocument = HydratedDocument<DiscountTerms>;
export const DiscountTermsSchema = SchemaFactory.createForClass(DiscountTerms);
