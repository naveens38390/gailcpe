import { Type } from "class-transformer";
import { IsNumber, IsString, Min, MinLength } from "class-validator";

export class ProposeCorrectionDto {
  @IsString()
  grade!: string;

  @IsString()
  location!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  proposedPrice!: number;

  @IsString()
  @MinLength(10)
  reason!: string;
}
