import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";

import { quote } from "../../core/pricing";
import { PriceCorrection } from "../../database/schemas/correction.schema";
import { DatasetService } from "../dataset/dataset.service";
import { requiresSeparateApprover } from "../../core/approval-policy";
import { AuditLogService } from "../audit-log/audit-log.service";
import { NotificationsService } from "../notifications/notifications.service";

/**
 * Price Corrections — how GAIL's own price actually gets fixed.
 *
 * Everything else in this API answers "how does GAIL compare". This is the one
 * write path into GAIL's own numbers, and it exists because a comparison that
 * only ever reports a gap and never lets anyone close it is not a tool a
 * pricing team can work with day to day.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private dataset: DatasetService,
    private notifications: NotificationsService,
    private auditLog: AuditLogService,
    @InjectModel(PriceCorrection.name) private corrections: Model<PriceCorrection>,
  ) {}

  /**
   * Snapshot the live GAIL price at this grade/location through the same
   * resolver a comparison uses, so a correction can never target a zone or
   * grade the officer could not actually see on screen.
   */
  async propose(
    input: { grade: string; location: string; proposedPrice: number; reason: string },
    userId: string,
  ) {
    const data = await this.dataset.load();
    const current = quote(data, "GAIL", input.grade, input.location, 1, "cash");
    if (!current.zone || !current.grade || current.basic === null) {
      throw new BadRequestException(
        `GAIL has no live price for ${input.grade} at ${input.location} to correct.`,
      );
    }

    const created = await this.corrections.create({
      producer: "GAIL",
      zone: current.zone,
      grade: current.grade,
      currentPrice: current.basic,
      proposedPrice: input.proposedPrice,
      reason: input.reason,
      proposedBy: userId,
      status: "pending",
      events: [{ type: "proposed", by: userId, at: new Date() }],
    });

    await this.notifications.notify(
      userId,
      "correction.proposed",
      "New price correction submitted",
      `${created.grade} at ${created.zone}: ${current.basic} → ${input.proposedPrice}`,
      { type: "correction", id: String(created._id) },
    );
    await this.auditLog.log(userId, "correction.propose", "correction", String(created._id), {
      grade: created.grade,
      zone: created.zone,
      previous: current.basic,
      next: input.proposedPrice,
    });

    return created;
  }

  async list(status?: string) {
    return this.corrections
      .find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .populate("proposedBy", "name email role")
      .populate("decidedBy", "name email role")
      .lean();
  }

  /** One correction with its full timeline, for the Approval Details screen. */
  async get(id: string) {
    const correction = await this.corrections
      .findById(id)
      .populate("proposedBy", "name email role")
      .populate("decidedBy", "name email role")
      .populate("events.by", "name email role")
      .lean();
    if (!correction) throw new NotFoundException("No such correction.");
    return correction;
  }

  /** Counts for the Approvals dashboard header. */
  async summary() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [pending, approvedToday, rejected, changesRequested] = await Promise.all([
      this.corrections.countDocuments({ status: "pending" }),
      this.corrections.countDocuments({ status: "applied", decidedAt: { $gte: startOfDay } }),
      this.corrections.countDocuments({ status: "rejected" }),
      this.corrections.countDocuments({ status: "changes_requested" }),
    ]);
    return { pending, approvedToday, rejected, changesRequested };
  }

  /**
   * Approve or reject. A correction is a commercial decision, so the person who
   * asked for it cannot be the one who grants it — enforced here, not just by
   * which roles happen to see the button.
   */
  async decide(id: string, userId: string, approve: boolean, note?: string) {
    const correction = await this.corrections.findById(id);
    if (!correction) throw new NotFoundException("No such correction.");
    if (correction.status !== "pending") {
      throw new BadRequestException(`This correction is already ${correction.status}.`);
    }
    if (requiresSeparateApprover() && String(correction.proposedBy) === userId) {
      throw new ForbiddenException("You cannot decide on your own proposal.");
    }

    correction.status = approve ? "applied" : "rejected";
    correction.decidedBy = new Types.ObjectId(userId);
    correction.decidedAt = new Date();
    correction.decisionNote = note;
    correction.events.push({
      type: approve ? "approved" : "rejected",
      by: new Types.ObjectId(userId),
      at: correction.decidedAt,
      note,
    });
    await correction.save();

    await this.notifications.notify(
      userId,
      approve ? "correction.approved" : "correction.rejected",
      approve ? "Correction approved" : "Correction rejected",
      `${correction.grade} at ${correction.zone}: ${correction.currentPrice} → ${correction.proposedPrice}`,
      { type: "correction", id: String(correction._id) },
    );
    await this.auditLog.log(
      userId,
      approve ? "correction.approve" : "correction.reject",
      "correction",
      String(correction._id),
      { previous: correction.currentPrice, next: correction.proposedPrice, note },
    );

    return correction;
  }

  /**
   * pending -> changes_requested. A third outcome alongside approve/reject: the
   * proposal isn't rejected outright, it needs a specific fix before it can be
   * decided again. Reuses decidedBy/decidedAt/decisionNote — the same "who acted
   * on this pending item" fields decide() already writes — so nothing that reads
   * those fields needs to know a third outcome exists.
   */
  async requestChanges(id: string, userId: string, note: string) {
    const correction = await this.corrections.findById(id);
    if (!correction) throw new NotFoundException("No such correction.");
    if (correction.status !== "pending") {
      throw new BadRequestException(`This correction is already ${correction.status}.`);
    }
    if (requiresSeparateApprover() && String(correction.proposedBy) === userId) {
      throw new ForbiddenException("You cannot decide on your own proposal.");
    }

    correction.status = "changes_requested";
    correction.decidedBy = new Types.ObjectId(userId);
    correction.decidedAt = new Date();
    correction.decisionNote = note;
    correction.events.push({
      type: "changes_requested",
      by: new Types.ObjectId(userId),
      at: correction.decidedAt,
      note,
    });
    await correction.save();

    await this.notifications.notify(
      userId,
      "correction.changes_requested",
      "Changes requested on a correction",
      `${correction.grade} at ${correction.zone}: ${note}`,
      { type: "correction", id: String(correction._id) },
    );
    await this.auditLog.log(userId, "correction.request_changes", "correction", String(correction._id), {
      note,
    });

    return correction;
  }
}
