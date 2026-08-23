import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

const BASES = ["delivered", "ex_works", "ex_depot"] as const;

export class CreateProducerDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(BASES) basis!: (typeof BASES)[number];
  @IsOptional() @IsBoolean() isSelf?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;

  @IsString() reason!: string;
  @IsOptional() @IsBoolean() submit?: boolean;
}

/** Only the fields actually being changed are sent. */
export class DraftProducerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(BASES) basis?: (typeof BASES)[number];
  @IsOptional() @IsBoolean() isSelf?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;

  @IsString() reason!: string;
  @IsOptional() @IsBoolean() submit?: boolean;
}
