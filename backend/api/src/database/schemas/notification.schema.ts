/**
 * One account, one inbox — today that account is the single administrator, but
 * `recipient` is a real field rather than a broadcast so nothing has to change
 * the day a second account exists.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export const NOTIFICATION_TYPES = [
  "correction.proposed",
  "correction.approved",
  "correction.rejected",
  "correction.changes_requested",
  "circular.published",
  /** Type reserved for future use — no event in this codebase triggers it yet
   * (no scheduled jobs, health checks, or threshold alerts exist today). */
  "system.warning",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

@Schema({ collection: "notifications", timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  recipient!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  type!: NotificationType;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  /** What this notification is about, so tapping it can navigate straight there. */
  @Prop() entityType?: string;
  @Prop({ type: Types.ObjectId }) entityId?: Types.ObjectId;

  @Prop({ default: false, index: true })
  read!: boolean;

  @Prop() readAt?: Date;

  createdAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
