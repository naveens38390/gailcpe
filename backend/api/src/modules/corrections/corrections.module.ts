import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import {
  PriceCorrection,
  PriceCorrectionSchema,
} from "../../database/schemas/correction.schema";
import { NotificationsModule } from "../notifications/notifications.module";
import { CorrectionsController } from "./corrections.controller";
import { CorrectionsService } from "./corrections.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCorrection.name, schema: PriceCorrectionSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [CorrectionsController],
  providers: [CorrectionsService],
  exports: [CorrectionsService],
})
export class CorrectionsModule {}
