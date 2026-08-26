import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { CircularsController } from "./circulars.controller";
import { CircularsService } from "./circulars.service";
import { CircularStoreService } from "./circular-store.service";
import { PriceCircularsModule } from "../price-circulars/price-circulars.module";
import {
  FreightCircular,
  FreightCircularSchema,
  PriceCircular,
  PriceCircularSchema,
  PriceEntry,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCircular.name, schema: PriceCircularSchema },
      { name: FreightCircular.name, schema: FreightCircularSchema },
      { name: PriceEntry.name, schema: PriceEntrySchema },
    ]),
    PriceCircularsModule,
  ],
  controllers: [CircularsController],
  providers: [CircularsService, CircularStoreService],
  exports: [CircularsService, CircularStoreService],
})
export class CircularsModule {}
