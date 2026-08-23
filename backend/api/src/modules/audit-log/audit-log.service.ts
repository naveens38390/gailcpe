import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { FilterQuery, Model, Types } from "mongoose";

import { AuditLog } from "../../database/schemas/activity.schema";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The one place every write path in the app records "who did what". Kept
 * deliberately failure-safe: an audit-log write must never be the reason a
 * real write fails, so `log()` swallows its own errors.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@InjectModel(AuditLog.name) private logs: Model<AuditLog>) {}

  async log(
    userId: string | undefined,
    action: string,
    entity: string,
    entityId: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.logs.create({
        user: userId ? new Types.ObjectId(userId) : undefined,
        action,
        entity,
        detail: { entityId, ...detail },
      });
    } catch (e) {
      this.logger.warn(`Audit log write failed for ${action}: ${e instanceof Error ? e.message : e}`);
    }
  }

  async list(params: {
    from?: string;
    to?: string;
    user?: string;
    action?: string;
    entity?: string;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const filter: FilterQuery<AuditLog> = {};
    if (params.from || params.to) {
      const createdAt: Record<string, Date> = {};
      if (params.from) createdAt.$gte = new Date(params.from);
      if (params.to) createdAt.$lte = new Date(params.to);
      filter.createdAt = createdAt;
    }
    // Same Mixed-type gotcha Phase 1 found on Notification.recipient — cast explicitly.
    if (params.user) filter.user = new Types.ObjectId(params.user);
    if (params.action) filter.action = params.action;
    if (params.entity) filter.entity = params.entity;
    if (params.q) {
      const rx = new RegExp(escapeRegex(params.q), "i");
      filter.$or = [{ action: rx }, { entity: rx }];
    }

    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 25;

    const [items, total] = await Promise.all([
      this.logs
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "name email role")
        .lean(),
      this.logs.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }
}
