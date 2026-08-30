import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";

import { normalise } from "../../core/pricing";
import { Location } from "../../database/schemas/catalog.schema";
import {
  FreightCircular,
  FreightEntry,
} from "../../database/schemas/circular.schema";
import {
  FreightCircularDraft,
  FreightCircularDraftRow,
  FreightDraftStatus,
} from "../../database/schemas/freight-circular-draft.schema";
import { DatasetService } from "../dataset/dataset.service";
import { requiresSeparateApprover } from "../../core/approval-policy";
import { AuditLogService } from "../audit-log/audit-log.service";
import { NotificationsService } from "../notifications/notifications.service";

export type FreightBulkOp =
  | { type: "set"; value: number }
  | { type: "delta"; value: number }
  | { type: "percent"; value: number };

/** See the note in price-circulars.service.ts: a plain string does not cast. */
function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Freight Circular Management.
 *
 * Freight moved on spreadsheets while prices moved through a governed
 * workflow, which meant the half of landed cost that decides most
 * comparisons — GAIL, HMEL, OPaL and HPL all sell ex-works — could change
 * with no draft, no reviewer and no history. This puts freight on the same
 * footing as price: a draft is cloned from the live book or built from a
 * circular's reading, diffed, reviewed by someone other than its author, and
 * published as a real FreightCircular + FreightEntry set.
 *
 * The one rule that has no price-side equivalent is destination mapping. A
 * price circular's grades come from a governed master; a freight circular's
 * destinations are whatever the producer's spreadsheet calls them, and a new
 * circular can introduce a town nothing maps to. Such a rate is real but
 * invisible — no comparison will ever reach it — so it is counted on the
 * draft, listed in the diff, and publishing is refused until a reviewer has
 * been shown it and said so.
 */
@Injectable()
export class FreightCircularsService {
  constructor(
    @InjectModel(FreightCircularDraft.name)
    private drafts: Model<FreightCircularDraft>,
    @InjectModel(FreightCircularDraftRow.name)
    private draftRows: Model<FreightCircularDraftRow>,
    @InjectModel(FreightCircular.name) private circulars: Model<FreightCircular>,
    @InjectModel(FreightEntry.name) private entries: Model<FreightEntry>,
    @InjectModel(Location.name) private locations: Model<Location>,
    private dataset: DatasetService,
    private auditLog: AuditLogService,
    private notifications: NotificationsService,
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
    if (!draft) throw new NotFoundException("No such draft freight circular.");
    return draft;
  }

  async rows(draftId: string) {
    return this.draftRows.find({ draft: oid(draftId) }).sort({ destination: 1 }).lean();
  }

  /** Which producers have a live freight book to draft against. */
  async producers() {
    const data = await this.dataset.load();
    return Object.entries(data.freight.books).map(([producer, book]) => ({
      producer,
      destinations: book.length,
    }));
  }

  /**
   * Every destination this producer's locations are mapped to, normalised.
   *
   * A location names its own freight destination per producer
   * (Location.freightDestination), because freight is billed by the producer's
   * spelling — "Panaji" for HMEL, "PANAJI" for HPL. A destination absent from
   * this set is unreachable by any comparison.
   */
  private async mappedDestinations(producer: string): Promise<Set<string>> {
    const rows = await this.locations.find().lean();
    const mapped = new Set<string>();
    for (const row of rows) {
      const named = (row.freightDestination ?? {})[producer];
      // A location with no explicit mapping falls back to its own name, which
      // is exactly what FreightService.atLocation does when it looks a rate up.
      mapped.add(normalise(named ?? row.name));
    }
    return mapped;
  }

  /** Clones the producer's current live freight book as a starting point. */
  async create(
    producer: string,
    circularNumber: string | undefined,
    effectiveDate: Date,
    reason: string,
    userId: string,
  ) {
    const data = await this.dataset.load();
    const live = data.freight.books[producer];
    if (!live?.length) {
      throw new BadRequestException(`${producer} has no live freight book to clone.`);
    }

    // HMEL's and OPaL's freight schedules print no reference at all, so a
    // mandatory field here would only produce invented ones. Same descriptive
    // label the filing path assigns — see CircularsService.upload.
    const round = effectiveDate.toISOString().slice(0, 10);
    const reference = circularNumber?.trim() || `${producer} freight ${round}`;

    // The draft itself, not the build summary: this is what the caller
    // navigates to, and every count the summary carries is on the draft.
    const { draft } = await this.build({
      producer,
      circularNumber: reference,
      effectiveDate,
      reason,
      userId,
      rows: live.map((r) => ({
        destination: r.destination,
        ratePerMt: r.rate_per_mt,
        insurancePerMt: r.insurance_per_mt ?? 0,
      })),
      action: "freight_circular.create",
    });
    return draft;
  }

  /**
   * Build a draft from a circular's extracted reading rather than from the
   * live book.
   *
   * `create` clones what is published and waits for someone to type changes
   * into it. This starts from what the new circular says and works out the
   * changes by comparing against the live book — the same diff from the other
   * direction, so review and publish are untouched.
   *
   * Destinations the extract carries that the live book does not are real: a
   * circular can open a new town. They join the draft as rows but not as
   * *changes* — there is no previous rate for them to have moved from, and
   * counting a jump from zero would put a false Rs 5,000 swing at the top of
   * the diff. They are reported separately, alongside anything the live book
   * has that the extract dropped.
   */
  async createFromExtract(params: {
    producer: string;
    circularNumber: string;
    effectiveDate: Date;
    reason: string;
    userId: string;
    rows: Array<{
      destination: string;
      ratePerMt: number;
      insurancePerMt: number;
      state?: string;
      district?: string;
      cluster?: string;
      distanceKm?: number;
      transitDays?: number;
    }>;
  }) {
    return this.build({ ...params, action: "freight_circular.extract" });
  }

  private async build(params: {
    producer: string;
    circularNumber: string;
    effectiveDate: Date;
    reason: string;
    userId: string;
    rows: Array<{
      destination: string;
      ratePerMt: number;
      insurancePerMt: number;
      state?: string;
      district?: string;
      cluster?: string;
      distanceKm?: number;
      transitDays?: number;
    }>;
    action: string;
  }) {
    const data = await this.dataset.load();
    const live = data.freight.books[params.producer] ?? [];
    const mapped = await this.mappedDestinations(params.producer);

    /**
     * Two indexes over the live book, because one is not enough.
     *
     * Matching on the normalised key alone is wrong: the producers' own books
     * carry rows that collapse to the same key at different rates — HMEL
     * prints "Bilaspur" at 1,320 and "Bilaspur(Ch)" at 4,560, HPL "KALOL" and
     * "KALOL(MEHSANA)", OPaL "Dadra" twice. Keyed matching made a clone of the
     * live book report a change that nobody had made.
     *
     * So: an exact name matches its own row. A differently-spelled name falls
     * back to the key, which is what makes a reading that writes "PANAJI" for
     * "Panaji" still line up. Where that fallback is ambiguous the row is
     * flagged rather than silently attached to whichever came first.
     *
     * "Its own row" is itself a bucket, not a single entry: HMEL's book prints
     * "Hamirpur" and "Shahjahanpur" twice each, for two real districts at two
     * real rates, spelled identically. A plain Map would keep only the last
     * one and quietly compare both readings of that name against it — this
     * hands out each live row in the order it was printed, so the first
     * "Shahjahanpur" in a reading pairs with the first in the live book, and
     * anything left with more than one entry, whether by exact name or only by
     * key, is flagged rather than guessed at.
     */
    const liveByExact = new Map<string, typeof live>();
    for (const r of live) {
      const bucket = liveByExact.get(r.destination);
      if (bucket) bucket.push(r);
      else liveByExact.set(r.destination, [r]);
    }
    const liveByKey = new Map<string, typeof live>();
    for (const r of live) {
      const key = normalise(r.destination);
      const bucket = liveByKey.get(key);
      if (bucket) bucket.push(r);
      else liveByKey.set(key, [r]);
    }

    const draft = await this.drafts.create({
      producer: params.producer,
      circularNumber: params.circularNumber,
      effectiveDate: params.effectiveDate,
      status: "draft",
      reason: params.reason,
      createdBy: params.userId,
      rowCount: 0,
      changedRowCount: 0,
      addedRowCount: 0,
      removedDestinations: [],
      unmappedCount: 0,
    });

    const seen = new Set<string>();
    const added: string[] = [];
    const unmapped: string[] = [];
    const ambiguous: string[] = [];
    // How many of each exact name this reading has already claimed from the
    // live book, so a second "Shahjahanpur" in the reading pairs with the
    // second live row rather than both racing for the first.
    const exactClaimed = new Map<string, number>();
    const rows = params.rows.map((r) => {
      const key = normalise(r.destination);
      seen.add(key);
      const exactBucket = liveByExact.get(r.destination);
      const claimed = exactClaimed.get(r.destination) ?? 0;
      const exact = exactBucket?.[claimed];
      if (exact) exactClaimed.set(r.destination, claimed + 1);
      const keyBucket = liveByKey.get(key);
      const exactIsAmbiguous = (exactBucket?.length ?? 0) > 1;
      const keyIsAmbiguous = !exact && (keyBucket?.length ?? 0) > 1;
      if (exactIsAmbiguous || keyIsAmbiguous) ambiguous.push(r.destination);
      const previous = exact ?? keyBucket?.[0];
      const isNew = !previous;
      if (isNew) added.push(r.destination);
      const isMapped = mapped.has(key);
      if (!isMapped) unmapped.push(r.destination);
      const previousRate = previous?.rate_per_mt ?? r.ratePerMt;
      const previousInsurance = previous?.insurance_per_mt ?? r.insurancePerMt;
      return {
        draft: draft._id,
        destination: r.destination,
        ratePerMt: r.ratePerMt,
        previousRatePerMt: previousRate,
        insurancePerMt: r.insurancePerMt,
        previousInsurancePerMt: previousInsurance,
        changed:
          !isNew &&
          (r.ratePerMt !== previousRate || r.insurancePerMt !== previousInsurance),
        isNew,
        mapped: isMapped,
        state: r.state,
        district: r.district,
        cluster: r.cluster,
        distanceKm: r.distanceKm,
        transitDays: r.transitDays,
      };
    });

    /**
     * A live destination the reading did not carry. Where a key holds only one
     * live row, the key is enough — that is what lets a respelling count as
     * the same town. Where it holds two, the key being present says nothing
     * about *which* of them survived, so those are decided on the exact name.
     */
    const readExact = new Set(params.rows.map((r) => r.destination));
    const removed = live
      .filter((r) => {
        const key = normalise(r.destination);
        const collides = (liveByKey.get(key)?.length ?? 0) > 1;
        return collides ? !readExact.has(r.destination) : !seen.has(key);
      })
      .map((r) => r.destination);

    // A row is pushed onto `ambiguous` once per occurrence, so an exact-name
    // pair like the two "Shahjahanpur" rows lands twice — dedupe before this
    // becomes what a reviewer reads and what the draft stores.
    const ambiguousUnique = Array.from(new Set(ambiguous));

    for (let i = 0; i < rows.length; i += 5000) {
      await this.draftRows.insertMany(rows.slice(i, i + 5000), { ordered: false });
    }

    draft.rowCount = rows.length;
    draft.changedRowCount = rows.filter((r) => r.changed).length;
    draft.addedRowCount = added.length;
    draft.removedDestinations = removed;
    draft.unmappedCount = unmapped.length;
    draft.ambiguousDestinations = ambiguousUnique;
    await draft.save();

    await this.auditLog.log(
      params.userId,
      params.action,
      "freight_circular",
      String(draft._id),
      {
        producer: params.producer,
        circularNumber: params.circularNumber,
        rowCount: rows.length,
        changedRowCount: draft.changedRowCount,
        added: added.length,
        removed: removed.length,
        unmapped: unmapped.length,
        ambiguous: ambiguousUnique.length,
      },
    );

    return {
      draft,
      rowCount: rows.length,
      changedRowCount: draft.changedRowCount,
      // Capped: a mis-parsed circular can make these enormous, and the point is
      // to show a reviewer the shape of the problem, not to ship all of it.
      added: added.slice(0, 50),
      addedCount: added.length,
      removed: removed.slice(0, 50),
      removedCount: removed.length,
      unmapped: unmapped.slice(0, 50),
      unmappedCount: unmapped.length,
      ambiguous: ambiguousUnique.slice(0, 50),
      ambiguousCount: ambiguousUnique.length,
    };
  }

  async updateRow(
    draftId: string,
    rowId: string,
    ratePerMt: number,
    insurancePerMt?: number,
  ) {
    const draft = await this.requireStatus(draftId, ["draft"], "edited");
    const row = await this.draftRows.findOne({ _id: oid(rowId), draft: oid(draftId) });
    if (!row) throw new NotFoundException("No such row in this draft.");
    if (!Number.isFinite(ratePerMt) || ratePerMt < 0) {
      throw new BadRequestException("A freight rate cannot be negative.");
    }
    row.ratePerMt = ratePerMt;
    if (insurancePerMt !== undefined) {
      if (!Number.isFinite(insurancePerMt) || insurancePerMt < 0) {
        throw new BadRequestException("An insurance rate cannot be negative.");
      }
      row.insurancePerMt = insurancePerMt;
    }
    row.changed =
      !row.isNew &&
      (row.ratePerMt !== row.previousRatePerMt ||
        row.insurancePerMt !== row.previousInsurancePerMt);
    await row.save();
    await this.recomputeChangedCount(draft._id);
    return row;
  }

  async bulkUpdate(draftId: string, rowIds: string[], op: FreightBulkOp) {
    const draft = await this.requireStatus(draftId, ["draft"], "edited");
    if (!rowIds.length) throw new BadRequestException("Select at least one row.");
    const rows = await this.draftRows.find({
      _id: { $in: rowIds.map(oid) },
      draft: oid(draftId),
    });
    for (const row of rows) {
      const next =
        op.type === "set"
          ? op.value
          : op.type === "delta"
            ? row.ratePerMt + op.value
            : round2(row.ratePerMt * (1 + op.value / 100));
      if (next < 0) {
        throw new BadRequestException(
          `That change would put ${row.destination} at a negative rate.`,
        );
      }
      row.ratePerMt = next;
      row.changed =
        !row.isNew &&
        (row.ratePerMt !== row.previousRatePerMt ||
          row.insurancePerMt !== row.previousInsurancePerMt);
      await row.save();
    }
    await this.recomputeChangedCount(draft._id);
    return { updated: rows.length };
  }

  /**
   * What differs between this draft and the live book — including the two
   * things a rate table can do that a price table's governed grades cannot:
   * introduce a destination, and drop one.
   */
  async diff(draftId: string) {
    const draft = await this.drafts.findById(draftId).lean();
    if (!draft) throw new NotFoundException("No such draft freight circular.");

    const [changed, added, unmapped] = await Promise.all([
      this.draftRows
        .find({ draft: oid(draftId), changed: true })
        .sort({ destination: 1 })
        .lean(),
      this.draftRows
        .find({ draft: oid(draftId), isNew: true })
        .sort({ destination: 1 })
        .lean(),
      this.draftRows
        .find({ draft: oid(draftId), mapped: false })
        .sort({ destination: 1 })
        .lean(),
    ]);

    return {
      draftId,
      changedRowCount: changed.length,
      changes: changed.map((r) => ({
        destination: r.destination,
        from: r.previousRatePerMt,
        to: r.ratePerMt,
        delta: round2(r.ratePerMt - r.previousRatePerMt),
        insuranceFrom: r.previousInsurancePerMt,
        insuranceTo: r.insurancePerMt,
      })),
      addedCount: added.length,
      added: added.map((r) => ({
        destination: r.destination,
        ratePerMt: r.ratePerMt,
        mapped: r.mapped,
      })),
      removedCount: draft.removedDestinations.length,
      removed: draft.removedDestinations,
      /**
       * The rates that will publish but be unreachable. Listed in full rather
       * than capped: this is the list a reviewer has to act on, and truncating
       * it would hide exactly the towns that need mapping.
       */
      unmappedCount: unmapped.length,
      unmapped: unmapped.map((r) => ({
        destination: r.destination,
        ratePerMt: r.ratePerMt,
        state: r.state ?? null,
        district: r.district ?? null,
        isNew: r.isNew,
      })),
      unmappedAcknowledgedAt: draft.unmappedAcknowledgedAt ?? null,
      /**
       * Rows whose live counterpart had to be guessed because the producer's
       * book carries two destinations with the same normalised name. The
       * before/after shown for these is the better of two readings, not a
       * certainty.
       */
      ambiguousCount: draft.ambiguousDestinations?.length ?? 0,
      ambiguous: draft.ambiguousDestinations ?? [],
    };
  }

  async submit(draftId: string, userId: string) {
    const draft = await this.requireStatus(draftId, ["draft"], "submitted for review");
    this.assertOwner(draft, userId, "submit");
    const rowCount = await this.draftRows.countDocuments({ draft: draft._id });
    if (!rowCount) throw new BadRequestException("This draft has no rows.");
    draft.status = "review";
    draft.submittedAt = new Date();
    await draft.save();
    await this.auditLog.log(
      userId,
      "freight_circular.submit",
      "freight_circular",
      String(draft._id),
      { producer: draft.producer, circularNumber: draft.circularNumber },
    );
    return draft;
  }

  /**
   * Approve or reject. A draft carrying unmapped destinations can only be
   * approved by a reviewer who says, in the same call, that they have seen
   * them — the flag is not a checkbox the proposer can pre-tick.
   */
  async review(
    draftId: string,
    userId: string,
    approve: boolean,
    note?: string,
    acknowledgeUnmapped?: boolean,
  ) {
    const draft = await this.requireStatus(draftId, ["review"], "reviewed");
    this.assertNotOwner(draft, userId, "review");

    if (approve && draft.unmappedCount > 0 && !acknowledgeUnmapped) {
      throw new BadRequestException(
        `${draft.unmappedCount} destination(s) in this circular are not mapped to any location and will be invisible to comparisons. Review the unmapped list and approve again confirming you have seen it.`,
      );
    }

    draft.status = approve ? "approved" : "rejected";
    draft.reviewedBy = new Types.ObjectId(userId);
    draft.reviewedAt = new Date();
    draft.reviewNote = note;
    if (approve && draft.unmappedCount > 0) draft.unmappedAcknowledgedAt = new Date();
    await draft.save();

    await this.auditLog.log(
      userId,
      "freight_circular.review",
      "freight_circular",
      String(draft._id),
      {
        producer: draft.producer,
        approved: approve,
        note,
        unmappedAcknowledged: approve && draft.unmappedCount > 0 ? draft.unmappedCount : 0,
      },
    );
    return draft;
  }

  /** approved -> published: writes a real FreightCircular + FreightEntry set. */
  async publish(draftId: string, userId: string) {
    const draft = await this.requireStatus(draftId, ["approved"], "published");
    this.assertNotOwner(draft, userId, "publish");

    const rows = await this.draftRows.find({ draft: oid(draftId) }).lean();
    if (!rows.length) throw new BadRequestException("This draft has no rows.");

    // The belt to the review step's braces. Approval is where the reviewer
    // sees the unmapped list; this is what makes "publish anyway" impossible
    // if that ever gets routed around.
    if (draft.unmappedCount > 0 && !draft.unmappedAcknowledgedAt) {
      throw new BadRequestException(
        `${draft.unmappedCount} destination(s) are unmapped and were never acknowledged. This circular cannot be published.`,
      );
    }

    await this.circulars.updateMany(
      { producer: draft.producer, status: "active" },
      { status: "superseded" },
    );
    const circular = await this.circulars.create({
      producer: draft.producer,
      reference: draft.circularNumber,
      effectiveDate: draft.effectiveDate,
      status: "active",
      stats: {
        destinations: rows.length,
        changed: draft.changedRowCount,
        added: draft.addedRowCount,
        removed: draft.removedDestinations.length,
        unmapped: draft.unmappedCount,
      },
    });

    const entryRows = rows.map((r) => ({
      circular: circular._id,
      producer: draft.producer,
      effectiveDate: draft.effectiveDate,
      destination: r.destination,
      ratePerMt: r.ratePerMt,
      insurancePerMt: r.insurancePerMt,
      state: r.state,
      district: r.district,
      cluster: r.cluster,
      distanceKm: r.distanceKm,
      transitDays: r.transitDays,
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

    await this.auditLog.log(
      userId,
      "freight_circular.publish",
      "freight_circular",
      String(draft._id),
      {
        producer: draft.producer,
        circularId: String(circular._id),
        destinations: rows.length,
        changed: draft.changedRowCount,
        unmapped: draft.unmappedCount,
      },
    );
    await this.notifications.notify(
      userId,
      "circular.published",
      "Freight circular published",
      `${draft.producer} ${draft.circularNumber}: ${rows.length} destinations` +
        (draft.unmappedCount
          ? `, ${draft.unmappedCount} of them not mapped to any location`
          : ""),
      { type: "circular", id: String(circular._id) },
    );

    return { draft, circular };
  }

  /** Reactivate a previously-published freight circular — real live data, not a draft. */
  async rollbackCircular(
    producer: string,
    circularId: string,
    userId: string,
    reason: string,
  ) {
    const target = await this.circulars.findOne({ _id: oid(circularId), producer });
    if (!target) {
      throw new NotFoundException("No such published freight circular for this producer.");
    }
    if (target.status === "active") {
      throw new BadRequestException("This circular is already active.");
    }

    await this.circulars.updateMany({ producer, status: "active" }, { status: "superseded" });
    target.status = "active";
    await target.save();
    this.dataset.invalidate();
    await this.auditLog.log(
      userId,
      "freight_circular.rollback",
      "freight_circular",
      String(target._id),
      { producer, reason },
    );
    return { circular: target, reason, rolledBackBy: userId };
  }

  private async recomputeChangedCount(draftId: Types.ObjectId) {
    const changedRowCount = await this.draftRows.countDocuments({
      draft: draftId,
      changed: true,
    });
    await this.drafts.updateOne({ _id: draftId }, { changedRowCount });
  }

  private async requireStatus(
    draftId: string,
    allowed: FreightDraftStatus[],
    action: string,
  ) {
    const draft = await this.drafts.findById(draftId);
    if (!draft) throw new NotFoundException("No such draft freight circular.");
    if (!allowed.includes(draft.status)) {
      throw new BadRequestException(`Cannot be ${action} from status "${draft.status}".`);
    }
    return draft;
  }

  private assertOwner(draft: FreightCircularDraft, userId: string, action: string) {
    if (String(draft.createdBy) !== userId) {
      throw new ForbiddenException(`Only the creator can ${action} this draft.`);
    }
  }

  private assertNotOwner(draft: FreightCircularDraft, userId: string, action: string) {
    if (!requiresSeparateApprover()) return;
    if (String(draft.createdBy) === userId) {
      throw new ForbiddenException(`You cannot ${action} your own draft circular.`);
    }
  }
}
