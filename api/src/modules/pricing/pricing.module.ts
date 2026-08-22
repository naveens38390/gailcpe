import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { PricingController } from "./pricing.controller";
import { PricingService } from "./pricing.service";
import {
  ComparisonHistory,
  ComparisonHistorySchema,
} from "../../database/schemas/activity.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ComparisonHistory.name, schema: ComparisonHistorySchema },
    ]),
  ],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
