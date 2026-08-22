import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import {
  ComparisonHistory,
  ComparisonHistorySchema,
  DealSimulationDoc,
  DealSimulationSchema,
} from "../../database/schemas/activity.schema";
import {
  Grade,
  GradeMapping,
  GradeMappingSchema,
  GradeSchema,
} from "../../database/schemas/catalog.schema";
import { RevisionSchema } from "../../database/schemas/revision.schema";
import { GradeAdminService } from "./grade-admin.service";
import { GradesController } from "./grades.controller";
import { GradesService } from "./grades.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Grade.name, schema: GradeSchema },
      { name: GradeMapping.name, schema: GradeMappingSchema },
      { name: "GradeRevision", schema: RevisionSchema, collection: "gradeRevisions" },
      { name: ComparisonHistory.name, schema: ComparisonHistorySchema },
      { name: DealSimulationDoc.name, schema: DealSimulationSchema },
    ]),
  ],
  controllers: [GradesController],
  providers: [GradesService, GradeAdminService],
  exports: [GradesService, GradeAdminService],
})
export class GradesModule {}
