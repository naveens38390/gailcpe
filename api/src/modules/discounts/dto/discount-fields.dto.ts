import { Type } from "class-transformer";
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";

export class QuantitySlabDto {
  @IsNumber() from_mt!: number;
  @IsOptional() @IsNumber() to_mt?: number | null;
  @IsNumber() rate_per_mt!: number;
}

export class CreateDiscountTermsDto {
  @IsString() producer!: string;

  @IsOptional() @Type(() => Number) @IsNumber() cashDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() cashDiscountLdpe?: number;
  @IsOptional() @Type(() => Number) @IsNumber() earlyPaymentPerDay?: number;
  @IsOptional() @Type(() => Number) @IsNumber() earlyPaymentMaxDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() interestFreeCreditDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() dealerDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() metalloceneQdCap?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuantitySlabDto)
  quantitySlabs?: QuantitySlabDto[];

  @IsString() reason!: string;
  @IsOptional() submit?: boolean;
}

/** Only the fields actually being changed are sent. */
export class DraftDiscountTermsDto {
  @IsOptional() @Type(() => Number) @IsNumber() cashDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() cashDiscountLdpe?: number;
  @IsOptional() @Type(() => Number) @IsNumber() earlyPaymentPerDay?: number;
  @IsOptional() @Type(() => Number) @IsNumber() earlyPaymentMaxDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() interestFreeCreditDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() dealerDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() metalloceneQdCap?: number;

  /** The whole table, when touched — a quantity slab schedule replaces as a unit. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuantitySlabDto)
  quantitySlabs?: QuantitySlabDto[];

  @IsString() reason!: string;
  @IsOptional() submit?: boolean;
}
