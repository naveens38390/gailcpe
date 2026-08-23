/**
 * The reusable engine behind every master-data module: Producer, Location,
 * Grade, and eventually Price Circular and Freight Circular management.
 *
 * One state machine, applied uniformly:
 *
 *   draft -> review -> approved -> published
 *                \-> rejected
 *
 * A publish never overwrites the live record's history — the previous
 * published revision for the same entity is marked "superseded", not deleted,
 * so `history()` is a complete, permanent record of who changed what and why.
 * Rollback creates a *new* published revision restoring old field values
 * rather than resurrecting the old document, so the audit trail only ever
 * grows forward.
 *
 * Deliberately untyped at the Mongoose boundary (`Model<any>`, plain field
 * bags): a generic `Model<T>` here sends tsc into a very deep instantiation
 * of Mongoose's types and runs out of heap — the same wall this project's
 * seed script already documented. Each module's own service and DTOs are
 * where real field-level typing and validation belong.
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Model, Types } from "mongoose";
import { requiresSeparateApprover } from "../../core/approval-policy";

export type RevisionStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "rejected"
  | "superseded";

export class RevisionWorkflow {
  constructor(
    /** The revisions collection for this entity type (e.g. ProducerRevision). */
    private revisions: Model<any>,
    /** The live/published collection the rest of the app actually reads. */
    private live: Model<any>,
    /** The live collection's natural key field, e.g. "code" or "name". */
    private idField: string,
  ) {}

  /** Start (or resume editing) a proposed change. Does not touch the live record. */
  async draft(
    entityId: string,
    fields: Record<string, unknown>,
    reason: string,
    userId: string,
    createsNew: boolean,
  ) {
    const liveDoc = await this.live.findOne({ [this.idField]: entityId }).lean();
    if (createsNew && liveDoc) {
      throw new BadRequestException(`${entityId} already exists — propose an edit instead.`);
    }
    if (!createsNew && !liveDoc) {
      throw new NotFoundException(`${entityId} does not exist yet — propose it as new.`);
    }

    const last: any = await this.revisions.findOne({ entityId }).sort({ version: -1 }).lean();
    const version = (last?.version ?? 0) + 1;

    return this.revisions.create({
      entityId,
      createsNew,
      fields,
      baseline: liveDoc ?? null,
      version,
      status: "draft",
      reason,
      createdBy: userId,
    });
  }

  /** draft -> review. Only the proposer can submit their own draft. */
  async submit(revisionId: string, userId: string) {
    const rev = await this.get(revisionId);
    this.assertOwner(rev, userId, "submit");
    this.assertStatus(rev, ["draft"], "submitted for review");
    rev.status = "review";
    rev.submittedAt = new Date();
    await rev.save();
    return rev;
  }

  /** review -> approved | rejected. Never the proposer's own submission. */
  async review(revisionId: string, userId: string, approve: boolean, note?: string) {
    const rev = await this.get(revisionId);
    this.assertNotOwner(rev, userId, "review");
    this.assertStatus(rev, ["review"], "reviewed");
    rev.status = approve ? "approved" : "rejected";
    rev.reviewedBy = new Types.ObjectId(userId);
    rev.reviewedAt = new Date();
    rev.reviewNote = note;
    await rev.save();
    return rev;
  }

  /**
   * approved -> published. Writes the live record and supersedes its
   * predecessor. `checkOwner` is false only when called from `rollback()`:
   * a rollback is one person's single safety action, not a proposal someone
   * else grants, so the usual "not your own proposal" guard does not apply.
   */
  async publish(revisionId: string, userId: string, checkOwner = true) {
    const rev = await this.get(revisionId);
    if (checkOwner) this.assertNotOwner(rev, userId, "publish");
    this.assertStatus(rev, ["approved"], "published");

    const merged = { ...(rev.baseline ?? {}), ...rev.fields };
    // findOneAndReplace, not findOneAndUpdate: a plain (non-$-operator)
    // object passed to findOneAndUpdate is cast into an implicit $set by
    // Mongoose, which only ever touches the keys present and never clears
    // one that's absent. merged is meant to be the complete document, so a
    // field a rollback's fullState doesn't mention must actually disappear —
    // a true replace is the only way that happens.
    await this.live.findOneAndReplace(
      { [this.idField]: rev.entityId },
      { ...merged, [this.idField]: rev.entityId, currentRevision: rev._id, currentVersion: rev.version },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await this.revisions.updateMany(
      { entityId: rev.entityId, status: "published", _id: { $ne: rev._id } },
      { status: "superseded" },
    );

    rev.status = "published";
    rev.publishedBy = new Types.ObjectId(userId);
    rev.publishedAt = new Date();
    await rev.save();
    return rev;
  }

  /**
   * Restore a prior published version. This is itself the safety action, so
   * it skips review — but it is still a new, fully audited published
   * revision, never a resurrection of the old one.
   */
  async rollback(entityId: string, toVersion: number, userId: string, reason: string) {
    const target = await this.revisions
      .findOne({ entityId, version: toVersion, status: { $in: ["published", "superseded"] } })
      .lean();
    if (!target) {
      throw new NotFoundException(`No published version ${toVersion} found for ${entityId}.`);
    }

    // Restore the *complete* state as of that version, not just the fields
    // that one revision itself changed — replaying only its diff would leave
    // any field a later, since-superseded version set still sitting on the
    // live document after the "rollback".
    const fullState = { ...((target as any).baseline ?? {}), ...(target as any).fields };
    const last: any = await this.revisions.findOne({ entityId }).sort({ version: -1 }).lean();
    const version = (last?.version ?? 0) + 1;

    // Deliberately not this.draft(): draft() snapshots the *current* live
    // document as baseline, and publish() merges fields onto that baseline —
    // which would let a field some later, since-superseded version set
    // silently survive the "rollback" because fullState never mentions it to
    // clear it. baseline: null makes publish()'s merge resolve to fullState
    // exactly, with nothing from the current live state bleeding through.
    const restored = await this.revisions.create({
      entityId,
      createsNew: false,
      fields: fullState,
      baseline: null,
      version,
      status: "approved",
      reason,
      createdBy: userId,
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewNote: `Rollback to version ${toVersion}`,
    });
    return this.publish(String(restored._id), userId, false);
  }

  async history(entityId: string) {
    return this.revisions
      .find({ entityId })
      .sort({ version: -1 })
      .populate("createdBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("publishedBy", "name email role")
      .lean();
  }

  /** Everyone's revisions awaiting a decision, across all entities of this type. */
  async pending(statuses: RevisionStatus[] = ["draft", "review", "approved"]) {
    return this.revisions
      .find({ status: { $in: statuses } })
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email role")
      .populate("reviewedBy", "name email role")
      .lean();
  }

  async liveList() {
    return this.live.find().lean();
  }

  async diff(entityId: string, fromVersion: number, toVersion: number) {
    const [from, to] = await Promise.all([
      this.revisions.findOne({ entityId, version: fromVersion }).lean(),
      this.revisions.findOne({ entityId, version: toVersion }).lean(),
    ]);
    if (!from || !to) throw new NotFoundException("One of those versions does not exist.");
    const fromFields = { ...((from as any).baseline ?? {}), ...(from as any).fields };
    const toFields = { ...((to as any).baseline ?? {}), ...(to as any).fields };
    // baseline is a snapshot of the live Mongo document, so it carries the
    // live schema's own bookkeeping — never a real field-level change. The
    // idField itself is the entity's identity, constant across every version
    // of one entity by definition, so it never belongs in a diff either.
    const noiseKeys = ["_id", "__v", "createdAt", "updatedAt", "currentRevision", "currentVersion", this.idField];
    for (const noise of noiseKeys) {
      delete (fromFields as any)[noise];
      delete (toFields as any)[noise];
    }
    const keys = new Set([...Object.keys(fromFields), ...Object.keys(toFields)]);
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
    for (const key of keys) {
      if (JSON.stringify(fromFields[key]) !== JSON.stringify(toFields[key])) {
        changes.push({ field: key, from: fromFields[key], to: toFields[key] });
      }
    }
    return { entityId, fromVersion, toVersion, changes };
  }

  private async get(revisionId: string) {
    const rev = await this.revisions.findById(revisionId);
    if (!rev) throw new NotFoundException("No such revision.");
    return rev;
  }

  private assertStatus(rev: any, allowed: RevisionStatus[], action: string) {
    if (!allowed.includes(rev.status)) {
      throw new BadRequestException(`Cannot be ${action} from status "${rev.status}".`);
    }
  }

  private assertOwner(rev: any, userId: string, action: string) {
    if (String(rev.createdBy) !== userId) {
      throw new ForbiddenException(`Only the proposer can ${action} this.`);
    }
  }

  private assertNotOwner(rev: any, userId: string, action: string) {
    if (!requiresSeparateApprover()) return;
    if (String(rev.createdBy) === userId) {
      throw new ForbiddenException(`You cannot ${action} your own proposal.`);
    }
  }
}
