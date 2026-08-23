import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { CircularsService } from "./circulars.service";

@ApiTags("circulars")
@Controller("circulars")
export class CircularsController {
  constructor(private circulars: CircularsService) {}

  @Get()
  @ApiOperation({ summary: "All price and freight circulars, newest first" })
  list(@Query("kind") kind?: "price" | "freight") {
    return this.circulars.list(kind);
  }

  @Get("rounds")
  @ApiOperation({ summary: "Effective dates available to price against" })
  rounds() {
    return this.circulars.rounds();
  }

  @Get("diff")
  @ApiOperation({ summary: "What changed for one producer between two rounds" })
  diff(
    @Query("producer") producer: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.circulars.diff(producer, new Date(from), new Date(to));
  }

  @Get(":id")
  @ApiOperation({ summary: "One circular and a sample of its entries" })
  detail(@Param("id") id: string) {
    return this.circulars.detail(id);
  }

  @Post(":id/publish")
  @ApiOperation({ summary: "Make a circular active and supersede its predecessor" })
  publish(@Param("id") id: string) {
    return this.circulars.publish(id);
  }
}
