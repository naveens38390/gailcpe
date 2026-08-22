import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { DealsController } from "./deals.controller";
import { DealsService } from "./deals.service";
import {
  DealSimulationDoc,
  DealSimulationSchema,
} from "../../database/schemas/activity.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DealSimulationDoc.name, schema: DealSimulationSchema },
    ]),
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
