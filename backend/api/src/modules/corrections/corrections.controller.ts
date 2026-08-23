import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { CorrectionsService } from "./corrections.service";
import { DecideCorrectionDto } from "./dto/decide-correction.dto";
import { ProposeCorrectionDto } from "./dto/propose-correction.dto";

@ApiTags("corrections")
@Controller("corrections")
export class CorrectionsController {
  constructor(private corrections: CorrectionsService) {}

  @Get()
  @ApiOperation({ summary: "Price corrections, newest first" })
  list(@Query("status") status?: string) {
    return this.corrections.list(status);
  }

  @Post()
  @ApiOperation({ summary: "Propose a correction to one of GAIL's own prices" })
  propose(@Body() dto: ProposeCorrectionDto, @Req() req: any) {
    return this.corrections.propose(dto, req.user.id);
  }

  @Post(":id/decide")
  @ApiOperation({ summary: "Approve or reject a pending correction" })
  decide(@Param("id") id: string, @Body() dto: DecideCorrectionDto, @Req() req: any) {
    return this.corrections.decide(id, req.user.id, dto.approve, dto.note);
  }
}
