/**
 * Reference data: who sells, what they sell, and where.
 *
 * Every price-bearing document is versioned by `effectiveDate` rather than
 * overwritten. New circulars arrive monthly and an officer defending a quote
 * needs the circular that was live on the day they quoted, not today's.
 */

import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type PriceBasis = "delivered" | "ex_works" | "ex_depot";

/**
 * "active" is comparable and searchable by default. "deprecated" still
 * compares (a customer may still order it) but is flagged, and Grade Finder
 * de-prioritises it. "retired" is excluded from Grade Finder and produces a
 * warning if compared directly — never deleted, because a comparison run
 * last quarter against a since-retired grade still has to stay defensible.
 */
export type GradeStatus = "active" | "deprecated" | "retired";

/** How a customer location was matched to a producer's pricing zone. */
export type LocationTier =
  | "exact"
  | "alias"
  | "evidence"
  | "published_map"
  | "inferred_via_hpl"
  | "unresolved";

@Schema({ collection: "producers", timestamps: true })
export class Producer {
  @Prop({ required: true, unique: true, index: true })
  code!: string; // GAIL, RIL, IOCL, HMEL, OPaL, HPL

  @Prop({ required: true })
  name!: string;

  /**
   * Decides whether freight is added to this producer's published price.
   * RIL and IOCL quote delivered; the rest quote ex-works.
   */
  @Prop({ required: true })
  basis!: PriceBasis;

  @Prop({ default: false })
  isSelf!: boolean; // true for GAIL — the "us" in every comparison

  /**
   * Retiring a producer here removes it from every comparison and freight
   * lookup with no code change — DatasetService excludes it when loading the
   * live round. Onboarding a genuinely new producer's own circulars is still
   * an ETL job; this only governs producers whose price data already exists.
   */
  @Prop({ default: true, index: true })
  active!: boolean;

  /** Which published revision this row reflects — see ProducerRevision. */
  @Prop({ type: Types.ObjectId })
  currentRevision?: Types.ObjectId;

  @Prop({ default: 0 })
  currentVersion!: number;
}

@Schema({ collection: "grades", timestamps: true })
export class Grade {
  @Prop({ required: true, index: true })
  code!: string;

  @Prop({ required: true, index: true })
  producer!: string;

  @Prop() polymer?: string; // HDPE / LLDPE
  @Prop() application?: string; // Blow Moulding, Film, Pipe, ...
  @Prop() characteristic?: string;
  @Prop() process?: string;
  @Prop() mfi?: string;
  @Prop() density?: string;
}

@Schema({ collection: "gradeMappings", timestamps: true })
export class GradeMapping {
  @Prop({ required: true, unique: true, index: true })
  gailGrade!: string;

  @Prop() polymer?: string;
  @Prop() section?: string;
  @Prop() application?: string;
  @Prop() characteristic?: string;
  @Prop() process?: string;
  @Prop() mfi?: string;
  @Prop() density?: string;

  /** { RIL: ["54GB012", "B56003"], IOCL: ["012DB54"], ... } */
  @Prop({ type: Object, default: {} })
  equivalents!: Record<string, string[]>;

  @Prop({ type: [String], default: [] })
  international!: string[];

  /**
   * H / M / L from the cross-reference sheet. Carried to every quote: the
   * mapping was last revised Dec-2023 and is being used against Aug-2026
   * circulars, so a low-confidence row is a real caveat, not decoration.
   */
  @Prop({ index: true })
  confidence?: string;

  @Prop() sourceReference?: string;

  @Prop({ type: String, default: "active", index: true })
  status!: GradeStatus;

  /** Which published revision this row reflects — see GradeRevision. */
  @Prop({ type: Types.ObjectId })
  currentRevision?: Types.ObjectId;

  @Prop({ default: 0 })
  currentVersion!: number;
}

@Schema({ collection: "locations", timestamps: true })
export class Location {
  /** GAIL's own ex-works location name — what a sales officer types. */
  @Prop({ required: true, unique: true, index: true })
  name!: string;

  @Prop() sapCode?: string;

  /** { IOCL: "Mumbai", RIL: "MUMBAI", HPL: "Maharashtra_Mumbai", ... } */
  @Prop({ type: Object, default: {} })
  producerZone!: Record<string, string>;

  /** How each of those was arrived at, so the UI can flag inferences. */
  @Prop({ type: Object, default: {} })
  producerZoneTier!: Record<string, LocationTier>;

  /** { HMEL: "Panaji", HPL: "PANAJI", ... } — freight is billed by its own name. */
  @Prop({ type: Object, default: {} })
  freightDestination!: Record<string, string>;
}

export type ProducerDocument = HydratedDocument<Producer>;
export type GradeDocument = HydratedDocument<Grade>;
export type GradeMappingDocument = HydratedDocument<GradeMapping>;
export type LocationDocument = HydratedDocument<Location>;

export const ProducerSchema = SchemaFactory.createForClass(Producer);
export const GradeSchema = SchemaFactory.createForClass(Grade);
export const GradeMappingSchema = SchemaFactory.createForClass(GradeMapping);
export const LocationSchema = SchemaFactory.createForClass(Location);

GradeSchema.index({ code: 1, producer: 1 }, { unique: true });
// Grade Finder searches by code and by what the grade is for.
GradeSchema.index({ code: "text", application: "text", characteristic: "text" });
GradeMappingSchema.index({ gailGrade: "text", application: "text" });
LocationSchema.index({ name: "text" });
