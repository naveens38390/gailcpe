import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { ReviewDto, RollbackDto } from "../master-data/dto/review.dto";
import { DiscountAdminService } from "./discount-admin.service";
import { CreateDiscountTermsDto, DraftDiscountTermsDto } from "./dto/discount-fields.dto";

@ApiTags("discounts")
@Controller("discounts")
export class DiscountsController {
  constructor(private discounts: DiscountAdminService) {}

  @Get()
  @ApiOperation({ summary: "Live discount terms — one row per producer, GAIL today" })
  list() {
    return this.discounts.list();
  }

  @Get("revisions/pending")
  @ApiOperation({ summary: "Discount changes awaiting review, approval, or publish" })
  pending() {
    return this.discounts.pending();
  }

  @Get(":producer/history")
  @ApiOperation({ summary: "Every revision ever proposed for one producer's discount terms" })
  history(@Param("producer") producer: string) {
    return this.discounts.history(producer);
  }

  @Get(":producer/diff")
  @ApiOperation({ summary: "What changed between two published versions" })
  diff(@Param("producer") producer: string, @Query("from") from: string, @Query("to") to: string) {
    return this.discounts.diff(producer, Number(from), Number(to));
  }

  @Get(":producer/impact")
  @ApiOperation({ summary: "Recent comparisons and simulations affected by these terms" })
  impact(@Param("producer") producer: string) {
    return this.discounts.impact(producer);
  }

  @Post()
  @ApiOperation({ summary: "Propose discount terms for a producer that doesn't have any yet" })
  create(@Body() dto: CreateDiscountTermsDto, @Req() req: any) {
    return this.discounts.create(dto, req.user.id);
  }

  @Post(":producer/draft")
  @ApiOperation({ summary: "Propose a change to a producer's discount terms" })
  draft(@Param("producer") producer: string, @Body() dto: DraftDiscountTermsDto, @Req() req: any) {
    return this.discounts.draft(producer, dto, req.user.id);
  }

  @Post("revisions/:id/submit")
  @ApiOperation({ summary: "Submit a saved draft for review" })
  submit(@Param("id") id: string, @Req() req: any) {
    return this.discounts.submit(id, req.user.id);
  }

  @Post("revisions/:id/review")
  @ApiOperation({ summary: "Approve or reject a revision under review" })
  review(@Param("id") id: string, @Body() dto: ReviewDto, @Req() req: any) {
    return this.discounts.review(id, req.user.id, dto.approve, dto.note);
  }

  @Post("revisions/:id/publish")
  @ApiOperation({ summary: "Publish an approved revision — makes it live" })
  publish(@Param("id") id: string, @Req() req: any) {
    return this.discounts.publish(id, req.user.id);
  }

  @Post(":producer/rollback")
  @ApiOperation({ summary: "Restore a prior published version" })
  rollback(@Param("producer") producer: string, @Body() dto: RollbackDto, @Req() req: any) {
    return this.discounts.rollback(producer, dto.toVersion, req.user.id, dto.reason);
  }
}
