/**
 * What changed, by the day it changed.
 *
 * The question this answers is asked in a meeting, not at a terminal: "why is
 * this price different from the one I quoted in February?" Answering it by
 * opening a PDF means knowing which PDF, and reading a 108-page annexure to
 * find one row. This assembles the answer instead — the day, who did it, which
 * circular it came from, and the value before and after.
 *
 * Nothing here is a new record. Every event already existed as a published
 * circular, a master-data revision or an applied correction; they were simply
 * only readable one entity type at a time, which is no use to someone who
 * knows the date and nothing else.
 */

import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { PriceCorrection } from "../../database/schemas/correction.schema";
import { PriceCircular } from "../../database/schemas/circular.schema";
import { PriceCircularDraft } from "../../database/schemas/price-circular-draft.schema";

/** One thing that happened, whatever kind of thing it was. */
export interface TimelineEntry {
  kind: "circular_published" | "circular_filed" | "master_data" | "correction";
  at: string;
  /** The person, or a stand-in when the account is gone. */
  by: string;
  title: string;
  detail?: string;
  /** The circular this traces back to, where one exists. */
  source?: string;
  /** Before and after, for the fields that actually moved. */
  changes?: Array<{ field: string; from: unknown; to: unknown }>;
  /** Where to look for the full picture. */
  link?: { kind: "draft" | "circular" | "correction"; id: string };
}

export interface TimelineDay {
  date: string;
  entries: TimelineEntry[];
}

/** A removed account populates as null rather than being absent. */
function actorName(actor: unknown): string {
  if (!actor) return "an account since removed";
  if (typeof actor === "string") return actor;
  const a = actor as { name?: string; email?: string };
  return a.name ?? a.email ?? "an account since removed";
}

@Injectable()
export class TimelineService {
  constructor(
    @InjectModel(PriceCircularDraft.name) private drafts: Model<PriceCircularDraft>,
    @InjectModel(PriceCircular.name) private circulars: Model<PriceCircular>,
    @InjectModel(PriceCorrection.name) private corrections: Model<PriceCorrection>,
    @InjectModel("GradeRevision") private gradeRevisions: Model<any>,
    @InjectModel("LocationRevision") private locationRevisions: Model<any>,
    @InjectModel("ProducerRevision") private producerRevisions: Model<any>,
    @InjectModel("DiscountTermsRevision") private discountRevisions: Model<any>,
  ) {}

  async history(params: { from?: string; to?: string; limit?: number }) {
    const window: Record<string, Date> = {};
    if (params.from) window.$gte = new Date(params.from);
    if (params.to) {
      // An inclusive end date: someone asking for "to 15 Feb" means the whole
      // of the 15th, not midnight at the start of it.
      const end = new Date(params.to);
      end.setHours(23, 59, 59, 999);
      window.$lte = end;
    }
    const inWindow = (field: string) =>
      Object.keys(window).length ? { [field]: window } : {};

    const [published, filed, corrections, ...revisionSets] = await Promise.all([
      this.drafts
        .find({ status: "published", ...inWindow("publishedAt") })
        .populate("publishedBy", "name email")
        .sort({ publishedAt: -1 })
        .lean(),
      this.circulars
        .find({ uploadedAt: { $exists: true }, ...inWindow("uploadedAt") })
        .populate("uploadedBy", "name email")
        .sort({ uploadedAt: -1 })
        .lean(),
      this.corrections
        .find({ status: "applied", ...inWindow("decidedAt") })
        .populate("decidedBy", "name email")
        .sort({ decidedAt: -1 })
        .lean(),
      ...this.revisionModels().map(([label, model]) =>
        model
          .find({ status: "published", ...inWindow("publishedAt") })
          .populate("publishedBy", "name email")
          .sort({ publishedAt: -1 })
          .lean()
          .then((rows: any[]) => rows.map((r) => ({ ...r, __label: label }))),
      ),
    ]);

    const entries: TimelineEntry[] = [
      ...published.map((d: any) => this.fromCircular(d)),
      ...filed.map((c: any) => this.fromUpload(c)),
      ...corrections.map((c: any) => this.fromCorrection(c)),
      ...revisionSets.flat().map((r: any) => this.fromRevision(r)),
    ];

    entries.sort((a, b) => b.at.localeCompare(a.at));

    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 500) : 200;
    const days = new Map<string, TimelineEntry[]>();
    for (const entry of entries.slice(0, limit)) {
      const day = entry.at.slice(0, 10);
      const list = days.get(day);
      if (list) list.push(entry);
      else days.set(day, [entry]);
    }

    return {
      total: entries.length,
      shown: Math.min(entries.length, limit),
      days: [...days.entries()].map(([date, list]) => ({ date, entries: list })),
    };
  }

  private revisionModels(): Array<[string, Model<any>]> {
    return [
      ["Grade", this.gradeRevisions],
      ["Location", this.locationRevisions],
      ["Producer", this.producerRevisions],
      ["Discount terms", this.discountRevisions],
    ];
  }

  private fromCircular(d: any): TimelineEntry {
    return {
      kind: "circular_published",
      at: new Date(d.publishedAt).toISOString(),
      by: actorName(d.publishedBy),
      title: `${d.producer} price circular ${d.circularNumber} published`,
      detail:
        d.changedRowCount > 0
          ? `${d.changedRowCount.toLocaleString("en-IN")} of ${d.rowCount.toLocaleString("en-IN")} rows changed`
          : `${d.rowCount.toLocaleString("en-IN")} rows, none changed`,
      source: d.circularNumber,
      link: { kind: "draft", id: String(d._id) },
    };
  }

  private fromUpload(c: any): TimelineEntry {
    return {
      kind: "circular_filed",
      at: new Date(c.uploadedAt).toISOString(),
      by: actorName(c.uploadedBy),
      title: `${c.producer} circular ${c.reference} filed`,
      detail: c.sourceFilename ? `Source document: ${c.sourceFilename}` : undefined,
      source: c.reference,
      link: { kind: "circular", id: String(c._id) },
    };
  }

  private fromCorrection(c: any): TimelineEntry {
    return {
      kind: "correction",
      at: new Date(c.decidedAt).toISOString(),
      by: actorName(c.decidedBy),
      title: `${c.grade} at ${c.zone} corrected`,
      detail: c.reason,
      changes: [{ field: "Basic price", from: c.currentPrice, to: c.proposedPrice }],
      link: { kind: "correction", id: String(c._id) },
    };
  }

  /**
   * A master-data revision stores only the fields it changed plus a snapshot
   * of the record as it stood, so the pair gives before and after without
   * having to replay anything.
   */
  private fromRevision(r: any): TimelineEntry {
    const baseline = (r.baseline ?? {}) as Record<string, unknown>;
    const fields = (r.fields ?? {}) as Record<string, unknown>;
    const changes = Object.entries(fields)
      .filter(([field, to]) => !r.createsNew && !deepEqual(baseline[field], to))
      .map(([field, to]) => ({ field, from: baseline[field], to }));

    // A revision can be published having proposed the values already in place.
    // Saying "updated" with nothing beside it invites the reader to assume the
    // before/after was lost, so the entry says which it was.
    const noop = !r.createsNew && changes.length === 0;

    return {
      kind: "master_data",
      at: new Date(r.publishedAt).toISOString(),
      by: actorName(r.publishedBy),
      title: r.createsNew
        ? `${r.__label} ${r.entityId} added`
        : noop
          ? `${r.__label} ${r.entityId} republished, no values changed`
          : `${r.__label} ${r.entityId} updated`,
      detail: r.reason,
      changes: changes.length ? changes : undefined,
    };
  }
}

/** Enough for the scalar and small-array values a revision actually holds. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
