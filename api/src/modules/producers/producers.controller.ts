import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { Roles } from "../auth/roles.decorator";
import { ReviewDto, RollbackDto } from "../master-data/dto/review.dto";
import { CreateProducerDto, DraftProducerDto } from "./dto/producer-fields.dto";
import { ProducersService } from "./producers.service";

const PROPOSERS = ["territory_manager", "regional_manager", "corporate_pricing", "admin"] as const;
const REVIEWERS = ["regional_manager", "corporate_pricing", "admin"] as const;
const PUBLISHERS = ["corporate_pricing", "admin"] as const;

@ApiTags("producers")
@Controller("producers")
export class ProducersController {
  constructor(private producers: ProducersService) {}

  @Get()
  @ApiOperation({ summary: "Live, published producers" })
  list() {
    return this.producers.list();
  }

  @Get("revisions/pending")
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: "Producer changes awaiting review, approval, or publish" })
  pending() {
    return this.producers.pending();
  }

  @Get(":code/history")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Every revision ever proposed for one producer" })
  history(@Param("code") code: string) {
    return this.producers.history(code);
  }

  @Get(":code/diff")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "What changed between two published versions" })
  diff(
    @Param("code") code: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.producers.diff(code, Number(from), Number(to));
  }

  @Post()
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Propose a new producer" })
  create(@Body() dto: CreateProducerDto, @Req() req: any) {
    return this.producers.create(dto, req.user.id);
  }

  @Post(":code/draft")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Propose a change to an existing producer" })
  draft(@Param("code") code: string, @Body() dto: DraftProducerDto, @Req() req: any) {
    return this.producers.draft(code, dto, req.user.id);
  }

  @Post("revisions/:id/submit")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Submit a saved draft for review" })
  submit(@Param("id") id: string, @Req() req: any) {
    return this.producers.submit(id, req.user.id);
  }

  @Post("revisions/:id/review")
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: "Approve or reject a revision under review" })
  review(@Param("id") id: string, @Body() dto: ReviewDto, @Req() req: any) {
    return this.producers.review(id, req.user.id, dto.approve, dto.note);
  }

  @Post("revisions/:id/publish")
  @Roles(...PUBLISHERS)
  @ApiOperation({ summary: "Publish an approved revision — makes it live" })
  publish(@Param("id") id: string, @Req() req: any) {
    return this.producers.publish(id, req.user.id);
  }

  @Post(":code/rollback")
  @Roles(...PUBLISHERS)
  @ApiOperation({ summary: "Restore a prior published version" })
  rollback(@Param("code") code: string, @Body() dto: RollbackDto, @Req() req: any) {
    return this.producers.rollback(code, dto.toVersion, req.user.id, dto.reason);
  }
}
