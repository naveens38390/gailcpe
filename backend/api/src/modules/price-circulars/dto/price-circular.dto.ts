import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateDraftDto {
  @IsOptional() @IsString() producer?: string; // defaults to "GAIL"
  @IsString() circularNumber!: string;
  @IsString() effectiveDate!: string;
  @IsString() reason!: string;
}

export class UpdateRowDto {
  @Type(() => Number)
  @IsNumber()
  basicPrice!: number;
}

export class BulkUpdateDto {
  @IsArray() @IsString({ each: true }) rowIds!: string[];
  @IsIn(["set", "delta", "percent"]) type!: "set" | "delta" | "percent";
  @Type(() => Number) @IsNumber() value!: number;
}

export class DraftReviewDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() note?: string;
}

export class RollbackCircularDto {
  @IsString() circularId!: string;
  @IsString() reason!: string;
}
