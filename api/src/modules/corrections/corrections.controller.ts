import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { Roles } from "../auth/roles.decorator";
import { CorrectionsService } from "./corrections.service";
import { DecideCorrectionDto } from "./dto/decide-correction.dto";
import { ProposeCorrectionDto } from "./dto/propose-correction.dto";

const PROPOSERS = ["territory_manager", "regional_manager", "corporate_pricing", "admin"] as const;
const APPROVERS = ["corporate_pricing", "admin"] as const;

@ApiTags("corrections")
@Controller("corrections")
export class CorrectionsController {
  constructor(private corrections: CorrectionsService) {}

  @Get()
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Price corrections, newest first" })
  list(@Query("status") status?: string) {
    return this.corrections.list(status);
  }

  @Post()
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Propose a correction to one of GAIL's own prices" })
  propose(@Body() dto: ProposeCorrectionDto, @Req() req: any) {
    return this.corrections.propose(dto, req.user.id);
  }

  @Post(":id/decide")
  @Roles(...APPROVERS)
  @ApiOperation({ summary: "Approve or reject a pending correction" })
  decide(@Param("id") id: string, @Body() dto: DecideCorrectionDto, @Req() req: any) {
    return this.corrections.decide(id, req.user.id, dto.approve, dto.note);
  }
}
