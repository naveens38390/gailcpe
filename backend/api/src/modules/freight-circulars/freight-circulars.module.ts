import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { Location, LocationSchema } from "../../database/schemas/catalog.schema";
import {
  FreightCircular,
  FreightCircularSchema,
  FreightEntry,
  FreightEntrySchema,
} from "../../database/schemas/circular.schema";
import {
  FreightCircularDraft,
  FreightCircularDraftRow,
  FreightCircularDraftRowSchema,
  FreightCircularDraftSchema,
} from "../../database/schemas/freight-circular-draft.schema";
import { NotificationsModule } from "../notifications/notifications.module";
import { FreightCircularsController } from "./freight-circulars.controller";
import { FreightCircularsService } from "./freight-circulars.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FreightCircularDraft.name, schema: FreightCircularDraftSchema },
      { name: FreightCircularDraftRow.name, schema: FreightCircularDraftRowSchema },
      { name: FreightCircular.name, schema: FreightCircularSchema },
      { name: FreightEntry.name, schema: FreightEntrySchema },
      { name: Location.name, schema: LocationSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [FreightCircularsController],
  providers: [FreightCircularsService],
  exports: [FreightCircularsService],
})
export class FreightCircularsModule {}
