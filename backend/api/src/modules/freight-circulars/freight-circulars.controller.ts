import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import {
  CreateFreightDraftDto,
  FreightBulkUpdateDto,
  FreightDraftReviewDto,
  RollbackFreightCircularDto,
  UpdateFreightRowDto,
} from "./dto/freight-circular.dto";
import { FreightCircularsService } from "./freight-circulars.service";

@ApiTags("freight-circulars")
@Controller("freight-circulars")
export class FreightCircularsController {
  constructor(private circulars: FreightCircularsService) {}

  @Get()
  @ApiOperation({ summary: "Draft freight circulars, newest first" })
  list(@Query("status") status?: string) {
    return this.circulars.list(status);
  }

  @Get("producers")
  @ApiOperation({ summary: "Producers with a live freight book to draft against" })
  producers() {
    return this.circulars.producers();
  }

  @Get(":id")
  @ApiOperation({ summary: "One draft freight circular's header" })
  detail(@Param("id") id: string) {
    return this.circulars.detail(id);
  }

  @Get(":id/rows")
  @ApiOperation({ summary: "Every destination in a draft freight circular" })
  rows(@Param("id") id: string) {
    return this.circulars.rows(id);
  }

  @Get(":id/diff")
  @ApiOperation({
    summary:
      "What changed versus the live book — rates moved, destinations added or dropped, and any left unmapped",
  })
  diff(@Param("id") id: string) {
    return this.circulars.diff(id);
  }

  @Post()
  @ApiOperation({ summary: "New draft freight circular, cloned from the live freight book" })
  create(@Body() dto: CreateFreightDraftDto, @Req() req: any) {
    return this.circulars.create(
      dto.producer,
      dto.circularNumber,
      new Date(dto.effectiveDate),
      dto.reason,
      req.user.id,
    );
  }

  @Post(":id/rows/bulk")
  @ApiOperation({ summary: "Apply one rate change to many selected destinations at once" })
  bulkUpdate(@Param("id") id: string, @Body() dto: FreightBulkUpdateDto) {
    return this.circulars.bulkUpdate(id, dto.rowIds, { type: dto.type, value: dto.value });
  }

  @Post(":id/rows/:rowId")
  @ApiOperation({ summary: "Edit one destination's rate" })
  updateRow(
    @Param("id") id: string,
    @Param("rowId") rowId: string,
    @Body() dto: UpdateFreightRowDto,
  ) {
    return this.circulars.updateRow(id, rowId, dto.ratePerMt, dto.insurancePerMt);
  }

  @Post(":id/submit")
  @ApiOperation({ summary: "Submit a draft freight circular for review" })
  submit(@Param("id") id: string, @Req() req: any) {
    return this.circulars.submit(id, req.user.id);
  }

  @Post(":id/review")
  @ApiOperation({
    summary:
      "Approve or reject. Approving a circular with unmapped destinations requires acknowledging them",
  })
  review(@Param("id") id: string, @Body() dto: FreightDraftReviewDto, @Req() req: any) {
    return this.circulars.review(
      id,
      req.user.id,
      dto.approve,
      dto.note,
      dto.acknowledgeUnmapped,
    );
  }

  @Post(":id/publish")
  @ApiOperation({ summary: "Publish an approved draft — writes a real, live freight circular" })
  publish(@Param("id") id: string, @Req() req: any) {
    return this.circulars.publish(id, req.user.id);
  }

  @Post("rollback")
  @ApiOperation({ summary: "Reactivate a previously-published freight circular" })
  rollback(@Body() dto: RollbackFreightCircularDto, @Req() req: any) {
    return this.circulars.rollbackCircular(
      dto.producer,
      dto.circularId,
      req.user.id,
      dto.reason,
    );
  }
}
