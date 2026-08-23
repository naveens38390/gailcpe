import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import {
  ComparisonHistory,
  DealSimulationDoc,
} from "../../database/schemas/activity.schema";
import { GradeMapping } from "../../database/schemas/catalog.schema";
import { DatasetService } from "../dataset/dataset.service";
import { MasterDataService } from "../master-data/master-data.service";
import { RevisionWorkflow } from "../master-data/revision-workflow";
import { CreateGradeDto, DraftGradeDto, EquivalentsPatch } from "./dto/grade-fields.dto";

/** Apply a patch (null removes a producer's list) onto the live equivalents map. */
function mergeEquivalents(
  current: Record<string, string[]> | undefined,
  patch: EquivalentsPatch,
): Record<string, string[]> {
  const merged = { ...(current ?? {}) };
  for (const [producer, codes] of Object.entries(patch)) {
    if (codes === null) delete merged[producer];
    else merged[producer] = codes;
  }
  return merged;
}

const IMPACT_WINDOW_DAYS = 30;

/**
 * Grade (cross-reference) master data — replaces CrossReference_Master.xlsx.
 *
 * The one thing this module has that Producers and Locations don't: a grade
 * change can be quietly load-bearing across thousands of comparisons, so
 * `impact()` answers "who actually uses this" before anyone approves a
 * change to it, not after.
 */
@Injectable()
export class GradeAdminService extends MasterDataService {
  protected workflow: RevisionWorkflow;

  constructor(
    @InjectModel(GradeMapping.name) private mappings: Model<GradeMapping>,
    @InjectModel("GradeRevision") private revisions: Model<any>,
    @InjectModel(ComparisonHistory.name) private comparisons: Model<ComparisonHistory>,
    @InjectModel(DealSimulationDoc.name) private simulations: Model<DealSimulationDoc>,
    private dataset: DatasetService,
  ) {
    super();
    this.workflow = new RevisionWorkflow(this.revisions, this.mappings, "gailGrade");
  }

  /** A grade edit changes what every future comparison and simulation resolves to. */
  protected invalidate(): void {
    this.dataset.invalidate();
  }

  async create(dto: CreateGradeDto, userId: string) {
    const { gailGrade, reason, submit, ...changes } = dto;
    const fields = this.buildFields(undefined, changes);
    const rev = await this.workflow.draft(gailGrade, fields, reason, userId, true);
    return submit === false ? rev : this.workflow.submit(String(rev._id), userId);
  }

  async draft(gailGrade: string, dto: DraftGradeDto, userId: string) {
    const { reason, submit, ...changes } = dto;
    const live = await this.mappings.findOne({ gailGrade }).lean();
    const fields = this.buildFields(live ?? undefined, changes);
    const rev = await this.workflow.draft(gailGrade, fields, reason, userId, false);
    return submit === false ? rev : this.workflow.submit(String(rev._id), userId);
  }

  /**
   * How much retiring or changing this grade would actually touch — recent
   * comparisons and simulations that resolved it, and where. Shown before a
   * reviewer decides, not discovered afterward.
   */
  async impact(gailGrade: string) {
    const since = new Date(Date.now() - IMPACT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [comparisons, simulations, locations] = await Promise.all([
      this.comparisons.countDocuments({ grade: gailGrade, createdAt: { $gte: since } }),
      this.simulations.countDocuments({ grade: gailGrade, createdAt: { $gte: since } }),
      this.comparisons.distinct("location", { grade: gailGrade, createdAt: { $gte: since } }),
    ]);
    return { windowDays: IMPACT_WINDOW_DAYS, comparisons, simulations, locations };
  }

  private buildFields(
    live: GradeMapping | undefined,
    changes: Omit<DraftGradeDto, "reason" | "submit">,
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const key of [
      "polymer",
      "section",
      "application",
      "characteristic",
      "process",
      "mfi",
      "density",
      "confidence",
      "status",
      "international",
    ] as const) {
      if (changes[key] !== undefined) fields[key] = changes[key];
    }
    if (changes.equivalents !== undefined) {
      fields.equivalents = mergeEquivalents(live?.equivalents, changes.equivalents);
    }
    return fields;
  }
}
