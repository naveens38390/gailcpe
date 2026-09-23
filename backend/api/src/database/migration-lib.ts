/**
 * Shared machinery for the two location migrations (decision 0010 §9.4):
 * `fix-hpl-territory.ts` (M0) and `load-equivalence.ts` (M1).
 *
 * Both migrations write only one producer's `producerZone`/`producerZoneTier`
 * (plus `producerZoneMeta` on the works side) on `Location` documents — M0
 * also touches HPL's `producerDepotZone`/`producerDepotZoneTier`, which never
 * carries fallback meta (depot coverage is never merged by the ETL, decision
 * 0010 §5 WP2a) — and both need exactly the same discipline: never overwrite
 * a hand correction, never lose the pre-image, never claim success without
 * reading the result back. That discipline lives here once instead of twice.
 *
 * Every write is compare-and-set: the filter includes the value the loader
 * believes is currently there (or "must be absent"), so a value someone
 * corrected in the admin panel since simply does not match and the write is
 * skipped, never forced (§9.4.2).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Model } from "mongoose";

export type MigrationOp = "ADD" | "RELABEL" | "REPLACE" | "REMOVE" | "CLEAR" | "NOOP";
export type LocationBasis = "works" | "depot";

const FIELD = {
  works: { zone: "producerZone", tier: "producerZoneTier", meta: "producerZoneMeta" },
  depot: { zone: "producerDepotZone", tier: "producerDepotZoneTier", meta: undefined },
} as const;

/** One producer's zone/tier/meta change on one Location document. */
export interface LocationFieldUpdate {
  location: string;
  producer: string;
  basis: LocationBasis;
  op: MigrationOp;
  /** `undefined` means the field must currently be absent. */
  expectedZone: string | undefined;
  expectedTier: string | undefined;
  /** `undefined` means $unset (REMOVE/CLEAR). */
  nextZone: string | undefined;
  nextTier: string | undefined;
  /** Works only; always undefined for a depot update (depot carries no meta). */
  nextMeta?: Record<string, unknown> | undefined;
}

/** Given a current and target value, the operation this represents (NOOP is a real, expected outcome, not an error). */
export function opFor(current: string | undefined, target: string | undefined): MigrationOp {
  if (current === target) return "NOOP";
  if (current === undefined) return "ADD";
  if (target === undefined) return "REMOVE";
  return "REPLACE";
}

export interface BeforeImageRow {
  name: string;
  producerZone: Record<string, string>;
  producerZoneTier: Record<string, string>;
  producerZoneMeta: Record<string, unknown>;
  producerDepotZone: Record<string, string>;
  producerDepotZoneTier: Record<string, string>;
  freightDestination: Record<string, string>;
}

export interface MigrationManifest {
  action: string;
  generatedAt: string;
  /** Whole works+depot zone/tier/meta fields for every Location this run touches — the full
   * field, not just the one producer, so a rollback can never partially restore a document
   * (§9.4.3). */
  before: BeforeImageRow[];
  updates: LocationFieldUpdate[];
}

export function opCounts(updates: LocationFieldUpdate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const u of updates) counts[u.op] = (counts[u.op] ?? 0) + 1;
  return counts;
}

export function printPlan(updates: LocationFieldUpdate[]): void {
  const counts = opCounts(updates);
  for (const op of ["ADD", "RELABEL", "REPLACE", "CLEAR", "REMOVE", "NOOP"]) {
    if (counts[op]) console.log(`  ${op.padEnd(7)} ${counts[op]}`);
  }
  const sample = updates.filter((u) => u.op !== "NOOP").slice(0, 10);
  if (sample.length) {
    console.log("\n  sample:");
    for (const u of sample) {
      const from = u.expectedZone ? `${u.expectedZone} (${u.expectedTier})` : "(none)";
      const to = u.nextZone ? `${u.nextZone} (${u.nextTier})` : "(removed)";
      console.log(`    ${u.op.padEnd(7)} ${u.producer.padEnd(5)} ${u.basis.padEnd(5)} ${u.location.padEnd(20)} ${from} -> ${to}`);
    }
    const rest = updates.filter((u) => u.op !== "NOOP").length - sample.length;
    if (rest > 0) console.log(`    ... and ${rest} more`);
  }
}

/**
 * A stable string for both the saved file and its hash. `JSON.stringify`'s
 * array-form replacer is NOT a top-level key filter — it applies the same
 * allowlist at every nesting level, so passing one here would have silently
 * dropped every field of every nested row that isn't itself named "action",
 * "before", "generatedAt" or "updates" (caught by the rollback rehearsal:
 * the before-image round-tripped empty and rollback restored nothing).
 * Sorting keys recursively gives the same "stable regardless of insertion
 * order" property without that trap.
 */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortedKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(manifest: MigrationManifest): string {
  return JSON.stringify(sortedKeys(manifest), null, 1);
}

/**
 * Save the before-image + intended writes and refuse to continue if it
 * cannot be written (§9.4.3: "refuses --apply if it cannot write it").
 * Call this BEFORE any database write.
 */
export function saveManifest(manifest: MigrationManifest, outPath: string): string {
  mkdirSync(dirname(outPath), { recursive: true });
  const json = canonicalJson(manifest);
  writeFileSync(outPath, json, "utf8");
  // Read it back rather than trusting the write call — the guarantee this
  // exists for is "the file is really there", not "writeFileSync returned".
  const reread = readFileSync(outPath, "utf8");
  if (reread !== json) {
    throw new Error(`Before-image at ${outPath} did not read back identical to what was written. Refusing to apply.`);
  }
  return createHash("sha256").update(json).digest("hex");
}

export function loadManifest(path: string): { manifest: MigrationManifest; hash: string } {
  const json = readFileSync(path, "utf8");
  const manifest = JSON.parse(json) as MigrationManifest;
  const hash = createHash("sha256").update(canonicalJson(manifest)).digest("hex");
  return { manifest, hash };
}

/** Build the whole-field before-image for every Location a set of updates will touch. */
export async function captureBeforeImage(
  Location: Model<any>,
  updates: LocationFieldUpdate[],
): Promise<BeforeImageRow[]> {
  const names = [...new Set(updates.map((u) => u.location))];
  const docs = await Location.find({ name: { $in: names } }).lean<any[]>();
  const byName = new Map(docs.map((d) => [d.name, d]));
  return names.map((name) => {
    const doc = byName.get(name);
    return {
      name,
      producerZone: doc?.producerZone ?? {},
      producerZoneTier: doc?.producerZoneTier ?? {},
      producerZoneMeta: doc?.producerZoneMeta ?? {},
      producerDepotZone: doc?.producerDepotZone ?? {},
      producerDepotZoneTier: doc?.producerDepotZoneTier ?? {},
      freightDestination: doc?.freightDestination ?? {},
    };
  });
}

const existsOr = (value: string | undefined) => (value === undefined ? { $exists: false } : value);

/**
 * Apply every non-NOOP update, one `updateOne` per Location document (all of
 * that document's changes in this batch in a single write). A document whose
 * current value does not match `expectedZone`/`expectedTier` for ANY of its
 * updates in this batch is a conflict — reported, never forced, and no field
 * on that document is written even if some other update's expectation did
 * match (a document is restored or not as a whole, never partially).
 */
export async function applyUpdates(
  Location: Model<any>,
  updates: LocationFieldUpdate[],
): Promise<{ applied: number; conflicts: LocationFieldUpdate[] }> {
  const byLocation = new Map<string, LocationFieldUpdate[]>();
  for (const u of updates) {
    if (u.op === "NOOP") continue;
    (byLocation.get(u.location) ?? byLocation.set(u.location, []).get(u.location)!).push(u);
  }

  let applied = 0;
  const conflicts: LocationFieldUpdate[] = [];
  for (const [location, group] of byLocation) {
    const filter: Record<string, unknown> = { name: location };
    for (const u of group) {
      const f = FIELD[u.basis];
      filter[`${f.zone}.${u.producer}`] = existsOr(u.expectedZone);
      filter[`${f.tier}.${u.producer}`] = existsOr(u.expectedTier);
    }
    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    for (const u of group) {
      const f = FIELD[u.basis];
      if (u.nextZone === undefined) {
        unset[`${f.zone}.${u.producer}`] = "";
        unset[`${f.tier}.${u.producer}`] = "";
      } else {
        set[`${f.zone}.${u.producer}`] = u.nextZone;
        set[`${f.tier}.${u.producer}`] = u.nextTier;
      }
      if (f.meta) {
        if (u.nextMeta === undefined) unset[`${f.meta}.${u.producer}`] = "";
        else set[`${f.meta}.${u.producer}`] = u.nextMeta;
      }
    }
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    const result = await Location.updateOne(filter, update);
    if (result.matchedCount === 0) {
      conflicts.push(...group);
    } else {
      applied += group.length;
    }
  }
  return { applied, conflicts };
}

/** Re-read every touched (non-conflicting) document and confirm it now holds exactly the intended value. */
export async function readBack(
  Location: Model<any>,
  updates: LocationFieldUpdate[],
): Promise<{ pass: boolean; failures: string[] }> {
  const toCheck = updates.filter((u) => u.op !== "NOOP");
  const names = [...new Set(toCheck.map((u) => u.location))];
  const docs = await Location.find({ name: { $in: names } }).lean<any[]>();
  const byName = new Map(docs.map((d) => [d.name, d]));
  const failures: string[] = [];
  for (const u of toCheck) {
    const doc = byName.get(u.location);
    const f = FIELD[u.basis];
    const gotZone = doc?.[f.zone]?.[u.producer];
    const gotTier = doc?.[f.tier]?.[u.producer];
    if (gotZone !== u.nextZone || gotTier !== u.nextTier) {
      failures.push(
        `${u.producer} ${u.basis} ${u.location}: expected ${u.nextZone ?? "(absent)"}/${u.nextTier ?? "(absent)"}, ` +
          `got ${gotZone ?? "(absent)"}/${gotTier ?? "(absent)"}`,
      );
    }
  }
  return { pass: failures.length === 0, failures };
}

export async function writeAuditEntry(
  AuditLog: Model<any>,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await AuditLog.create({ action, detail });
}

/**
 * L2 rollback (§10): for every recorded update, restore the before-image
 * value ONLY where the document's current value still equals what the
 * migration wrote. A value changed since (an admin correction) is left
 * alone and reported, never overwritten.
 */
export async function rollback(
  Location: Model<any>,
  manifest: MigrationManifest,
): Promise<{ restored: number; leftAlone: number; conflicts: string[] }> {
  const before = new Map(manifest.before.map((b) => [b.name, b]));
  let restored = 0;
  let leftAlone = 0;
  const conflicts: string[] = [];

  const byLocation = new Map<string, LocationFieldUpdate[]>();
  for (const u of manifest.updates) {
    if (u.op === "NOOP") continue;
    (byLocation.get(u.location) ?? byLocation.set(u.location, []).get(u.location)!).push(u);
  }

  for (const [location, group] of byLocation) {
    const pre = before.get(location);
    if (!pre) continue;
    const doc = await Location.findOne({ name: location }).lean<any>();
    if (!doc) continue;

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    let anyMatched = false;
    for (const u of group) {
      const f = FIELD[u.basis];
      const currentZone = doc[f.zone]?.[u.producer];
      const currentTier = doc[f.tier]?.[u.producer];
      if (currentZone !== u.nextZone || currentTier !== u.nextTier) {
        leftAlone++;
        conflicts.push(
          `${u.producer} ${u.basis} ${location}: current value (${currentZone ?? "(absent)"}) is not what this ` +
            `migration wrote (${u.nextZone ?? "(absent)"}) — left alone, not rolled back`,
        );
        continue;
      }
      anyMatched = true;
      restored++;
      const preZone = u.basis === "works" ? pre.producerZone[u.producer] : pre.producerDepotZone[u.producer];
      const preTier = u.basis === "works" ? pre.producerZoneTier[u.producer] : pre.producerDepotZoneTier[u.producer];
      const preMeta = u.basis === "works" ? pre.producerZoneMeta[u.producer] : undefined;
      if (preZone === undefined) {
        unset[`${f.zone}.${u.producer}`] = "";
        unset[`${f.tier}.${u.producer}`] = "";
      } else {
        set[`${f.zone}.${u.producer}`] = preZone;
        set[`${f.tier}.${u.producer}`] = preTier;
      }
      if (f.meta) {
        if (preMeta === undefined) unset[`${f.meta}.${u.producer}`] = "";
        else set[`${f.meta}.${u.producer}`] = preMeta;
      }
    }
    if (!anyMatched) continue;
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    await Location.updateOne({ _id: doc._id }, update);
  }
  return { restored, leftAlone, conflicts };
}
