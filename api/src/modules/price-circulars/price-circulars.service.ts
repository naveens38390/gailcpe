import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";

import { PriceBasis } from "../../database/schemas/catalog.schema";
import {
  PriceCircular,
  PriceEntry,
} from "../../database/schemas/circular.schema";
import {
  DraftStatus,
  PriceCircularDraft,
  PriceCircularDraftRow,
} from "../../database/schemas/price-circular-draft.schema";
import { DatasetService } from "../dataset/dataset.service";

export type BulkOp =
  | { type: "set"; value: number }
  | { type: "delta"; value: number }
  | { type: "percent"; value: number };

/**
 * Mongoose does not reliably auto-cast a plain string against an
 * ObjectId-typed query field in this project's configuration — proved by
 * direct reproduction, not assumption: `.find({draft: "<hex string>"})`
 * silently matched zero documents against a collection that genuinely held
 * 16,589 of them, while `.find({draft: new Types.ObjectId(id)})` found them
 * all. Every non-`_id` ObjectId filter in this service goes through this.
 */
function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

/**
 * Price Circular Management — "many rows, one revision".
 *
 * A draft is cloned from the current live price book, edited row by row or
 * in bulk through the Data Grid, then goes through the same
 * draft -> review -> approved -> published lifecycle every other module
 * uses, with the same guard (the proposer cannot review or publish their own
 * draft). Publishing does not invent a parallel "live" store: it writes a
 * real PriceCircular + PriceEntry set, so the pricing engine, Price Book,
 * and every comparison start reading it with no other code change.
 */
@Injectable()
export class PriceCircularsService {
  constructor(
    @InjectModel(PriceCircularDraft.name) private drafts: Model<PriceCircularDraft>,
    @InjectModel(PriceCircularDraftRow.name) private draftRows: Model<PriceCircularDraftRow>,
    @InjectModel(PriceCircular.name) private circulars: Model<PriceCircular>,
    @InjectModel(PriceEntry.name) private entries: Model<PriceEntry>,
    private dataset: DatasetService,
  ) {}

  async list(status?: string) {
    return this.drafts
      .find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("publishedBy", "name email role")
      .lean();
  }

  async detail(id: string) {
    const draft = await this.drafts
      .findById(id)
      .populate("createdBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("publishedBy", "name email role")
      .lean();
    if (!draft) throw new NotFoundException("No such draft circular.");
    return draft;
  }

  async rows(draftId: string) {
    return this.draftRows.find({ draft: oid(draftId) }).sort({ zone: 1, grade: 1 }).lean();
  }

  /** Clones the current live price book as the starting point for a new circular. */
  async create(
    producer: string,
    circularNumber: string,
    effectiveDate: Date,
    reason: string,
    userId: string,
  ) {
    const data = await this.dataset.load();
    const live = data.priceIndex.producers[producer as keyof typeof data.priceIndex.producers];
    if (!live) throw new BadRequestException(`${producer} has no live price book to clone.`);

    const draft = await this.drafts.create({
      producer,
      circularNumber,
      effectiveDate,
      basis: live.basis as PriceBasis,
      status: "draft",
      reason,
      createdBy: userId,
      rowCount: 0,
      changedRowCount: 0,
    });

    const rows: Array<{ draft: Types.ObjectId; zone: string; grade: string; basicPrice: number; previousPrice: number; changed: boolean }> = [];
    for (const [zone, grades] of Object.entries(live.zones)) {
      for (const [grade, price] of Object.entries(grades)) {
        rows.push({ draft: draft._id, zone, grade, basicPrice: price, previousPrice: price, changed: false });
      }
    }
    for (let i = 0; i < rows.length; i += 5000) {
      await this.draftRows.insertMany(rows.slice(i, i + 5000), { ordered: false });
    }
    draft.rowCount = rows.length;
    await draft.save();
    return draft;
  }

  async updateRow(draftId: string, rowId: string, basicPrice: number) {
    const draft = await this.requireStatus(draftId, ["draft"], "edited");
    const row = await this.draftRows.findOne({ _id: oid(rowId), draft: oid(draftId) });
    if (!row) throw new NotFoundException("No such row in this draft.");
    row.basicPrice = basicPrice;
    row.changed = basicPrice !== row.previousPrice;
    await row.save();
    await this.recomputeChangedCount(draft._id);
    return row;
  }

  async bulkUpdate(draftId: string, rowIds: string[], op: BulkOp) {
    const draft = await this.requireStatus(draftId, ["draft"], "edited");
    if (!rowIds.length) throw new BadRequestException("Select at least one row.");
    const rows = await this.draftRows.find({ _id: { $in: rowIds.map(oid) }, draft: oid(draftId) });
    for (const row of rows) {
      const next =
        op.type === "set" ? op.value
        : op.type === "delta" ? row.basicPrice + op.value
        : Math.round(row.basicPrice * (1 + op.value / 100) * 100) / 100;
      row.basicPrice = next;
      row.changed = next !== row.previousPrice;
      await row.save();
    }
    await this.recomputeChangedCount(draft._id);
    return { updated: rows.length };
  }

  /** What differs between this draft and the circular it was cloned from. */
  async diff(draftId: string) {
    const draft = await this.drafts.findById(draftId).lean();
    if (!draft) throw new NotFoundException("No such draft circular.");
    const changed = await this.draftRows.find({ draft: oid(draftId), changed: true }).sort({ zone: 1, grade: 1 }).lean();
    return {
      draftId,
      changedRowCount: changed.length,
      changes: changed.map((r) => ({
        zone: r.zone,
        grade: r.grade,
        from: r.previousPrice,
        to: r.basicPrice,
        delta: Math.round((r.basicPrice - r.previousPrice) * 100) / 100,
      })),
    };
  }

  async submit(draftId: string, userId: string) {
    const draft = await this.requireStatus(draftId, ["draft"], "submitted for review");
    this.assertOwner(draft, userId, "submit");
    draft.status = "review";
    draft.submittedAt = new Date();
    await draft.save();
    return draft;
  }

  async review(draftId: string, userId: string, approve: boolean, note?: string) {
    const draft = await this.requireStatus(draftId, ["review"], "reviewed");
    this.assertNotOwner(draft, userId, "review");
    draft.status = approve ? "approved" : "rejected";
    draft.reviewedBy = new Types.ObjectId(userId);
    draft.reviewedAt = new Date();
    draft.reviewNote = note;
    await draft.save();
    return draft;
  }

  /** approved -> published: writes a real, immutable PriceCircular + PriceEntry set. */
  async publish(draftId: string, userId: string) {
    const draft = await this.requireStatus(draftId, ["approved"], "published");
    this.assertNotOwner(draft, userId, "publish");

    const rows = await this.draftRows.find({ draft: oid(draftId) }).lean();
    if (!rows.length) throw new BadRequestException("This draft has no rows.");

    await this.circulars.updateMany(
      { producer: draft.producer, status: "active" },
      { status: "superseded" },
    );
    const circular = await this.circulars.create({
      producer: draft.producer,
      reference: draft.circularNumber,
      effectiveDate: draft.effectiveDate,
      status: "active",
      basis: draft.basis,
      stats: { zones: new Set(rows.map((r) => r.zone)).size, prices: rows.length },
    });

    const entryRows = rows.map((r) => ({
      circular: circular._id,
      producer: draft.producer,
      effectiveDate: draft.effectiveDate,
      zone: r.zone,
      grade: r.grade,
      price: r.basicPrice,
      basis: draft.basis,
    }));
    for (let i = 0; i < entryRows.length; i += 5000) {
      await this.entries.insertMany(entryRows.slice(i, i + 5000), { ordered: false });
    }

    draft.status = "published";
    draft.publishedBy = new Types.ObjectId(userId);
    draft.publishedAt = new Date();
    draft.publishedCircular = circular._id;
    await draft.save();

    this.dataset.invalidate();
    return { draft, circular };
  }

  /** Reactivate a previously-published circular — a real rollback of live data, not a draft. */
  async rollbackCircular(producer: string, circularId: string, userId: string, reason: string) {
    const target = await this.circulars.findOne({ _id: oid(circularId), producer });
    if (!target) throw new NotFoundException("No such published circular for this producer.");
    if (target.status === "active") throw new BadRequestException("This circular is already active.");

    await this.circulars.updateMany({ producer, status: "active" }, { status: "superseded" });
    target.status = "active";
    await target.save();
    this.dataset.invalidate();
    return { circular: target, reason, rolledBackBy: userId };
  }

  private async recomputeChangedCount(draftId: Types.ObjectId) {
    const changedRowCount = await this.draftRows.countDocuments({ draft: draftId, changed: true });
    await this.drafts.updateOne({ _id: draftId }, { changedRowCount });
  }

  private async requireStatus(draftId: string, allowed: DraftStatus[], action: string) {
    const draft = await this.drafts.findById(draftId);
    if (!draft) throw new NotFoundException("No such draft circular.");
    if (!allowed.includes(draft.status)) {
      throw new BadRequestException(`Cannot be ${action} from status "${draft.status}".`);
    }
    return draft;
  }

  private assertOwner(draft: PriceCircularDraft, userId: string, action: string) {
    if (String(draft.createdBy) !== userId) {
      throw new ForbiddenException(`Only the creator can ${action} this draft.`);
    }
  }

  private assertNotOwner(draft: PriceCircularDraft, userId: string, action: string) {
    if (String(draft.createdBy) === userId) {
      throw new ForbiddenException(`You cannot ${action} your own draft circular.`);
    }
  }
}
