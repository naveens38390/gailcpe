import { IsIn, IsISO8601, IsOptional, IsString, MinLength } from "class-validator";

/**
 * What an uploader tells us about the document they are attaching. Everything
 * else — size, type, storage key — is determined from the file itself.
 */
export class UploadCircularDto {
  @IsIn(["price", "freight"])
  kind!: "price" | "freight";

  @IsString()
  @MinLength(2)
  producer!: string;

  /** The producer's own reference, e.g. PE/2026-27/016. */
  @IsString()
  @MinLength(1)
  reference!: string;

  /** The date the circular takes effect, not the date it was uploaded. */
  @IsISO8601()
  effectiveDate!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
