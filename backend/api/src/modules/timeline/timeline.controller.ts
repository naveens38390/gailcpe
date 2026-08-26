import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { TimelineService } from "./timeline.service";

@ApiTags("timeline")
@Controller("timeline")
export class TimelineController {
  constructor(private timeline: TimelineService) {}

  @Get()
  @ApiOperation({
    summary: "Everything that changed, grouped by the day it changed",
  })
  history(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return this.timeline.history({ from, to, limit: limit ? Number(limit) : undefined });
  }
}
