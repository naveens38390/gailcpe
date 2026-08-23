import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { FreightService } from "./freight.service";

@ApiTags("freight")
@Controller("freight")
export class FreightController {
  constructor(private freight: FreightService) {}

  @Get()
  @ApiOperation({ summary: "Every producer's freight to one destination" })
  atLocation(@Query("location") location: string, @Query("asOf") asOf?: string) {
    return this.freight.atLocation(location, asOf ? new Date(asOf) : undefined);
  }

  @Get("spread")
  @ApiOperation({ summary: "Where one producer's freight beats another's" })
  spread(
    @Query("a") a = "GAIL",
    @Query("b") b = "HMEL",
    @Query("asOf") asOf?: string,
  ) {
    return this.freight.spread(a, b, asOf ? new Date(asOf) : undefined);
  }
}
