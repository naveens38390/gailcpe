import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateFreightDraftDto {
  @IsString() producer!: string;
  /** Optional: HMEL's and OPaL's freight schedules print no reference, and the
   * service assigns a descriptive one rather than inviting a made-up number. */
  @IsOptional() @IsString() circularNumber?: string;
  @IsString() effectiveDate!: string;
  @IsString() reason!: string;
}

export class UpdateFreightRowDto {
  @Type(() => Number) @IsNumber() ratePerMt!: number;
  @IsOptional() @Type(() => Number) @IsNumber() insurancePerMt?: number;
}

export class FreightBulkUpdateDto {
  @IsArray() @IsString({ each: true }) rowIds!: string[];
  @IsIn(["set", "delta", "percent"]) type!: "set" | "delta" | "percent";
  @Type(() => Number) @IsNumber() value!: number;
}

export class FreightDraftReviewDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() note?: string;
  /** Set by a reviewer who has been shown the unmapped-destination list. */
  @IsOptional() @IsBoolean() acknowledgeUnmapped?: boolean;
}

export class RollbackFreightCircularDto {
  @IsString() producer!: string;
  @IsString() circularId!: string;
  @IsString() reason!: string;
}
