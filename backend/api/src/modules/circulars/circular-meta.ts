/**
 * Read a circular's producer, effective date and kind out of its text and file name, so a whole
 * round's documents can be filed in one upload.
 *
 * Like the reference detector, this only fills in what a person would otherwise type. A miss
 * leaves the field empty and the file is reported back as needing input, never filed with a guess:
 * a wrong producer or date silently files a document against the wrong round.
 */

export type CircularKind = "price" | "freight";

export interface DetectedMeta {
  producer: string | null;
  effectiveDate: string | null; // YYYY-MM-DD
  kind: CircularKind;
  /**
   * A second document for a producer that already has a primary price list in the round —
   * GAIL's Stock Point list, OPaL's CSA list. Filed for the record; its prices travel with the
   * primary circular's reading, so it is never given a reading of its own.
   */
  secondary: boolean;
  notes: string[];
}

/** Most specific first: a name that contains another producer's short code must win. */
const PRODUCER_PATTERNS: [string, RegExp][] = [
  ["HPL", /haldia\s+petrochemicals|\bHPL\b/i],
  ["HMEL", /HPCL[\s-]*Mittal|\bHMEL\b/i],
  ["OPaL", /ONGC\s+Petro[\s-]*additions|\bOPaL\b/i],
  ["IOCL", /Indian\s+Oil|\bIOCL\b|\bIOC\b/i],
  ["RIL", /Reliance\s+Industries|\bRIL\b/i],
  ["GAIL", /\bGAIL\b/i],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // 30 February and the like
  return date.toISOString().slice(0, 10);
}

/** Every date written in one of the forms the producers use, in the order they appear. */
export function datesIn(text: string): { date: string; index: number }[] {
  const out: { date: string; index: number }[] = [];
  const push = (index: number, v: string | null) => { if (v) out.push({ date: v, index }); };
  const month = (s: string) => MONTHS[s.toLowerCase().slice(0, s.toLowerCase().startsWith("sept") ? 4 : 3)];
  // 16.09.2026, 16/09/2026, 16-09-2026
  for (const m of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/g)) push(m.index!, iso(+m[3], +m[2], +m[1]));
  // September 16, 2026 / Sept 16 2026
  for (const m of text.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(20\d{2})\b/gi))
    push(m.index!, month(m[1]) ? iso(+m[3], month(m[1])!, +m[2]) : null);
  // 16 Sept 2026 / 01st SEPT 2026 / 1st August 2026
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?,?\s+(20\d{2})\b/gi))
    push(m.index!, month(m[2]) ? iso(+m[3], month(m[2])!, +m[1]) : null);
  return out.sort((a, b) => a.index - b.index);
}

/** The date after "w.e.f." / "with effect from" / "effective" if there is one; else the first date. */
export function effectiveDateIn(text: string): string | null {
  const dates = datesIn(text);
  if (!dates.length) return null;
  for (const cue of text.matchAll(/w\.?\s*e\.?\s*f\.?|with\s+effect\s+from|eff(?:ective)?\.?\s*(?:from|date)|effective/gi)) {
    const next = dates.find((d) => d.index >= cue.index! && d.index - cue.index! < 80);
    if (next) return next.date;
  }
  return dates[0]!.date;
}

export function detectMeta(text: string, filename: string, producers: string[]): DetectedMeta {
  const notes: string[] = [];
  const name = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ");
  const known = new Set(producers);

  // Producer: the file name is the stronger signal (people name files after the producer);
  // the document text breaks a tie or fills the gap.
  let producer: string | null = null;
  for (const [code, re] of PRODUCER_PATTERNS) if (known.has(code) && re.test(name)) { producer = code; break; }
  if (!producer) {
    const scores = PRODUCER_PATTERNS.filter(([code]) => known.has(code))
      .map(([code, re]) => ({ code, n: (text.match(new RegExp(re.source, "gi")) ?? []).length }))
      .filter((s) => s.n > 0)
      .sort((a, b) => b.n - a.n);
    if (scores.length) {
      producer = scores[0]!.code;
      if (scores[1] && scores[1].n === scores[0]!.n) {
        notes.push(`Producer is ambiguous (${scores[0]!.code} / ${scores[1].code}); check it.`);
        producer = null;
      }
    }
  }
  if (!producer) notes.push("Producer could not be detected.");

  // Only the file name or the document's title decides: price circulars mention freight in their notes.
  const kind: CircularKind = /freight/i.test(name) || /freight\s+(?:rate|circular)/i.test(text.slice(0, 300)) ? "freight" : "price";

  const effectiveDate = effectiveDateIn(`${name}\n${text}`) ?? null;
  if (!effectiveDate) notes.push("Effective date could not be detected.");

  const secondary =
    kind === "price" &&
    ((producer === "GAIL" && /stock\s*point/i.test(`${name} ${text.slice(0, 2000)}`)) ||
      (producer === "OPaL" && /\bCSA\b/i.test(name)));
  if (secondary) notes.push("Filed for the record only: its prices come with the producer's main circular.");

  return { producer, effectiveDate, kind, secondary, notes };
}
