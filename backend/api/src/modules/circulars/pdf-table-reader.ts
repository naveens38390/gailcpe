/**
 * Row-safe PDF table reading — the Node counterpart of `backend/etl/pdfrows.py`.
 *
 * Plain text extraction (`pdftotext -layout`, and `pdf-parse`'s own `getText`)
 * silently shifts right-hand column groups by one row on these circulars,
 * because rows have uneven baseline spacing. A shifted price reads exactly
 * like a correct one, which is why the ETL abandoned text extraction for
 * word-coordinate reconstruction — grouping words into rows by their vertical
 * position, then into columns by their horizontal position, the same way a
 * person reading the page would. This is that same technique, ported rather
 * than reinvented, using `pdfjs-dist` (already installed as `pdf-parse`'s own
 * engine) for the per-word positions `pdf-parse`'s own API does not expose.
 *
 * `pdf-parse`'s built-in `getTable()` was considered and rejected: it detects
 * tables from vector-drawn grid lines, and a typeset circular with no ruled
 * borders gives it nothing to find.
 */

// Required lazily throughout, matching reference-detector.service.ts: the API
// must still boot if the optional parser is missing.
type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** Words whose baselines fall within this many points are one row. */
const ROW_TOLERANCE = 3.0;

export interface Word {
  text: string;
  x0: number;
  x1: number;
  top: number;
}

export interface PdfRow {
  page: number;
  top: number;
  words: Word[];
  /** Words joined with a single space, in reading order. */
  text: string;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfjsModule>;
  }
  return pdfjsPromise;
}

/**
 * Every row of every page, top to bottom, words left to right within a row.
 *
 * Rows are read per page independently — a circular's table never continues a
 * row across a page break — then concatenated in page order.
 */
export async function readRows(buffer: Buffer): Promise<PdfRow[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const rows: PdfRow[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const words: Word[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const tm = item.transform;
        const [x, y] = viewport.convertToViewportPoint(tm[4], tm[5]);
        words.push({ text: item.str.trim(), x0: x, x1: x + item.width, top: y });
      }

      // Bucket by rounded top, matching pdfrows.py's ROW_TOLERANCE grouping.
      const buckets = new Map<number, Word[]>();
      for (const w of words) {
        const key = Math.round(w.top / ROW_TOLERANCE);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(w);
        else buckets.set(key, [w]);
      }
      const keys = [...buckets.keys()].sort((a, b) => a - b);
      for (const key of keys) {
        const rowWords = buckets.get(key)!.sort((a, b) => a.x0 - b.x0);
        rows.push({
          page: pageNum,
          top: key * ROW_TOLERANCE,
          words: rowWords,
          text: rowWords.map((w) => w.text).join(" "),
        });
      }
    }
    return rows;
  } finally {
    await doc.destroy();
  }
}

/**
 * Rejoin the pieces of a table row that were set on different baselines.
 *
 * These circulars do not put one row on one baseline. HPL sets a serial number
 * or a rate a few points off the rest of its row about one row in ten; OPaL
 * sets *every* row as two halves 3pt apart — serial, cluster, state and
 * insurance on the upper, zone code, destination and rate on the lower.
 * Bucketing by baseline alone therefore splits real rows in two, which drops
 * rates (a row with no rate is discarded) and invents rows (each half parses
 * as its own). `pdfrows.py` names the same problem and pairs across it.
 *
 * Two adjacent groups are joined when they are close enough vertically to be
 * one row and occupy no common column. The column test is what keeps two
 * genuine rows apart: consecutive rows both carry a serial and a rate, so they
 * always collide and are never welded together. The gap ceiling sits between
 * the within-row offset and the real row pitch — 3pt against 6pt on HPL, 3pt
 * against 9pt on OPaL — so it separates the two cases on both.
 */
const ORPHAN_MAX_GAP = ROW_TOLERANCE + 1;
/** How close two words must be horizontally to count as the same column. */
const COLUMN_COLLISION = 5;

export function mergeOrphanRows(rows: PdfRow[]): PdfRow[] {
  const out: PdfRow[] = rows.map((r) => ({ ...r, words: [...r.words] }));
  const absorbed = new Set<number>();

  for (let i = 0; i < out.length; i++) {
    if (absorbed.has(i)) continue;
    const fragment = out[i]!;

    let bestIndex = -1;
    let bestGap = Infinity;
    for (const j of [i - 1, i + 1]) {
      const target = out[j];
      if (!target || absorbed.has(j) || target.page !== fragment.page) continue;
      const gap = Math.abs(target.top - fragment.top);
      if (gap > ORPHAN_MAX_GAP || gap >= bestGap) continue;
      const collides = fragment.words.some((o) =>
        target.words.some((t) => Math.abs(t.x0 - o.x0) < COLUMN_COLLISION),
      );
      if (collides) continue;
      bestIndex = j;
      bestGap = gap;
    }

    if (bestIndex >= 0) {
      const target = out[bestIndex]!;
      target.words = [...target.words, ...fragment.words].sort((a, b) => a.x0 - b.x0);
      target.text = target.words.map((w) => w.text).join(" ");
      // The joined row keeps the upper baseline, so a row assembled from two
      // halves still sorts into the position a reader would expect.
      target.top = Math.min(target.top, fragment.top);
      absorbed.add(i);
    }
  }

  return out.filter((_, i) => !absorbed.has(i));
}

const NUMBER = /^-?[\d,]*\d(?:\.\d+)?$/;

export function isNumber(token: string): boolean {
  const t = token.trim();
  return t.length > 0 && NUMBER.test(t) && /\d/.test(t);
}

export function parseNumber(token: string): number {
  return Number(token.replace(/,/g, ""));
}

/**
 * Glue a number the PDF split across touching words — HPL renders "3,756.00"
 * as "3" and ",756.00" set flush against each other. Only touching numeric
 * fragments are joined, so genuinely separate columns survive.
 */
export function joinNumericFragments(words: Word[], maxGap = 2.0): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (
      prev &&
      w.x0 - prev.x1 <= maxGap &&
      /^[\d,.]+$/.test(w.text) &&
      /^[\d,.]+$/.test(prev.text)
    ) {
      out[out.length - 1] = { text: prev.text + w.text, x0: prev.x0, x1: w.x1, top: prev.top };
    } else {
      out.push(w);
    }
  }
  return out;
}
