import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { ReviewDto, RollbackDto } from "../master-data/dto/review.dto";
import { CreateLocationDto, DraftLocationDto } from "./dto/location-fields.dto";
import { LocationsService } from "./locations.service";

/**
 * Location lookup and management. `search` stays public to any signed-in
 * role — it backs the destination picker on Compare/Deal/Freight. Everything
 * that changes a location's zone mapping is gated the same way every other
 * master-data module is.
 */
@ApiTags("locations")
@Controller("locations")
export class LocationsController {
  constructor(private locations: LocationsService) {}

  @Get("search")
  @ApiOperation({ summary: "Find a customer location by name" })
  async search(@Query("q") q = "", @Query("limit") limit = "25") {
    const rows = await this.locations.search(q, Number(limit));
    return rows.map((row) => {
      const zones = Object.entries(row.producerZone ?? {});
      const inferred = zones.filter(
        ([producer]) => row.producerZoneTier?.[producer] === "inferred_via_hpl",
      );
      return {
        name: row.name,
        sapCode: row.sapCode,
        competitorsPriced: zones.length,
        inferredZones: inferred.length,
        producerZone: row.producerZone,
        producerZoneTier: row.producerZoneTier,
      };
    });
  }

  @Get("revisions/pending")
  @ApiOperation({ summary: "Location changes awaiting review, approval, or publish" })
  pending() {
    return this.locations.pending();
  }

  @Get(":name/history")
  @ApiOperation({ summary: "Every revision ever proposed for one location" })
  history(@Param("name") name: string) {
    return this.locations.history(name);
  }

  @Get(":name/diff")
  @ApiOperation({ summary: "What changed between two published versions" })
  diff(@Param("name") name: string, @Query("from") from: string, @Query("to") to: string) {
    return this.locations.diff(name, Number(from), Number(to));
  }

  @Post()
  @ApiOperation({ summary: "Propose a new location" })
  create(@Body() dto: CreateLocationDto, @Req() req: any) {
    return this.locations.create(dto, req.user.id);
  }

  @Post(":name/draft")
  @ApiOperation({ summary: "Propose a change to an existing location's zone mapping" })
  draft(@Param("name") name: string, @Body() dto: DraftLocationDto, @Req() req: any) {
    return this.locations.draft(name, dto, req.user.id);
  }

  @Post("revisions/:id/submit")
  @ApiOperation({ summary: "Submit a saved draft for review" })
  submit(@Param("id") id: string, @Req() req: any) {
    return this.locations.submit(id, req.user.id);
  }

  @Post("revisions/:id/review")
  @ApiOperation({ summary: "Approve or reject a revision under review" })
  review(@Param("id") id: string, @Body() dto: ReviewDto, @Req() req: any) {
    return this.locations.review(id, req.user.id, dto.approve, dto.note);
  }

  @Post("revisions/:id/publish")
  @ApiOperation({ summary: "Publish an approved revision — makes it live" })
  publish(@Param("id") id: string, @Req() req: any) {
    return this.locations.publish(id, req.user.id);
  }

  @Post(":name/rollback")
  @ApiOperation({ summary: "Restore a prior published version" })
  rollback(@Param("name") name: string, @Body() dto: RollbackDto, @Req() req: any) {
    return this.locations.rollback(name, dto.toVersion, req.user.id, dto.reason);
  }
}
