import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { PriceCircular, PriceCircularSchema } from "../../database/schemas/circular.schema";
import {
  PriceCorrection,
  PriceCorrectionSchema,
} from "../../database/schemas/correction.schema";
import {
  PriceCircularDraft,
  PriceCircularDraftSchema,
} from "../../database/schemas/price-circular-draft.schema";
import { RevisionSchema } from "../../database/schemas/revision.schema";
import { TimelineController } from "./timeline.controller";
import { TimelineService } from "./timeline.service";

/**
 * Reads the same revision collections each master-data module owns. Binding
 * them again here is deliberate: the timeline only ever reads published
 * history, so it has no business importing the modules that write it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PriceCircularDraft.name, schema: PriceCircularDraftSchema },
      { name: PriceCircular.name, schema: PriceCircularSchema },
      { name: PriceCorrection.name, schema: PriceCorrectionSchema },
      { name: "GradeRevision", schema: RevisionSchema, collection: "gradeRevisions" },
      { name: "LocationRevision", schema: RevisionSchema, collection: "locationRevisions" },
      { name: "ProducerRevision", schema: RevisionSchema, collection: "producerRevisions" },
      { name: "DiscountTermsRevision", schema: RevisionSchema, collection: "discountTermsRevisions" },
    ]),
  ],
  controllers: [TimelineController],
  providers: [TimelineService],
})
export class TimelineModule {}
