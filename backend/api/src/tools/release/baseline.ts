/**
 * The pre-window baseline `verify-production` writes with `--pre` and compares
 * against with `--post` / `--rollback`. It is the reference that proves a
 * deployment or a rollback, so:
 *   - it is written only when every pre check passed;
 *   - an existing baseline is never replaced unless `--force-baseline-overwrite`
 *     is passed (re-running `--pre` after the first write would otherwise swap
 *     the pre-window state for the deployed one);
 *   - it records the document-hash version it was made with, and a baseline
 *     made with another version is refused rather than compared.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_HASH_VERSION, sha256 } from "../../database/release-lib";

export const BASELINE_FILE = "baseline-pre.json";
export const FORCE_FLAG = "--force-baseline-overwrite";

/** Call before connecting: refuse at once if a baseline is already there. */
export function assertBaselineWritable(dir: string, force: boolean): void {
  const path = join(dir, BASELINE_FILE);
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists. Refusing to overwrite the pre-window baseline (pass ${FORCE_FLAG} to replace it deliberately).`);
  }
}

export function saveBaseline(
  dir: string,
  baseline: Record<string, unknown>,
  opts: { force: boolean; failedChecks: number },
): { path: string; sha256: string } {
  if (opts.failedChecks > 0) throw new Error(`${opts.failedChecks} pre check(s) failed. Baseline not saved.`);
  assertBaselineWritable(dir, opts.force);
  const path = join(dir, BASELINE_FILE);
  const text = JSON.stringify({ ...baseline, hashVersion: DOCUMENT_HASH_VERSION }, null, 1);
  writeFileSync(path, text);
  if (readFileSync(path, "utf8") !== text) throw new Error(`${path} did not read back identical to what was written.`);
  return { path, sha256: sha256(text) };
}

export function loadBaseline(dir: string): any {
  const path = join(dir, BASELINE_FILE);
  if (!existsSync(path)) throw new Error(`${path} not found. Run --pre first.`);
  const base = JSON.parse(readFileSync(path, "utf8"));
  if (base.hashVersion !== DOCUMENT_HASH_VERSION) {
    throw new Error(
      `${path} was made with document hash "${base.hashVersion ?? "v1 (nested fields ignored)"}", not "${DOCUMENT_HASH_VERSION}". ` +
        "Retake the baseline with this verifier before the window.",
    );
  }
  return base;
}
