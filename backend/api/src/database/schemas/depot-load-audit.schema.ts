import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

/**
 * A record of exactly which works-zone fields `load-depot.ts` filled in for a
 * round, so `rollback-depot.ts` can undo precisely those fills — and never one
 * an admin corrected afterwards — instead of guessing from the data file alone.
 *
 * Written only by `load-depot.ts`; read and trimmed only by `rollback-depot.ts`.
 * The running API and `DatasetService` never read this collection — it exists
 * purely so a rollback can be exact.
 */
@Schema({ collection: "depotLoadAudits", timestamps: true })
export class DepotLoadAudit extends Document {
  /** The round (circular effective date) this fill list belongs to. */
  @Prop({ required: true, index: true }) effectiveDate!: Date;

  @Prop({
    type: [{ producer: String, location: String, zone: String, tier: String }],
    default: [],
  })
  worksZoneFills!: { producer: string; location: string; zone: string; tier?: string }[];
}

export const DepotLoadAuditSchema = SchemaFactory.createForClass(DepotLoadAudit);
