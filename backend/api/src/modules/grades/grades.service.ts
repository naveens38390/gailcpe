import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import {
  Grade,
  GradeMapping,
} from "../../database/schemas/catalog.schema";
import { additiveBaseOf, normaliseGrade } from "../../core/pricing";

/**
 * Grade Finder.
 *
 * A customer rarely names a GAIL grade. They name what they buy today — an
 * IOCL or RIL code — so search has to work in both directions: GAIL grade to
 * equivalents, and competitor code back to the GAIL grade that substitutes.
 */
@Injectable()
export class GradesService {
  constructor(
    @InjectModel(Grade.name) private grades: Model<Grade>,
    @InjectModel(GradeMapping.name) private mappings: Model<GradeMapping>,
  ) {}

  /**
   * Free-text search over grade codes and what they are used for.
   *
   * Punctuation is ignored on the code path: the same grade is written HDT10 in
   * Haldia's circular and HDT-10 in the zonal workbook, and a punctuation-only
   * miss reads to the user as "we don't make that", which is much worse than a
   * slower query.
   */
  async search(term: string, limit = 25) {
    const trimmed = term.trim();
    if (!trimmed) return [];
    const folded = normaliseGrade(trimmed);

    // Retired grades never surface here, even on an exact code match —
    // nothing should nudge anyone toward a grade GAIL no longer wants sold.
    // Compare still honours a retired code typed directly, with a warning;
    // this is only the discovery path. Deprecated grades still show, just
    // ranked below an otherwise-equal active grade.
    const all = await this.mappings.find({ status: { $ne: "retired" } }).lean();
    const scored = all
      .map((m) => {
        const gail = normaliseGrade(m.gailGrade);
        const equivalents = Object.entries(m.equivalents ?? {}).flatMap(
          ([producer, codes]) => codes.map((code) => ({ producer, code })),
        );
        const equivalentHit = equivalents.find(
          (e) => normaliseGrade(e.code) === folded,
        );

        let score = 0;
        let matchedVia = "";
        if (gail === folded) {
          score = 100;
          matchedVia = "GAIL grade";
        } else if (equivalentHit) {
          score = 90;
          matchedVia = `${equivalentHit.producer} ${equivalentHit.code}`;
        } else if (gail.startsWith(folded)) {
          score = 70;
          matchedVia = "GAIL grade prefix";
        } else if (
          equivalents.some((e) => normaliseGrade(e.code).startsWith(folded))
        ) {
          score = 60;
          matchedVia = "competitor grade prefix";
        } else if (
          `${m.application} ${m.characteristic}`
            .toLowerCase()
            .includes(trimmed.toLowerCase())
        ) {
          score = 40;
          matchedVia = "application";
        }
        if (m.status === "deprecated" && score > 0) score -= 15;
        return { m, score, matchedVia };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(({ m, matchedVia }) => ({
      gailGrade: m.gailGrade,
      polymer: m.polymer,
      application: m.application,
      characteristic: m.characteristic,
      confidence: m.confidence,
      status: m.status,
      matchedVia,
    }));
  }

  /** Everything known about one GAIL grade and its substitutes. */
  async detail(gailGrade: string) {
    const folded = normaliseGrade(gailGrade);
    const all = await this.mappings.find().lean();
    const direct = all.find((m) => normaliseGrade(m.gailGrade) === folded);

    // An additive variant the sheet never wrote a row for is governed by its
    // base grade's row. Resolved the same way Compare and the quote engine
    // resolve it, so Grade Finder cannot disagree with the price ladder about
    // whether a variant has competitors.
    const base = direct ? null : additiveBaseOf(gailGrade);
    const inherited = base
      ? all.find((m) => normaliseGrade(m.gailGrade) === base)
      : undefined;
    const mapping = direct ?? inherited;

    if (!mapping) {
      throw new NotFoundException(
        `${gailGrade} is not in the cross-reference. Search by application to find a substitute.`,
      );
    }

    const priced = await this.grades.find({}).lean();
    const isPriced = new Set(
      priced.map((g) => `${g.producer}|${normaliseGrade(g.code)}`),
    );

    return {
      // Answer about the code that was asked for, not the row governing it.
      gailGrade: inherited ? gailGrade : mapping.gailGrade,
      polymer: mapping.polymer,
      section: mapping.section,
      application: mapping.application,
      characteristic: inherited
        ? `${mapping.characteristic} (NA additive)`
        : mapping.characteristic,
      process: mapping.process,
      mfi: mapping.mfi,
      density: mapping.density,
      confidence: mapping.confidence,
      status: mapping.status,
      international: mapping.international,
      equivalents: Object.entries(mapping.equivalents ?? {}).map(
        ([producer, codes]) => ({
          producer,
          codes: codes.map((code) => ({
            code,
            // A grade in the 2023 cross-reference may not exist in the current
            // circular. Saying so is the difference between a quote and a
            // promise the officer cannot keep.
            inCurrentCircular: isPriced.has(
              `${producer}|${normaliseGrade(code)}`,
            ),
          })),
        }),
      ),
      caveat:
        mapping.confidence && mapping.confidence !== "H"
          ? `Mapping confidence is ${mapping.confidence}. Confirm the substitution with technical services before quoting.`
          : null,
    };
  }
}
