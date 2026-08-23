import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { AuditLog, AuditLogSchema } from "../../database/schemas/activity.schema";
import { PriceCircularDraft, PriceCircularDraftSchema } from "../../database/schemas/price-circular-draft.schema";
import { CorrectionsModule } from "../corrections/corrections.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

/**
 * A thin aggregator, not a home for new business logic: it reads across
 * Corrections, Circulars, Master Data, and the Audit Log, and no single
 * existing module owns that whole surface. Producer/Location/GradeMapping/
 * PriceCircular/PriceCorrection model tokens all come free from the global
 * DatasetModule — only PriceCircularDraft and AuditLog need registering here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCircularDraft.name, schema: PriceCircularDraftSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    CorrectionsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
