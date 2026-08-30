import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { CircularsController } from "./circulars.controller";
import { CircularsService } from "./circulars.service";
import { CircularStoreService } from "./circular-store.service";
import { ReferenceDetectorService } from "./reference-detector.service";
import { PriceCircularsModule } from "../price-circulars/price-circulars.module";
import { FreightCircularsModule } from "../freight-circulars/freight-circulars.module";
import {
  FreightCircular,
  FreightCircularSchema,
  PriceCircular,
  PriceCircularSchema,
  PriceEntry,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";
import {
  CircularDocument,
  CircularDocumentSchema,
} from "../../database/schemas/circular-document.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCircular.name, schema: PriceCircularSchema },
      { name: FreightCircular.name, schema: FreightCircularSchema },
      { name: PriceEntry.name, schema: PriceEntrySchema },
      { name: CircularDocument.name, schema: CircularDocumentSchema },
    ]),
    PriceCircularsModule,
    FreightCircularsModule,
  ],
  controllers: [CircularsController],
  providers: [CircularsService, CircularStoreService, ReferenceDetectorService],
  exports: [CircularsService, CircularStoreService],
})
export class CircularsModule {}
