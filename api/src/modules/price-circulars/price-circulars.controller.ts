import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { Roles } from "../auth/roles.decorator";
import {
  BulkUpdateDto,
  CreateDraftDto,
  DraftReviewDto,
  RollbackCircularDto,
  UpdateRowDto,
} from "./dto/price-circular.dto";
import { PriceCircularsService } from "./price-circulars.service";

const PROPOSERS = ["territory_manager", "regional_manager", "corporate_pricing", "admin"] as const;
const REVIEWERS = ["regional_manager", "corporate_pricing", "admin"] as const;
const PUBLISHERS = ["corporate_pricing", "admin"] as const;

@ApiTags("price-circulars")
@Controller("price-circulars")
export class PriceCircularsController {
  constructor(private circulars: PriceCircularsService) {}

  @Get()
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Draft price circulars, newest first" })
  list(@Query("status") status?: string) {
    return this.circulars.list(status);
  }

  @Get(":id")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "One draft circular's header" })
  detail(@Param("id") id: string) {
    return this.circulars.detail(id);
  }

  @Get(":id/rows")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Every row in a draft circular" })
  rows(@Param("id") id: string) {
    return this.circulars.rows(id);
  }

  @Get(":id/diff")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "What changed in this draft versus the circular it was cloned from" })
  diff(@Param("id") id: string) {
    return this.circulars.diff(id);
  }

  @Post()
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Create a new draft circular, cloned from the current live price book" })
  create(@Body() dto: CreateDraftDto, @Req() req: any) {
    return this.circulars.create(
      dto.producer ?? "GAIL",
      dto.circularNumber,
      new Date(dto.effectiveDate),
      dto.reason,
      req.user.id,
    );
  }

  @Post(":id/rows/bulk")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Apply one price change to many selected rows at once" })
  bulkUpdate(@Param("id") id: string, @Body() dto: BulkUpdateDto) {
    return this.circulars.bulkUpdate(id, dto.rowIds, { type: dto.type, value: dto.value });
  }

  @Post(":id/rows/:rowId")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Edit one row's price — the Edit Drawer's save action" })
  updateRow(@Param("id") id: string, @Param("rowId") rowId: string, @Body() dto: UpdateRowDto) {
    return this.circulars.updateRow(id, rowId, dto.basicPrice);
  }

  @Post(":id/submit")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Submit a draft circular for review" })
  submit(@Param("id") id: string, @Req() req: any) {
    return this.circulars.submit(id, req.user.id);
  }

  @Post(":id/review")
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: "Approve or reject a circular under review" })
  review(@Param("id") id: string, @Body() dto: DraftReviewDto, @Req() req: any) {
    return this.circulars.review(id, req.user.id, dto.approve, dto.note);
  }

  @Post(":id/publish")
  @Roles(...PUBLISHERS)
  @ApiOperation({ summary: "Publish an approved draft — writes a real, live price circular" })
  publish(@Param("id") id: string, @Req() req: any) {
    return this.circulars.publish(id, req.user.id);
  }

  @Post("rollback")
  @Roles(...PUBLISHERS)
  @ApiOperation({ summary: "Reactivate a previously-published circular for a producer" })
  rollback(@Body() dto: RollbackCircularDto, @Req() req: any) {
    return this.circulars.rollbackCircular("GAIL", dto.circularId, req.user.id, dto.reason);
  }
}
