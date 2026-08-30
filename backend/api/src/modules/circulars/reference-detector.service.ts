/**
 * Read a circular's own reference number out of the document.
 *
 * Every producer labels it differently — "Circular No.: PEPL/2026-2027/16" for
 * IOCL, "Ref. : HMEL/Marketing/PE/2026-27/15" for HMEL, a bare
 * "Circular HPL / PM / 26-27 / 38" for HPL's freight sheet — so the patterns
 * here were derived by reading the eleven real circulars rather than guessed.
 *
 * This only fills a form field. A wrong reading is corrected by the person
 * filing, and a missing one leaves them exactly where they were, so the bar is
 * "useful more often than not" rather than the certainty the pricing paths
 * demand. It never blocks a filing.
 *
 * Node-only by design: the settled architecture keeps Python out of the API,
 * and reading one line of text is not a reason to reopen that.
 */

import { Injectable, Logger } from "@nestjs/common";

/** Labels a producer puts in front of the number, most explicit first. */
const LABELLED = [
  /circular\s*no\.?\s*:?\s*([A-Za-z0-9][A-Za-z0-9 /_-]{4,60})/i,
  /\bref\.?\s*:\s*([A-Za-z0-9][A-Za-z0-9 /_-]{4,60})/i,
  /\bcircular\s+([A-Z]{2,6}\s*\/[A-Za-z0-9 /_-]{4,50})/,
];

/**
 * A reference with no label in front of it. Deliberately demanding — at least
 * two slash-separated groups and a digit — because a loose pattern here would
 * happily match a grade code or a location and quietly prefill nonsense.
 */
const BARE = /\b([A-Z]{2,6}\s*\/\s*[A-Za-z0-9-]{2,20}(?:\s*\/\s*[A-Za-z0-9-]{1,20}){1,3})\b/;

export interface DetectedReference {
  reference: string | null;
  /** How it was found, for the report and for explaining a bad guess. */
  method: "labelled" | "bare" | "none";
  /** The line it came from, so a reviewer can sanity-check it. */
  context?: string;
}

@Injectable()
export class ReferenceDetectorService {
  private readonly logger = new Logger(ReferenceDetectorService.name);

  async detect(buffer: Buffer): Promise<DetectedReference> {
    const text = await this.readText(buffer);
    if (!text) return { reference: null, method: "none" };

    const lines = text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    for (const line of lines) {
      for (const pattern of LABELLED) {
        const hit = pattern.exec(line);
        if (hit?.[1]) {
          const ref = tidy(hit[1]);
          if (plausible(ref)) return { reference: ref, method: "labelled", context: line.slice(0, 120) };
        }
      }
    }

    // Nothing labelled; accept a strongly-shaped reference on its own.
    for (const line of lines) {
      const hit = BARE.exec(line);
      if (hit?.[1]) {
        const ref = tidy(hit[1]);
        if (plausible(ref)) return { reference: ref, method: "bare", context: line.slice(0, 120) };
      }
    }

    return { reference: null, method: "none" };
  }

  /**
   * First two pages, then the last. Producers put the reference in a header or
   * a footer and almost nowhere else, and reading the whole of a 108-page
   * annexure to find one line would cost seconds for nothing.
   */
  private async readText(buffer: Buffer): Promise<string> {
    try {
      // Required lazily: the API must still boot if the optional parser is
      // missing, because nothing else depends on it.
      const { PDFParse } = await import("pdf-parse");
      const head = new PDFParse({ data: buffer });
      const first = (await head.getText({ first: 2 })).text ?? "";
      await head.destroy?.();

      const tail = new PDFParse({ data: buffer });
      const last = (await tail.getText({ last: 1 })).text ?? "";
      await tail.destroy?.();

      return `${first}\n${last}`;
    } catch (e) {
      // A scanned or malformed document is a normal outcome here, not a fault.
      this.logger.warn(`could not read text for reference detection: ${e instanceof Error ? e.message : e}`);
      return "";
    }
  }
}

/** Collapse the spaces producers sprinkle around slashes: "HPL / PM / 26-27". */
function tidy(raw: string): string {
  return raw
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim();
}

/**
 * Reject the things that look like references and are not — a bare year, a
 * grade code, a fragment with no digits at all.
 */
function plausible(ref: string): boolean {
  if (ref.length < 6 || ref.length > 60) return false;
  if (!/\//.test(ref)) return false;
  if (!/\d/.test(ref)) return false;
  // At least two slash-separated parts carrying something.
  return ref.split("/").filter((p) => p.trim().length).length >= 2;
}
