import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import {
  ComparisonHistory,
  DealSimulationDoc,
} from "../../database/schemas/activity.schema";
import { DiscountTerms } from "../../database/schemas/discount-terms.schema";
import { DatasetService } from "../dataset/dataset.service";
import { MasterDataService } from "../master-data/master-data.service";
import { RevisionWorkflow } from "../master-data/revision-workflow";
import { CreateDiscountTermsDto, DraftDiscountTermsDto } from "./dto/discount-fields.dto";

const IMPACT_WINDOW_DAYS = 30;

/**
 * Discount Terms master data — GAIL's cash discount, EPI, IFC, dealer scheme
 * and quantity slabs, on the same engine as Producers, Locations and Grades.
 *
 * This is the module that closes the gap flagged in every report on this
 * dataset since the first one: GAIL's quantity-discount slabs are not in any
 * supplied circular, so the engine has been reporting them as UNKNOWN. Once
 * this is published, that gap closes for every quote.
 */
@Injectable()
export class DiscountAdminService extends MasterDataService {
  protected workflow: RevisionWorkflow;
  protected entityName = "discount_terms";

  constructor(
    @InjectModel(DiscountTerms.name) private terms: Model<DiscountTerms>,
    @InjectModel("DiscountTermsRevision") private revisions: Model<any>,
    @InjectModel(ComparisonHistory.name) private comparisons: Model<ComparisonHistory>,
    @InjectModel(DealSimulationDoc.name) private simulations: Model<DealSimulationDoc>,
    private dataset: DatasetService,
  ) {
    super();
    this.workflow = new RevisionWorkflow(this.revisions, this.terms, "producer");
  }

  /** A discount change moves every quote's effective net, not just its landed cost. */
  protected invalidate(): void {
    this.dataset.invalidate();
  }

  async create(dto: CreateDiscountTermsDto, userId: string) {
    const { producer, reason, submit, ...fields } = dto;
    const rev = await this.workflow.draft(producer, fields, reason, userId, true);
    return submit === false ? rev : this.submit(String(rev._id), userId);
  }

  async draft(producer: string, dto: DraftDiscountTermsDto, userId: string) {
    const { reason, submit, ...changes } = dto;
    const fields = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    const rev = await this.workflow.draft(producer, fields, reason, userId, false);
    return submit === false ? rev : this.submit(String(rev._id), userId);
  }

  /**
   * approved -> published, plus stamping when these terms actually took
   * effect — the one piece of effective-dating this module adds beyond the
   * shared engine: not a future-scheduled window yet, but a clear, honest
   * record of when "now" happened, since discount terms are read live.
   *
   * Routes through the base class's publish() (not this.workflow.publish()
   * directly) so the shared invalidate()/audit-log behavior still runs —
   * this override only adds the effectiveFrom stamp on top.
   */
  async publish(revisionId: string, userId: string) {
    const rev = await super.publish(revisionId, userId);
    await this.terms.updateOne({ producer: (rev as any).entityId }, { effectiveFrom: new Date() });
    return rev;
  }

  /** Recent comparisons and simulations that used GAIL's discount terms at all. */
  async impact(producer: string) {
    const since = new Date(Date.now() - IMPACT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // Discount terms apply to every GAIL quote regardless of grade, so impact
    // is scoped to GAIL-produced results in the window, not a specific field.
    const gailFilter = { createdAt: { $gte: since } };
    const [comparisons, simulations, locations] = await Promise.all([
      this.comparisons.countDocuments(gailFilter),
      this.simulations.countDocuments(gailFilter),
      this.comparisons.distinct("location", gailFilter),
    ]);
    return { producer, windowDays: IMPACT_WINDOW_DAYS, comparisons, simulations, locations };
  }
}
