import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { Location, LocationSchema } from "../../database/schemas/catalog.schema";
import { RevisionSchema } from "../../database/schemas/revision.schema";
import { LocationsController } from "./locations.controller";
import { LocationsService } from "./locations.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Location.name, schema: LocationSchema },
      { name: "LocationRevision", schema: RevisionSchema, collection: "locationRevisions" },
    ]),
  ],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
