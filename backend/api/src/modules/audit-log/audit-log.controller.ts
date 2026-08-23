import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditLogService } from "./audit-log.service";

@ApiTags("audit-log")
@Controller("audit-logs")
export class AuditLogController {
  constructor(private auditLog: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: "The audit trail, newest first, filterable" })
  list(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("user") user?: string,
    @Query("action") action?: string,
    @Query("entity") entity?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.auditLog.list({
      from,
      to,
      user,
      action,
      entity,
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
