import { Type } from "class-transformer";
import { IsIn, IsNumber, IsObject, IsOptional, IsString, Min } from "class-validator";

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

  /**
   * Producer -> the specific equivalent grade to quote instead of the
   * cheapest one Compare would otherwise pick for that producer.
   */
  @IsOptional()
  @IsObject()
  gradeOverrides?: Record<string, string>;

  /** The price list every producer is read from unless `basisOverrides` names it. */
  @IsOptional()
  @IsIn(["ex_works", "ex_depot"])
  pricingBasis?: "ex_works" | "ex_depot";

  /** Producer -> "ex_works" | "ex_depot": switch one producer's card to its other price list. */
  @IsOptional()
  @IsObject()
  basisOverrides?: Record<string, string>;
}
