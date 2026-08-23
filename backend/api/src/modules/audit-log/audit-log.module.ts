import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { AuditLog, AuditLogSchema } from "../../database/schemas/activity.schema";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";

/**
 * Global, like DatasetModule: every write-path module across the app injects
 * AuditLogService (master data, price circulars, corrections) without each
 * of those module files needing to import this one.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
