import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import {
  ComparisonHistory,
  ComparisonHistorySchema,
  DealSimulationDoc,
  DealSimulationSchema,
} from "../../database/schemas/activity.schema";
import { DiscountTerms, DiscountTermsSchema } from "../../database/schemas/discount-terms.schema";
import { RevisionSchema } from "../../database/schemas/revision.schema";
import { DiscountAdminService } from "./discount-admin.service";
import { DiscountsController } from "./discounts.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DiscountTerms.name, schema: DiscountTermsSchema },
      { name: "DiscountTermsRevision", schema: RevisionSchema, collection: "discountTermsRevisions" },
      { name: ComparisonHistory.name, schema: ComparisonHistorySchema },
      { name: DealSimulationDoc.name, schema: DealSimulationSchema },
    ]),
  ],
  controllers: [DiscountsController],
  providers: [DiscountAdminService],
  exports: [DiscountAdminService],
})
export class DiscountsModule {}
