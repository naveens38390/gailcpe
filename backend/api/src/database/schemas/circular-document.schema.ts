/**
 * The bytes of an uploaded circular.
 *
 * Kept out of PriceCircular itself so a list query never drags several
 * megabytes of PDF along with it — the metadata is read constantly, the
 * document only when someone opens it.
 *
 * This lives in MongoDB rather than on a disk because the deployment has no
 * persistent volume: a hosted instance without one restarts with an empty
 * filesystem, which would leave every circular record pointing at a file that
 * no longer exists. Atlas is already provisioned and already backed up, and a
 * round is around fourteen documents of a few megabytes.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

@Schema({ collection: "circularDocuments", timestamps: true })
export class CircularDocument {
  /** The opaque key a circular record stores, unique across the store. */
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  /** What the uploader called it — display only, never used as a path. */
  @Prop() filename?: string;

  /** "PDF", "Excel workbook", "extract" — what the signature check decided. */
  @Prop({ required: true })
  label!: string;

  @Prop({ required: true })
  bytes!: number;

  @Prop({ type: Buffer, required: true })
  data!: Buffer;
}

export type CircularDocumentDocument = HydratedDocument<CircularDocument>;
export const CircularDocumentSchema = SchemaFactory.createForClass(CircularDocument);
