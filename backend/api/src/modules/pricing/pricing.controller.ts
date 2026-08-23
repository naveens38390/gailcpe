import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { CompareDto } from "./dto/compare.dto";
import { PricingService } from "./pricing.service";

@ApiTags("pricing")
@Controller("pricing")
export class PricingController {
  constructor(private pricing: PricingService) {}

  @Post("compare")
  @ApiOperation({
    summary: "Landed cost for GAIL and all five competitors at one location",
  })
  compare(@Body() dto: CompareDto, @Req() req: any) {
    return this.pricing.compare(
      dto.grade,
      dto.location,
      dto.quantityMt,
      dto.paymentMode,
      {
        asOf: dto.asOf ? new Date(dto.asOf) : undefined,
        userId: req.user?.id,
      },
    );
  }

  @Get("history")
  @ApiOperation({ summary: "This user's recent comparisons" })
  history(@Req() req: any, @Query("limit") limit?: string) {
    return this.pricing.recent(req.user?.id, limit ? Number(limit) : undefined);
  }

  @Get("gail-book")
  @ApiOperation({ summary: "GAIL's full live price book, one row per zone/grade" })
  gailBook() {
    return this.pricing.gailBook();
  }
}
