import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import {
  PriceCircular,
  PriceCircularSchema,
  PriceEntry,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";
import {
  PriceCircularDraft,
  PriceCircularDraftRow,
  PriceCircularDraftRowSchema,
  PriceCircularDraftSchema,
} from "../../database/schemas/price-circular-draft.schema";
import { NotificationsModule } from "../notifications/notifications.module";
import { PriceCircularsController } from "./price-circulars.controller";
import { PriceCircularsService } from "./price-circulars.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCircularDraft.name, schema: PriceCircularDraftSchema },
      { name: PriceCircularDraftRow.name, schema: PriceCircularDraftRowSchema },
      { name: PriceCircular.name, schema: PriceCircularSchema },
      { name: PriceEntry.name, schema: PriceEntrySchema },
    ]),
    NotificationsModule,
  ],
  controllers: [PriceCircularsController],
  providers: [PriceCircularsService],
  exports: [PriceCircularsService],
})
export class PriceCircularsModule {}
