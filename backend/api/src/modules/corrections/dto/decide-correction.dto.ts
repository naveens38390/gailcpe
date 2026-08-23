import { IsBoolean, IsOptional, IsString } from "class-validator";

export class DecideCorrectionDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
