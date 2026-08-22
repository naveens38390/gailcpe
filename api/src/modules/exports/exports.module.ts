import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

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
  FreightCircular,
  FreightCircularSchema,
  FreightEntry,
  FreightEntrySchema,
  PriceCircular,
  PriceCircularSchema,
  PriceEntry,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";
import { DiscountTerms, DiscountTermsSchema } from "../../database/schemas/discount-terms.schema";
import { ExcelExportService } from "./excel-export.service";
import { ExportsController } from "./exports.controller";
import { PdfExportService } from "./pdf-export.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCircular.name, schema: PriceCircularSchema },
      { name: PriceEntry.name, schema: PriceEntrySchema },
      { name: FreightCircular.name, schema: FreightCircularSchema },
      { name: FreightEntry.name, schema: FreightEntrySchema },
      { name: DiscountScheme.name, schema: DiscountSchemeSchema },
      { name: DiscountTerms.name, schema: DiscountTermsSchema },
      { name: GradeMapping.name, schema: GradeMappingSchema },
      { name: Location.name, schema: LocationSchema },
      { name: Producer.name, schema: ProducerSchema },
    ]),
  ],
  controllers: [ExportsController],
  providers: [ExcelExportService, PdfExportService],
})
export class ExportsModule {}
