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

/** Canonical EJSON with sorted keys: equal documents give equal strings whatever their field order. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(JSON.parse(EJSON.stringify(value, { relaxed: false }))));
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
export const same = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);

export const redact = (uri: string) => uri.replace(/\/\/[^@]*@/, "//***@");
export const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

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
