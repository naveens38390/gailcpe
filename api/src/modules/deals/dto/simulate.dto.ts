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

  @IsOptional()
  @IsString()
  asOf?: string;
}
