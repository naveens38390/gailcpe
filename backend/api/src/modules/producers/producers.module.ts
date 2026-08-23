import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { Producer, ProducerSchema } from "../../database/schemas/catalog.schema";
import { RevisionSchema } from "../../database/schemas/revision.schema";
import { ProducersController } from "./producers.controller";
import { ProducersService } from "./producers.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Producer.name, schema: ProducerSchema },
      { name: "ProducerRevision", schema: RevisionSchema, collection: "producerRevisions" },
    ]),
  ],
  controllers: [ProducersController],
  providers: [ProducersService],
  exports: [ProducersService],
})
export class ProducersModule {}
