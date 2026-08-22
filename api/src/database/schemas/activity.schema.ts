/**
 * People, and what they did.
 *
 * Comparisons and simulations are stored with the *result* embedded, not just
 * the inputs. Re-running a March quote against today's circular would produce a
 * different number, and the point of the record is to show what the officer was
 * told at the time.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export const ROLES = [
  "sales_officer",
  "territory_manager",
  "regional_manager",
  "corporate_pricing",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

@Schema({ collection: "roles", timestamps: true })
export class RoleDoc {
  @Prop({ type: String, required: true, unique: true, index: true })
  key!: Role;

  @Prop({ required: true })
  label!: string;

  /**
   * Coarse capabilities. Price corrections are a commercial decision, so
   * proposing one and approving one are deliberately separate permissions.
   */
  @Prop({ type: [String], default: [] })
  permissions!: string[];
}

@Schema({ collection: "users", timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  name!: string;

  /** bcrypt hash. Never the password. */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, required: true, index: true })
  role!: Role;

  /** Locations this officer covers; empty means national. */
  @Prop({ type: [String], default: [] })
  territories!: string[];

  @Prop({ default: true })
  active!: boolean;

  @Prop() lastLoginAt?: Date;
}

@Schema({ collection: "comparisonHistory", timestamps: true })
export class ComparisonHistory {
  @Prop({ type: Types.ObjectId, ref: "User", index: true })
  user?: Types.ObjectId;

  @Prop({ required: true, index: true }) grade!: string;
  @Prop({ required: true, index: true }) location!: string;
  @Prop({ required: true }) quantityMt!: number;
  @Prop({ required: true }) paymentMode!: string;

  /** The circular round the answer came from. */
  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  /** The full Comparison as served, so the record survives a re-price. */
  @Prop({ type: Object, required: true })
  result!: Record<string, unknown>;
}

@Schema({ collection: "dealSimulations", timestamps: true })
export class DealSimulationDoc {
  @Prop({ type: Types.ObjectId, ref: "User", index: true })
  user?: Types.ObjectId;

  @Prop({ index: true }) customer?: string;
  @Prop({ required: true, index: true }) grade!: string;
  @Prop({ required: true, index: true }) location!: string;
  @Prop({ required: true }) quantityMt!: number;
  @Prop({ required: true }) paymentMode!: string;

  @Prop({ required: true, index: true })
  effectiveDate!: Date;

  @Prop({ type: Object, required: true })
  result!: Record<string, unknown>;

  /** Set if the officer acted on it — the feedback loop into pricing. */
  @Prop() correctionRequestedPerMt?: number;
  @Prop({ type: String, index: true }) outcome?: "won" | "lost" | "pending";
}

@Schema({ collection: "auditLogs", timestamps: true })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: "User", index: true })
  user?: Types.ObjectId;

  @Prop({ required: true, index: true })
  action!: string; // login, comparison.run, deal.simulate, circular.publish

  @Prop({ index: true })
  entity?: string;

  @Prop({ type: Object, default: {} })
  detail!: Record<string, unknown>;

  @Prop() ip?: string;
}

export type UserDocument = HydratedDocument<User>;
export type RoleDocument = HydratedDocument<RoleDoc>;
export type ComparisonHistoryDocument = HydratedDocument<ComparisonHistory>;
export type DealSimulationDocument = HydratedDocument<DealSimulationDoc>;
export type AuditLogDocument = HydratedDocument<AuditLog>;

export const UserSchema = SchemaFactory.createForClass(User);
export const RoleSchema = SchemaFactory.createForClass(RoleDoc);
export const ComparisonHistorySchema = SchemaFactory.createForClass(ComparisonHistory);
export const DealSimulationSchema = SchemaFactory.createForClass(DealSimulationDoc);
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

ComparisonHistorySchema.index({ createdAt: -1 });
DealSimulationSchema.index({ createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });
