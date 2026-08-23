import { IsString, MinLength } from "class-validator";

export class RequestChangesDto {
  @IsString()
  @MinLength(5)
  note!: string;
}
