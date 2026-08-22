/**
 * The one revision shape shared by every master-data module. Registered once
 * here, then bound to a different Mongo collection per entity type (see each
 * module's own `*.module.ts`) — one schema, many collections, so the
 * draft/review/approve/publish/rollback logic in revision-workflow.ts never
 * has to know which kind of entity it is working on.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import type { RevisionStatus } from "../../modules/master-data/revision-workflow";

@Schema({ timestamps: true })
export class Revision {
  /** The live record's natural key — a producer code, a location name, etc. */
  @Prop({ required: true, index: true })
  entityId!: string;

  /**
   * True if this revision creates a new entity rather than editing one.
   * Named `createsNew`, not `isNew` — Mongoose reserves `isNew` on every
   * document for its own insert-vs-update bookkeeping, and shadowing it here
   * silently confuses `save()`.
   */
  @Prop({ required: true, default: false })
  createsNew!: boolean;

  /** The proposed field values — only what changed, for an edit. */
  @Prop({ type: Object, required: true })
  fields!: Record<string, unknown>;

  /** Snapshot of the live record at proposal time, for diffing. Null if new. */
  @Prop({ type: Object, default: null })
  baseline!: Record<string, unknown> | null;

  /** 1, 2, 3, ... per entity — sorts version history naturally. */
  @Prop({ required: true, index: true })
  version!: number;

  @Prop({ type: String, required: true, default: "draft", index: true })
  status!: RevisionStatus;

  @Prop({ required: true })
  reason!: string;

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
}

export type RevisionDocument = HydratedDocument<Revision>;
export const RevisionSchema = SchemaFactory.createForClass(Revision);

RevisionSchema.index({ entityId: 1, version: -1 });
RevisionSchema.index({ status: 1, createdAt: -1 });
