import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { DealsService } from "./deals.service";
import { SimulateDto } from "./dto/simulate.dto";
import { Roles } from "../auth/roles.decorator";

@ApiTags("deals")
@Controller("deals")
export class DealsController {
  constructor(private deals: DealsService) {}

  @Post("simulate")
  @ApiOperation({
    summary: "Where GAIL stands, what a correction costs, and what it wins",
  })
  simulate(@Body() dto: SimulateDto, @Req() req: any) {
    return this.deals.simulate(
      {
        customer: dto.customer,
        grade: dto.grade,
        location: dto.location,
        quantityMt: dto.quantityMt,
        paymentMode: dto.paymentMode,
        asOf: dto.asOf ? new Date(dto.asOf) : undefined,
      },
      req.user?.id,
    );
  }

  @Post(":id/outcome")
  @Roles("sales_officer", "territory_manager", "regional_manager", "corporate_pricing")
  @ApiOperation({ summary: "Record whether the deal was won or lost" })
  outcome(
    @Param("id") id: string,
    @Body() body: { outcome: "won" | "lost"; correctionRequestedPerMt?: number },
  ) {
    return this.deals.recordOutcome(
      id,
      body.outcome,
      body.correctionRequestedPerMt,
    );
  }

  @Get("history")
  @ApiOperation({ summary: "This user's recent simulations" })
  history(@Req() req: any, @Query("limit") limit?: string) {
    return this.deals.recent(req.user?.id, limit ? Number(limit) : undefined);
  }
}
