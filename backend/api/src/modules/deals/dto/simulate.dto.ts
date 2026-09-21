import { Type } from "class-transformer";
import { IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class SimulateDto {
  @IsOptional()
  @IsString()
  customer?: string;

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

  /** The price list every producer is read from; ex works when omitted. */
  @IsOptional()
  @IsIn(["ex_works", "ex_depot"])
  pricingBasis?: "ex_works" | "ex_depot";

  @IsOptional()
  @IsString()
  asOf?: string;
}
