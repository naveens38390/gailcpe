import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import {
  FreightCircular,
  PriceCircular,
  PriceEntry,
} from "../../database/schemas/circular.schema";
import { DatasetService } from "../dataset/dataset.service";

/**
 * Circular Repository.
 *
 * Versioned by effective date from the first record, because new circulars
 * arrive monthly and an officer defending a quote needs the circular that was
 * live on the day they gave it — not today's.
 *
 * Publishing supersedes rather than deletes: `status` moves to "superseded" and
 * the entries stay, so `asOf` queries keep working.
 */
@Injectable()
export class CircularsService {
  constructor(
    @InjectModel(PriceCircular.name) private prices: Model<PriceCircular>,
    @InjectModel(FreightCircular.name) private freight: Model<FreightCircular>,
    @InjectModel(PriceEntry.name) private entries: Model<PriceEntry>,
    private dataset: DatasetService,
  ) {}

  async list(kind?: "price" | "freight") {
    const [price, freight] = await Promise.all([
      kind === "freight" ? [] : this.prices.find().sort({ effectiveDate: -1 }).lean(),
      kind === "price" ? [] : this.freight.find().sort({ effectiveDate: -1 }).lean(),
    ]);
    return {
      price: price.map((c) => ({ ...c, kind: "price" as const })),
      freight: freight.map((c) => ({ ...c, kind: "freight" as const })),
    };
  }

  async rounds() {
    const rows = await this.prices.aggregate([
      { $group: { _id: "$effectiveDate", producers: { $addToSet: "$producer" } } },
      { $sort: { _id: -1 } },
    ]);
    return rows.map((r) => ({
      effectiveDate: r._id,
      producers: r.producers.sort(),
    }));
  }

  async detail(id: string) {
    const circular = await this.prices.findById(id).lean();
    if (!circular) throw new NotFoundException("No such circular.");
    const sample = await this.entries
      .find({ circular: circular._id })
      .limit(50)
      .lean();
    return { circular, sample };
  }

  /**
   * What changed between two rounds for one producer — the question a pricing
   * officer asks the morning a circular lands.
   */
  async diff(producer: string, from: Date, to: Date) {
    const [before, after] = await Promise.all([
      this.entries.find({ producer, effectiveDate: from }).lean(),
      this.entries.find({ producer, effectiveDate: to }).lean(),
    ]);
    const key = (e: { zone: string; grade: string }) => `${e.zone}|${e.grade}`;
    const beforeMap = new Map(before.map((e) => [key(e), e.price]));

    const changes: Array<{
      zone: string;
      grade: string;
      from: number | null;
      to: number;
      delta: number | null;
    }> = [];
    for (const entry of after) {
      const previous = beforeMap.get(key(entry)) ?? null;
      if (previous === entry.price) continue;
      changes.push({
        zone: entry.zone,
        grade: entry.grade,
        from: previous,
        to: entry.price,
        delta: previous === null ? null : Math.round((entry.price - previous) * 100) / 100,
      });
    }
    changes.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

    const moved = changes.filter((c) => c.delta !== null);
    return {
      producer,
      from,
      to,
      changed: changes.length,
      increased: moved.filter((c) => c.delta! > 0).length,
      decreased: moved.filter((c) => c.delta! < 0).length,
      added: changes.filter((c) => c.delta === null).length,
      changes: changes.slice(0, 200),
    };
  }

  /** Called after a new circular is loaded, so the next request re-reads. */
  async publish(id: string) {
    const circular = await this.prices.findById(id);
    if (!circular) throw new NotFoundException("No such circular.");
    await this.prices.updateMany(
      {
        producer: circular.producer,
        effectiveDate: { $lt: circular.effectiveDate },
        status: "active",
      },
      { status: "superseded" },
    );
    circular.status = "active";
    await circular.save();
    this.dataset.invalidate();
    return circular;
  }
}
