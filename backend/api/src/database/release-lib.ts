/**
 * Shared machinery for the release-window tools: `backup-collections.ts` (P2),
 * `rollback-price-round.ts` (R1) and `rollback-depot-round.ts` (R3).
 *
 * A backup is a directory of canonical-EJSON arrays, one per collection, plus
 * `_manifest.json` (counts, time taken) and `SHA256SUMS`. A rollback trusts a
 * backup file only after its hash matches — the point of the backup is that it
 * is exactly what production held before the window, and a file edited or
 * truncated since is not that.
 *
 * A rollback manifest is written, read back and hashed BEFORE the rollback
 * writes anything (the same rule `migration-lib.saveManifest` enforces for M0/M1).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import mongoose from "mongoose";

/** The BSON copy the mongoose driver uses, so ObjectIds and Dates round-trip into queries unchanged. */
export const EJSON = mongoose.mongo.BSON.EJSON;

export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/**
 * Canonical EJSON with sorted keys and numbers compared by value: equal documents
 * give equal strings whatever their field order and whatever numeric BSON type
 * holds a value. The driver hands back a stored double 5.0 as the JS number 5
 * (EJSON `$numberInt`), while a backup parses it as Double(5) (`$numberDouble`);
 * Int32, Int64, Double and Decimal128 all become one `{"$n": …}` form here.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(normalise(JSON.parse(EJSON.stringify(value, { relaxed: false }))));
}
const NUMERIC = ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"];
function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length === 1 && NUMERIC.includes(keys[0])) return { $n: numericValue(String((value as any)[keys[0]])) };
    const out: Record<string, unknown> = {};
    for (const key of keys.sort()) out[key] = normalise((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
/** One spelling per value: "<sign><digits>e<exponent>", no leading/trailing zeros; 0 and -0 are "0". */
export function numericValue(text: string): string {
  const special = /^([+-])?(nan|inf|infinity)$/i.exec(text.trim());
  if (special) return /nan/i.test(special[2]) ? "NaN" : `${special[1] === "-" ? "-" : ""}Infinity`;
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!m || (!m[2] && !m[3])) return text;
  let digits = `${m[2] ?? ""}${m[3] ?? ""}`.replace(/^0+/, "");
  let exp = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
  if (!digits) return "0";
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  digits = digits.slice(0, digits.length - trailing);
  exp += trailing;
  return `${m[1] === "-" ? "-" : ""}${digits}e${exp}`;
}
export const same = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);

/**
 * Hash of one stored document for before/after comparison: `updatedAt` and `__v`
 * ignored, everything else — nested fields included — hashed canonically.
 * (Not `JSON.stringify(doc, keyArray)`: an array replacer is an allowlist applied at
 * EVERY depth and silently drops nested fields such as `producerZone.HMEL`.)
 */
export function documentHash(doc: unknown): string {
  const d = JSON.parse(EJSON.stringify(doc, { relaxed: false }));
  if (d && typeof d === "object") { delete d.updatedAt; delete d.__v; }
  return sha256(JSON.stringify(normalise(d)));
}
/** Which `documentHash` a stored baseline was made with; a baseline from another version is refused. */
export const DOCUMENT_HASH_VERSION = "canonical-v2";

export const redact = (uri: string) => uri.replace(/\/\/[^@]*@/, "//***@");
export const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** A real calendar date written YYYY-MM-DD. `2026-02-30` is refused, not rolled over to 2 March. */
export function validRound(round: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(round)) return false;
  const d = new Date(`${round}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && day(d) === round;
}
export const roundDate = (round: string) => new Date(`${round}T00:00:00.000Z`);

/** `GCPE_MIGRATIONS_DIR` is required to write: a before-image holds production data and must not land in the repo. */
export function beforeImageDir(): string {
  const dir = process.env.GCPE_MIGRATIONS_DIR;
  if (!dir) throw new Error("GCPE_MIGRATIONS_DIR is required with --apply: a directory OUTSIDE the repository for the before-image.");
  return dir;
}

/** Parse `--name value` from argv. */
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Read one collection from a backup directory, refusing a file whose hash is not the one recorded. */
export function readBackup<T = any>(dir: string, collection: string): T[] {
  const file = `${collection}.ejson`;
  const sums = join(dir, "SHA256SUMS");
  if (!existsSync(sums)) throw new Error(`${sums} not found — not a backup written by backup-collections. Refusing.`);
  const line = readFileSync(sums, "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().endsWith(` ${file}`) || l.trim().endsWith(`*${file}`));
  if (!line) throw new Error(`${file} is not listed in ${sums}. Refusing.`);
  const raw = readFileSync(join(dir, file));
  const expected = line.trim().split(/\s+/)[0];
  if (sha256(raw) !== expected) throw new Error(`${join(dir, file)} does not match its SHA256SUMS entry. Refusing.`);
  return EJSON.parse(raw.toString("utf8"), { relaxed: false }) as T[];
}

/** Write a rollback before-image; refuse to continue unless it reads back identical. Returns its sha256. */
export function saveBeforeImage(path: string, content: unknown): string {
  mkdirSync(dirname(path), { recursive: true });
  const text = EJSON.stringify(content, undefined, 1, { relaxed: false });
  writeFileSync(path, text, "utf8");
  if (readFileSync(path, "utf8") !== text) {
    throw new Error(`Before-image at ${path} did not read back identical to what was written. Refusing to apply.`);
  }
  return sha256(text);
}

export function loadBeforeImage<T = any>(path: string): T {
  return EJSON.parse(readFileSync(path, "utf8"), { relaxed: false }) as T;
}
