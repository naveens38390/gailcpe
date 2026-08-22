import { Type } from "class-transformer";
import { IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CompareDto {
  @IsString()
  grade!: string;

  @IsString()
  location!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantityMt!: number;

  @IsIn(["cash", "credit_ifc"])
  paymentMode!: "cash" | "credit_ifc";

  /** Price as of a past date — for defending a quote already given. */
  @IsOptional()
  @IsString()
  asOf?: string;
}
