import { Type } from "class-transformer";
import { IsBoolean, IsNumber, IsOptional, IsString } from "class-validator";

/** Shared across every master-data module's review endpoint. */
export class ReviewDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

/** Shared across every master-data module's rollback endpoint. */
export class RollbackDto {
  @Type(() => Number)
  @IsNumber()
  toVersion!: number;

  @IsString()
  reason!: string;
}
