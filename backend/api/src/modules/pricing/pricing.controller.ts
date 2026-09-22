import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import type { PricingBasis, Producer } from "../../core/types";
import { CompareDto } from "./dto/compare.dto";
import { PricingService } from "./pricing.service";

/** Drop anything that is not a real price list; an unknown value must not read as ex depot. */
function onlyKnownBases(
  input?: Record<string, string>,
): Partial<Record<Producer, PricingBasis>> | undefined {
  if (!input) return undefined;
  const out: Partial<Record<Producer, PricingBasis>> = {};
  for (const [producer, basis] of Object.entries(input)) {
    if (basis === "ex_works" || basis === "ex_depot") out[producer as Producer] = basis;
  }
  return out;
}

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
        gradeOverrides: dto.gradeOverrides as any,
        basisOverrides: onlyKnownBases(dto.basisOverrides),
        defaultBasis: dto.pricingBasis,
      },
    );
  }

  @Get("grade-options")
  @ApiOperation({
    summary: "Every equivalent competitor grade for this GAIL grade, priced at this location",
  })
  gradeOptions(@Query("grade") grade: string, @Query("location") location: string) {
    return this.pricing.gradeOptions(grade, location);
  }

  @Get("history")
  @ApiOperation({ summary: "This user's recent comparisons" })
  history(
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("pricingBasis") pricingBasis?: string,
  ) {
    return this.pricing.recent(
      req.user?.id,
      limit ? Number(limit) : undefined,
      pricingBasis === "ex_works" || pricingBasis === "ex_depot" ? pricingBasis : undefined,
    );
  }

  @Get("gail-book")
  @ApiOperation({ summary: "GAIL's full live price book, one row per zone/grade" })
  gailBook() {
    return this.pricing.gailBook();
  }
}
