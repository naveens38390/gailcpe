import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { Roles } from "../auth/roles.decorator";
import { ReviewDto, RollbackDto } from "../master-data/dto/review.dto";
import { CreateGradeDto, DraftGradeDto } from "./dto/grade-fields.dto";
import { GradeAdminService } from "./grade-admin.service";
import { GradesService } from "./grades.service";

const PROPOSERS = ["territory_manager", "regional_manager", "corporate_pricing", "admin"] as const;
const REVIEWERS = ["regional_manager", "corporate_pricing", "admin"] as const;
const PUBLISHERS = ["corporate_pricing", "admin"] as const;

@ApiTags("grades")
@Controller("grades")
export class GradesController {
  constructor(
    private grades: GradesService,
    private admin: GradeAdminService,
  ) {}

  @Get("search")
  @ApiOperation({
    summary: "Search grades by GAIL code, competitor code, or application",
  })
  search(@Query("q") q = "", @Query("limit") limit?: string) {
    return this.grades.search(q, limit ? Number(limit) : undefined);
  }

  @Get("revisions/pending")
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: "Grade changes awaiting review, approval, or publish" })
  pending() {
    return this.admin.pending();
  }

  @Get(":gailGrade")
  @ApiOperation({ summary: "Equivalent grades across all six producers" })
  detail(@Param("gailGrade") gailGrade: string) {
    return this.grades.detail(gailGrade);
  }

  @Get(":gailGrade/history")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Every revision ever proposed for one grade" })
  history(@Param("gailGrade") gailGrade: string) {
    return this.admin.history(gailGrade);
  }

  @Get(":gailGrade/diff")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "What changed between two published versions" })
  diff(
    @Param("gailGrade") gailGrade: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.admin.diff(gailGrade, Number(from), Number(to));
  }

  @Get(":gailGrade/impact")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Recent comparisons and simulations that resolved this grade" })
  impact(@Param("gailGrade") gailGrade: string) {
    return this.admin.impact(gailGrade);
  }

  @Post()
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Propose a new grade mapping" })
  create(@Body() dto: CreateGradeDto, @Req() req: any) {
    return this.admin.create(dto, req.user.id);
  }

  @Post(":gailGrade/draft")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Propose a change to an existing grade mapping" })
  draft(@Param("gailGrade") gailGrade: string, @Body() dto: DraftGradeDto, @Req() req: any) {
    return this.admin.draft(gailGrade, dto, req.user.id);
  }

  @Post("revisions/:id/submit")
  @Roles(...PROPOSERS)
  @ApiOperation({ summary: "Submit a saved draft for review" })
  submit(@Param("id") id: string, @Req() req: any) {
    return this.admin.submit(id, req.user.id);
  }

  @Post("revisions/:id/review")
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: "Approve or reject a revision under review" })
  review(@Param("id") id: string, @Body() dto: ReviewDto, @Req() req: any) {
    return this.admin.review(id, req.user.id, dto.approve, dto.note);
  }

  @Post("revisions/:id/publish")
  @Roles(...PUBLISHERS)
  @ApiOperation({ summary: "Publish an approved revision — makes it live" })
  publish(@Param("id") id: string, @Req() req: any) {
    return this.admin.publish(id, req.user.id);
  }

  @Post(":gailGrade/rollback")
  @Roles(...PUBLISHERS)
  @ApiOperation({ summary: "Restore a prior published version" })
  rollback(@Param("gailGrade") gailGrade: string, @Body() dto: RollbackDto, @Req() req: any) {
    return this.admin.rollback(gailGrade, dto.toVersion, req.user.id, dto.reason);
  }
}
