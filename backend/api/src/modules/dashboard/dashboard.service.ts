import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { AuditLog } from "../../database/schemas/activity.schema";
import { Producer, Location, GradeMapping } from "../../database/schemas/catalog.schema";
import { PriceCircular } from "../../database/schemas/circular.schema";
import { PriceCircularDraft } from "../../database/schemas/price-circular-draft.schema";
import { PriceCorrection } from "../../database/schemas/correction.schema";
import { DatasetService } from "../dataset/dataset.service";
import { CorrectionsService } from "../corrections/corrections.service";

interface ChartPoint {
  label: string;
  value: number;
}

/** Zero-fills a $group-by-day result so a line/bar chart gets a continuous
 * x-axis instead of gaps wherever a day had no activity. */
function fillDailySeries(raw: Array<{ _id: string; count: number }>, from: Date, to: Date): ChartPoint[] {
  const byDay = new Map(raw.map((r) => [r._id, r.count]));
  const out: ChartPoint[] = [];
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ label: key, value: byDay.get(key) ?? 0 });
  }
  return out;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Producer.name) private producers: Model<Producer>,
    @InjectModel(Location.name) private locations: Model<Location>,
    @InjectModel(GradeMapping.name) private gradeMappings: Model<GradeMapping>,
    @InjectModel(PriceCircular.name) private circulars: Model<PriceCircular>,
    @InjectModel(PriceCircularDraft.name) private drafts: Model<PriceCircularDraft>,
    @InjectModel(PriceCorrection.name) private corrections: Model<PriceCorrection>,
    @InjectModel(AuditLog.name) private auditLogs: Model<AuditLog>,
    private dataset: DatasetService,
    private correctionsService: CorrectionsService,
  ) {}

  async get() {
    const [kpis, charts, recentActivity] = await Promise.all([
      this.kpis(),
      this.charts(),
      this.recentActivity(),
    ]);
    return { kpis, charts, recentActivity };
  }

  private async kpis() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      correctionSummary,
      draftsCount,
      publishedCount,
      scheduledCount,
      producersCount,
      locationsCount,
      gradesCount,
      today,
      thisWeek,
      thisMonth,
    ] = await Promise.all([
      this.correctionsService.summary(),
      this.drafts.countDocuments({ status: "draft" }),
      this.circulars.countDocuments({ status: "active" }),
      // No real scheduling concept exists in this codebase — this is an
      // honest approximation: drafts not yet published whose effective date
      // is still ahead, not a real scheduled-job count.
      this.drafts.countDocuments({
        status: { $in: ["draft", "review", "approved"] },
        effectiveDate: { $gt: now },
      }),
      this.producers.countDocuments({ active: true }),
      this.locations.countDocuments({}),
      this.gradeMappings.countDocuments({ status: "active" }),
      this.auditLogs.countDocuments({ createdAt: { $gte: startOfDay } }),
      this.auditLogs.countDocuments({ createdAt: { $gte: startOfWeek } }),
      this.auditLogs.countDocuments({ createdAt: { $gte: startOfMonth } }),
    ]);

    // GAIL's live price book is not its own Mongo collection — it's computed
    // in-memory from the cached round, same source Compare/Deal read from.
    // PriceEntry holds rows across every producer and every historical round,
    // so counting it directly would overcount "the live GAIL book" badly.
    const data = await this.dataset.load();
    const gail = data.priceIndex.producers.GAIL;
    const priceBookEntries = gail
      ? Object.values(gail.zones).reduce((sum, grades) => sum + Object.keys(grades).length, 0)
      : 0;

    return {
      corrections: correctionSummary,
      circulars: { drafts: draftsCount, published: publishedCount, scheduled: scheduledCount },
      masterData: {
        producers: producersCount,
        locations: locationsCount,
        grades: gradesCount,
        priceBookEntries,
      },
      activity: { today, thisWeek, thisMonth },
    };
  }

  private async charts() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const [trendRaw, approvalRaw, updatesRaw, weeklyRaw] = await Promise.all([
      this.corrections.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      ]),
      this.corrections.aggregate([
        { $match: { status: { $in: ["applied", "rejected"] }, decidedAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      this.corrections.aggregate([
        { $match: { status: "applied", decidedAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$decidedAt" } }, count: { $sum: 1 } } },
      ]),
      this.circulars.aggregate([
        { $match: { effectiveDate: { $gte: new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000) } } },
        {
          $group: {
            _id: { $dateTrunc: { date: "$effectiveDate", unit: "week", startOfWeek: "monday" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return {
      correctionsTrend: fillDailySeries(trendRaw, thirtyDaysAgo, now),
      approvalRate: {
        approved: approvalRaw.find((r) => r._id === "applied")?.count ?? 0,
        rejected: approvalRaw.find((r) => r._id === "rejected")?.count ?? 0,
      },
      priceUpdates: fillDailySeries(updatesRaw, thirtyDaysAgo, now),
      circularActivity: weeklyRaw.map((r) => ({
        label: new Date(r._id).toISOString().slice(0, 10),
        value: r.count,
      })),
    };
  }

  private recentActivity() {
    return this.auditLogs
      .find()
      .sort({ createdAt: -1 })
      .limit(15)
      .populate("user", "name email role")
      .lean();
  }
}
