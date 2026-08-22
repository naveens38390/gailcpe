import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { DatasetService } from "./dataset.service";
import {
  GradeMapping,
  GradeMappingSchema,
  Location,
  LocationSchema,
  Producer,
  ProducerSchema,
} from "../../database/schemas/catalog.schema";
import {
  DiscountScheme,
  DiscountSchemeSchema,
  FreightEntry,
  FreightEntrySchema,
  PriceCircular,
  PriceCircularSchema,
  PriceEntry,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";
import {
  PriceCorrection,
  PriceCorrectionSchema,
} from "../../database/schemas/correction.schema";
import {
  DiscountTerms,
  DiscountTermsSchema,
} from "../../database/schemas/discount-terms.schema";

/**
 * Global: every pricing surface needs the loaded round, and there should be
 * exactly one copy of it in the process.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCircular.name, schema: PriceCircularSchema },
      { name: PriceEntry.name, schema: PriceEntrySchema },
      { name: FreightEntry.name, schema: FreightEntrySchema },
      { name: DiscountScheme.name, schema: DiscountSchemeSchema },
      { name: Location.name, schema: LocationSchema },
      { name: GradeMapping.name, schema: GradeMappingSchema },
      { name: Producer.name, schema: ProducerSchema },
      { name: PriceCorrection.name, schema: PriceCorrectionSchema },
      { name: DiscountTerms.name, schema: DiscountTermsSchema },
    ]),
  ],
  providers: [DatasetService],
  exports: [DatasetService, MongooseModule],
})
export class DatasetModule {}
