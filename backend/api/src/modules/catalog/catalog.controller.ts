import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { CatalogService } from "./catalog.service";

@ApiTags("catalog")
@Controller("catalog")
export class CatalogController {
  constructor(private catalog: CatalogService) {}

  @Get()
  @ApiOperation({
    summary: "Every selectable value — producers, grades and locations — from the published round",
  })
  all() {
    return this.catalog.catalog();
  }

  @Get("grades/:grade/availability")
  @ApiOperation({
    summary: "Locations and producers that can actually price one grade",
  })
  availability(@Param("grade") grade: string) {
    return this.catalog.availability(grade);
  }

  @Get("grades/:grade/variants")
  @ApiOperation({
    summary: "Every grade serving the same application, priced at one location",
  })
  variants(@Param("grade") grade: string, @Query("location") location?: string) {
    return this.catalog.variants(grade, location);
  }
}
