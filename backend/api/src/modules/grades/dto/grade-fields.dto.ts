import { IsArray, IsIn, IsObject, IsOptional, IsString } from "class-validator";

const STATUSES = ["active", "deprecated", "retired"] as const;
const CONFIDENCE = ["H", "M", "L"] as const;

/** A producer set to null removes its whole equivalents list rather than setting it. */
export type EquivalentsPatch = Record<string, string[] | null>;

export class CreateGradeDto {
  @IsString() gailGrade!: string;
  @IsOptional() @IsString() polymer?: string;
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() application?: string;
  @IsOptional() @IsString() characteristic?: string;
  @IsOptional() @IsString() process?: string;
  @IsOptional() @IsString() mfi?: string;
  @IsOptional() @IsString() density?: string;
  @IsOptional() @IsIn(CONFIDENCE) confidence?: (typeof CONFIDENCE)[number];
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsObject() equivalents?: EquivalentsPatch;
  @IsOptional() @IsArray() international?: string[];

  @IsString() reason!: string;
  @IsOptional() submit?: boolean;
}

/** Only the fields actually being changed are sent. */
export class DraftGradeDto {
  @IsOptional() @IsString() polymer?: string;
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() application?: string;
  @IsOptional() @IsString() characteristic?: string;
  @IsOptional() @IsString() process?: string;
  @IsOptional() @IsString() mfi?: string;
  @IsOptional() @IsString() density?: string;
  @IsOptional() @IsIn(CONFIDENCE) confidence?: (typeof CONFIDENCE)[number];
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];

  /** Only the producers being changed — merged against the live mapping. */
  @IsOptional() @IsObject() equivalents?: EquivalentsPatch;
  @IsOptional() @IsArray() international?: string[];

  @IsString() reason!: string;
  @IsOptional() submit?: boolean;
}
