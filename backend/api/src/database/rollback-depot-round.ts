/**
 * R3: undo one round's `load-depot` — its ex-depot price entries and the depot
 * zone maps it rewrote — from the P2 backup (Go/No-Go condition C3b).
 *
 *   MONGODB_URI=... npm run rollback-depot-round -- --round 2026-09-16 --expect 27460 \
 *       --expect-locations SAMBALPUR --backup <P2 backup dir>                        # plan only
 *   ... -- --apply                                                                   # writes
 *
 * Not `rollback-depot.ts`: that one unsets EVERY location's depot map (it undoes
 * the first-ever depot load). This restores only the locations whose depot map
 * differs from the backup, and only their two depot fields.
 *
 * It refuses, before writing anything, unless:
 *   - the round has exactly `--expect` ex-depot price entries;
 *   - every one of them is dated `--round` and belongs to a price circular of the
 *     same producer that is itself dated `--round` (so no other round's rows are
 *     in scope — a later round's entries carry a later date and a later circular);
 *   - the set of locations whose depot map differs from the backup is exactly
 *     `--expect-locations` (`none` for an empty set), and every location in the
 *     backup still exists (and no new one does);
 *   - `load-depot` recorded no works-zone fills for the round (this tool does
 *     not undo those — `depotLoadAudits`), and no discount scheme's depot cash
 *     discount differs from the backup.
 *
 * The before-image holds every deleted entry in full and each location's
 * current depot fields, written and read back before the first write.
 *
 * Restart the API afterwards — the dataset is cached per round.
 */

import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import { arg, day, readBackup, redact, same, saveBeforeImage } from "./release-lib";

type Db = mongoose.mongo.Db;
const MIGRATIONS_DIR = process.env.GCPE_MIGRATIONS_DIR ?? join(__dirname, "..", "..", "..", "migrations");
const DEPOT_FIELDS = ["producerDepotZone", "producerDepotZoneTier"] as const;

export interface LocationRestore {
  _id: unknown;
  name: string;
  current: Record<string, unknown>;
  restore: Record<string, unknown>;
}

export interface DepotRollbackPlan {
  round: string;
  ok: boolean;
  errors: string[];
  entryIds: unknown[];
  entriesByProducer: Record<string, number>;
  locations: LocationRestore[];
}

const depotFields = (doc: any) => Object.fromEntries(DEPOT_FIELDS.map((f) => [f, doc?.[f]]));

export async function planDepotRollback(
  db: Db,
  opts: { round: string; expect: number; expectLocations: string[]; backupLocations: any[]; backupDiscounts: any[] },
): Promise<DepotRollbackPlan> {
  const { round, expect, expectLocations, backupLocations, backupDiscounts } = opts;
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(round)) errors.push(`--round must be YYYY-MM-DD, got "${round}"`);
  if (!Number.isInteger(expect) || expect < 0) errors.push("--expect <exact number of ex-depot entries> is required");
  const roundDate = new Date(`${round}T00:00:00.000Z`);

  // ---- price entries
  const rows = await db
    .collection("priceEntries")
    .find({ effectiveDate: roundDate, basis: "ex_depot" }, { projection: { _id: 1, producer: 1, effectiveDate: 1, circular: 1 } })
    .toArray();
  if (rows.length !== expect) errors.push(`found ${rows.length} ex-depot entries dated ${round}, expected exactly ${expect}`);
  const entriesByProducer: Record<string, number> = {};
  for (const r of rows) entriesByProducer[r.producer] = (entriesByProducer[r.producer] ?? 0) + 1;

  const circularIds = [...new Map(rows.map((r) => [String(r.circular), r.circular])).values()];
  const circulars = new Map(
    (await db.collection("priceCirculars").find({ _id: { $in: circularIds } }).toArray()).map((c) => [String(c._id), c]),
  );
  let foreign = 0;
  for (const r of rows) {
    const c = circulars.get(String(r.circular));
    if (day(r.effectiveDate) !== round || !c || c.producer !== r.producer || day(c.effectiveDate) !== round) foreign++;
  }
  if (foreign) errors.push(`${foreign} targeted entr${foreign === 1 ? "y does" : "ies do"} not belong to a ${round} circular of the same producer`);

  // ---- locations
  const current = await db.collection("locations").find({}).toArray();
  const backupById = new Map(backupLocations.map((d) => [String(d._id), d]));
  const currentIds = new Set(current.map((d) => String(d._id)));
  const missing = backupLocations.filter((d) => !currentIds.has(String(d._id))).map((d) => d.name);
  const added = current.filter((d) => !backupById.has(String(d._id))).map((d) => d.name);
  if (missing.length) errors.push(`locations in the backup but no longer in the database: ${missing.join(", ")}`);
  if (added.length) errors.push(`locations in the database but not in the backup: ${added.join(", ")}`);
  const locations: LocationRestore[] = [];
  for (const d of current) {
    const b = backupById.get(String(d._id));
    if (!b || same(depotFields(d), depotFields(b))) continue;
    locations.push({ _id: d._id, name: d.name, current: depotFields(d), restore: depotFields(b) });
  }
  const changed = locations.map((l) => l.name).sort();
  const wanted = [...expectLocations].sort();
  if (JSON.stringify(changed) !== JSON.stringify(wanted)) {
    errors.push(`locations whose depot map differs from the backup: [${changed.join(", ") || "none"}]; expected [${wanted.join(", ") || "none"}]`);
  }

  // ---- what this tool does not undo must not have happened
  const fills = await db.collection("depotLoadAudits").find({ effectiveDate: roundDate }).toArray();
  const fillCount = fills.reduce((n, a) => n + (a.worksZoneFills?.length ?? 0), 0);
  if (fillCount) errors.push(`load-depot recorded ${fillCount} works-zone fill(s) for ${round}; this tool does not undo them`);
  const discounts = new Map((await db.collection("discountSchemes").find({}).toArray()).map((d) => [String(d._id), d]));
  const discountDrift = backupDiscounts
    // Compared canonically: a backup parses numbers as BSON Int32/Double, never as `===`-comparable numbers.
    .filter((b) => !same(discounts.get(String(b._id))?.cashDiscountDepot, b.cashDiscountDepot))
    .map((b) => `${b.producer} ${day(b.effectiveDate)}`);
  if (discountDrift.length || discounts.size !== backupDiscounts.length) {
    errors.push(`discount schemes differ from the backup (${discountDrift.join(", ") || `count ${discounts.size} vs ${backupDiscounts.length}`}); this tool does not restore them`);
  }

  return { round, ok: errors.length === 0, errors, entryIds: rows.map((r) => r._id), entriesByProducer, locations };
}

export interface DepotRollbackResult {
  beforeImage: string;
  beforeImageHash: string;
  deleted: number;
  restored: number;
  readBack: { pass: boolean; failures: string[] };
}

export async function applyDepotRollback(db: Db, plan: DepotRollbackPlan, beforeImagePath: string): Promise<DepotRollbackResult> {
  if (!plan.ok) throw new Error("Refusing to apply a plan with errors.");
  const entries = db.collection("priceEntries");
  const roundDate = new Date(`${plan.round}T00:00:00.000Z`);
  const fullRows: any[] = [];
  for (let i = 0; i < plan.entryIds.length; i += 5000) {
    fullRows.push(...(await entries.find({ _id: { $in: plan.entryIds.slice(i, i + 5000) as any[] } }).toArray()));
  }
  if (fullRows.length !== plan.entryIds.length) throw new Error("Entries changed between plan and apply. Nothing was written.");
  const hash = saveBeforeImage(beforeImagePath, {
    action: "rollback-depot-round",
    round: plan.round,
    generatedAt: new Date(),
    entries: fullRows,
    locations: plan.locations,
  });

  const failures: string[] = [];
  let deleted = 0;
  for (let i = 0; i < plan.entryIds.length; i += 5000) {
    const r = await entries.deleteMany({
      _id: { $in: plan.entryIds.slice(i, i + 5000) as any[] },
      effectiveDate: roundDate,
      basis: "ex_depot",
    });
    deleted += r.deletedCount;
  }
  if (deleted !== plan.entryIds.length) failures.push(`deleted ${deleted}, planned ${plan.entryIds.length}`);

  const locs = db.collection("locations");
  let restored = 0;
  for (const l of plan.locations) {
    const now = await locs.findOne({ _id: l._id as any });
    if (!same(depotFields(now), l.current)) {
      failures.push(`${l.name}: depot map changed since the plan — left alone`);
      continue;
    }
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const $unset: Record<string, ""> = {};
    for (const f of DEPOT_FIELDS) {
      if (l.restore[f] === undefined) $unset[f] = "";
      else $set[f] = l.restore[f];
    }
    await locs.updateOne({ _id: l._id as any }, Object.keys($unset).length ? { $set, $unset } : { $set });
    restored++;
  }

  // Read back
  const left = await entries.countDocuments({ effectiveDate: roundDate, basis: "ex_depot" });
  if (left !== 0) failures.push(`${left} ex-depot entries dated ${plan.round} remain`);
  for (const l of plan.locations) {
    const now = await locs.findOne({ _id: l._id as any });
    if (!same(depotFields(now), l.restore)) failures.push(`${l.name}: depot map does not match the backup after restore`);
  }

  const at = new Date();
  await db.collection("auditLogs").insertOne({
    action: "depot.rollback",
    entity: "price_entries",
    detail: {
      tool: "rollback-depot-round",
      round: plan.round,
      deleted,
      entriesByProducer: plan.entriesByProducer,
      locationsRestored: plan.locations.map((l) => l.name),
      beforeImage: beforeImagePath,
      beforeImageHash: hash,
      readBackPass: failures.length === 0,
    },
    createdAt: at,
    updatedAt: at,
  });
  return { beforeImage: beforeImagePath, beforeImageHash: hash, deleted, restored, readBack: { pass: failures.length === 0, failures } };
}

export function printPlan(plan: DepotRollbackPlan): void {
  console.log(`round ${plan.round}: ${plan.entryIds.length.toLocaleString("en-IN")} ex-depot entries`);
  for (const [p, n] of Object.entries(plan.entriesByProducer).sort()) console.log(`  ${p.padEnd(5)} ${n.toLocaleString("en-IN")}`);
  for (const l of plan.locations) {
    console.log(`  location ${l.name}: ${JSON.stringify(l.current.producerDepotZone)} -> ${JSON.stringify(l.restore.producerDepotZone)}`);
  }
  for (const e of plan.errors) console.log(`  ABORT ${e}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const round = arg("round") ?? "";
  const expect = Number(arg("expect"));
  const expectArg = arg("expect-locations");
  const backupDir = arg("backup");
  if (!backupDir) throw new Error("--backup <P2 backup directory> is required.");
  if (expectArg === undefined) throw new Error("--expect-locations <NAME,NAME | none> is required.");
  const expectLocations = expectArg === "none" ? [] : expectArg.split(",").map((s) => s.trim()).filter(Boolean);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required.");

  const backupLocations = readBackup(backupDir, "locations");
  const backupDiscounts = readBackup(backupDir, "discountSchemes");
  await mongoose.connect(uri);
  console.log(`connected: ${redact(uri)}`);
  console.log(apply ? "mode: APPLY (writing)\n" : "mode: plan only (nothing is written; pass --apply)\n");
  const db = mongoose.connection.db!;

  const plan = await planDepotRollback(db, { round, expect, expectLocations, backupLocations, backupDiscounts });
  printPlan(plan);
  if (!plan.ok) {
    console.log(`\nABORTED: ${plan.errors.length} problem(s). Nothing was written.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!apply) {
    console.log(`\nwould delete ${plan.entryIds.length.toLocaleString("en-IN")} entries and restore ${plan.locations.length} location(s).`);
    await mongoose.disconnect();
    return;
  }
  const result = await applyDepotRollback(db, plan, join(MIGRATIONS_DIR, `rollback-depot-round-${round}-${Date.now()}.json`));
  console.log(`\nbefore-image saved: ${result.beforeImage} (sha256 ${result.beforeImageHash})`);
  console.log(`deleted ${result.deleted.toLocaleString("en-IN")} entries, restored ${result.restored} location(s)`);
  console.log(result.readBack.pass ? "read-back: PASS" : "read-back: FAIL");
  for (const f of result.readBack.failures) console.log(`  ${f}`);
  console.log("\nRestart the API — the dataset is cached per round.");
  await mongoose.disconnect();
  if (!result.readBack.pass) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error?.stack ?? error).replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>"));
    process.exit(1);
  });
}
