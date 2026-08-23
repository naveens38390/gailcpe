import { IsObject, IsOptional, IsString } from "class-validator";

/** A key set to `null` deletes that producer's entry rather than setting it. */
export type ZoneMapPatch = Record<string, string | null>;

export class CreateLocationDto {
  @IsString() name!: string;
  @IsOptional() @IsString() sapCode?: string;

  /** { RIL: "SILVASSA", IOCL: "Dadra(Silvassa)", ... } */
  @IsOptional() @IsObject() producerZone?: ZoneMapPatch;
  @IsOptional() @IsObject() producerZoneTier?: ZoneMapPatch;
  @IsOptional() @IsObject() freightDestination?: ZoneMapPatch;

  @IsString() reason!: string;
  @IsOptional() submit?: boolean;
}

/**
 * Only the producers actually being changed are sent, not the whole map —
 * the service merges this against the location's current live mapping, so
 * fixing RIL's zone for one town never touches IOCL's or HMEL's.
 */
export class DraftLocationDto {
  @IsOptional() @IsString() sapCode?: string;
  @IsOptional() @IsObject() producerZone?: ZoneMapPatch;
  @IsOptional() @IsObject() producerZoneTier?: ZoneMapPatch;
  @IsOptional() @IsObject() freightDestination?: ZoneMapPatch;

  @IsString() reason!: string;
  @IsOptional() submit?: boolean;
}
