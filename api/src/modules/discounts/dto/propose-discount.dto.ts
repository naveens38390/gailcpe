import { Type } from "class-transformer";
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";

export class QuantitySlabDto {
  @IsNumber() from_mt!: number;
  @IsOptional() @IsNumber() to_mt?: number | null;
  @IsNumber() rate_per_mt!: number;
}

/**
 * Only the fields actually being changed are sent — an officer proposing a
 * cash-discount fix should not also have to restate the quantity slabs.
 */
export class ProposeDiscountDto {
  @IsOptional() @Type(() => Number) @IsNumber() cashDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() cashDiscountLdpe?: number;
  @IsOptional() @Type(() => Number) @IsNumber() earlyPaymentPerDay?: number;
  @IsOptional() @Type(() => Number) @IsNumber() earlyPaymentMaxDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() interestFreeCreditDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() dealerDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() metalloceneQdCap?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuantitySlabDto)
  quantitySlabs?: QuantitySlabDto[];

  @IsString()
  @MinLength(10)
  reason!: string;
}
