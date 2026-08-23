import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { FilterQuery, Model, Types } from "mongoose";

import { Notification, NotificationType } from "../../database/schemas/notification.schema";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private notifications: Model<Notification>,
  ) {}

  async notify(
    recipientId: string,
    type: NotificationType,
    title: string,
    body: string,
    entity?: { type: string; id: string },
  ) {
    return this.notifications.create({
      recipient: new Types.ObjectId(recipientId),
      type,
      title,
      body,
      entityType: entity?.type,
      entityId: entity ? new Types.ObjectId(entity.id) : undefined,
    });
  }

  async list(
    userId: string,
    opts: { unreadOnly?: boolean; type?: NotificationType; q?: string; page?: number; limit?: number } = {},
  ) {
    const recipient = new Types.ObjectId(userId);
    const filter: FilterQuery<Notification> = { recipient };
    if (opts.unreadOnly) filter.read = false;
    if (opts.type) filter.type = opts.type;
    if (opts.q) {
      const rx = new RegExp(escapeRegex(opts.q), "i");
      filter.$or = [{ title: rx }, { body: rx }];
    }

    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 20;

    const [items, total] = await Promise.all([
      this.notifications
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.notifications.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }

  async unreadCount(userId: string) {
    return this.notifications.countDocuments({
      recipient: new Types.ObjectId(userId),
      read: false,
    });
  }

  async markRead(id: string, userId: string) {
    const note = await this.notifications.findById(id);
    if (!note) throw new NotFoundException("No such notification.");
    if (String(note.recipient) !== userId) {
      throw new ForbiddenException("This notification belongs to a different account.");
    }
    if (!note.read) {
      note.read = true;
      note.readAt = new Date();
      await note.save();
    }
    return note;
  }

  async markAllRead(userId: string) {
    await this.notifications.updateMany(
      { recipient: new Types.ObjectId(userId), read: false },
      { read: true, readAt: new Date() },
    );
    return { acknowledged: true };
  }
}
