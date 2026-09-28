/**
 * R1: roll a published price round back to the circulars that were active
 * before it, for any producer (Go/No-Go condition C3a).
 *
 *   MONGODB_URI=... npm run rollback-price-round -- --round 2026-09-16 \
 *       --producers GAIL,IOCL,RIL,HMEL,HPL,OPaL --backup <P2 backup dir>          # plan only, writes nothing
 *   ... -- --apply                                                                 # writes
 *
 * Why a script: the API's rollback endpoint is hard-coded to GAIL (R28), and
 * changing it is an application deploy. This does what that endpoint does —
 * status changes only — for any producer, checked against the P2 backup.
 *
 * What it changes, per producer: the round's circular goes `active` → `superseded`,
 * and every circular the backup recorded as `active` goes back to `active`.
 * Nothing else. Price entries are never touched: once their circular is not
 * active the app does not read them (DatasetService serves each producer's
 * newest ACTIVE circular), and the earlier rounds' entries were never removed.
 *
 * It refuses — for every producer, before writing anything — unless it finds
 * exactly the state a publish of `--round` leaves behind:
 *   - exactly one active circular for the producer, dated `--round`, and absent
 *     from the backup (so it was created after the backup, by the publish);
 *   - every circular the backup had as active is present, same date, now `superseded`;
 *   - every other backed-up circular still has its backed-up status;
 *   - every circular created since the backup is dated `--round` (no later round).
 *
 * Order per producer: reactivate the earlier circulars, read them back, and only
 * then supersede the round's. While both are active the app still serves the
 * round (it serves the newest active circular), so at no point does a producer
 * have no active circular. If any reactivation fails its compare-and-set, the
 * ones already reactivated for that producer are put back to `superseded`, the
 * round's circular is left active, and the run stops: that producer is exactly
 * as before, later producers are untouched, and the result is FAIL.
 *
 * `asOf` (historical) queries resolve by date and ignore status, so for dates on
 * or after `--round` they still see the round's entries. The app never sends
 * `asOf`; see the rollback rehearsal report.
 *
 * Restart the API afterwards — the dataset is cached per round.
 */

import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import { arg, beforeImageDir, day, readBackup, redact, saveBeforeImage, validRound } from "./release-lib";

type Db = mongoose.mongo.Db;
type ObjectId = mongoose.mongo.ObjectId;

interface CircularRef {
  _id: ObjectId;
  producer: string;
  reference: string;
  effectiveDate: Date;
  status: string;
  basis?: string;
}

export interface ProducerPlan {
  producer: string;
  /** The round's active circular, to be superseded. */
  supersede: CircularRef;
  /** The circulars active before the round (from the backup), to be reactivated. */
  restore: CircularRef[];
}

export interface PriceRollbackPlan {
  round: string;
  ok: boolean;
  errors: string[];
  producers: ProducerPlan[];
}

const describe = (c: CircularRef) => `${String(c._id)} ${c.reference} ${day(c.effectiveDate)} ${c.status}`;

export async function planPriceRollback(
  db: Db,
  round: string,
  producers: string[],
  backup: CircularRef[],
): Promise<PriceRollbackPlan> {
  const errors: string[] = [];
  const plans: ProducerPlan[] = [];
  if (!validRound(round)) errors.push(`--round must be a real date written YYYY-MM-DD, got "${round}"`);
  if (!producers.length) errors.push("--producers is required (comma-separated)");
  if (new Set(producers).size !== producers.length) errors.push(`--producers lists a producer twice: ${producers.join(",")}`);
  if (errors.length) return { round, ok: false, errors, producers: [] };

  for (const producer of producers) {
    const fail = (why: string) => errors.push(`${producer}: ${why}`);
    const backedUp = backup.filter((c) => c.producer === producer);
    if (!backedUp.length) { fail("no circulars for this producer in the backup"); continue; }
    if (backedUp.some((c) => day(c.effectiveDate) === round)) {
      fail(`the backup already holds a ${round} circular — it was not taken before the round was published`);
      continue;
    }
    const wasActive = backedUp.filter((c) => c.status === "active");
    if (!wasActive.length) { fail("the backup has no active circular to restore"); continue; }

    const current = await db.collection<CircularRef>("priceCirculars").find({ producer }).toArray();
    const byId = new Map(current.map((c) => [String(c._id), c]));
    const inBackup = new Set(backedUp.map((c) => String(c._id)));
    const errorsBefore = errors.length;

    const active = current.filter((c) => c.status === "active");
    const target = active[0];
    if (active.length !== 1 || day(target.effectiveDate) !== round || inBackup.has(String(target._id))) {
      fail(
        `expected exactly one active circular dated ${round} and created after the backup; found ` +
          (active.map((c) => `[${describe(c)}${inBackup.has(String(c._id)) ? ", in backup" : ""}]`).join(" ") || "none"),
      );
    }
    for (const c of wasActive) {
      const now = byId.get(String(c._id));
      if (!now) fail(`backed-up active circular ${describe(c)} no longer exists`);
      else if (day(now.effectiveDate) !== day(c.effectiveDate)) fail(`circular ${String(c._id)} changed date since the backup`);
      else if (now.status !== "superseded") fail(`backed-up active circular ${describe(c)} is now "${now.status}", expected "superseded"`);
    }
    for (const c of backedUp.filter((b) => b.status !== "active")) {
      const now = byId.get(String(c._id));
      if (!now) fail(`backed-up circular ${describe(c)} no longer exists`);
      else if (now.status !== c.status) fail(`circular ${describe(c)} is now "${now.status}"; only the round may have changed it`);
    }
    for (const c of current.filter((x) => !inBackup.has(String(x._id)))) {
      if (day(c.effectiveDate) !== round) fail(`circular ${describe(c)} was created after the backup for a different date — refusing`);
    }
    if (errors.length === errorsBefore) {
      plans.push({ producer, supersede: target, restore: wasActive.map((c) => byId.get(String(c._id))!) });
    }
  }
  return { round, ok: errors.length === 0, errors, producers: plans };
}

export interface PriceRollbackResult {
  beforeImage: string;
  beforeImageHash: string;
  restored: number;
  superseded: number;
  /** Producers fully rolled back, in order. */
  completed: string[];
  readBack: { pass: boolean; failures: string[] };
  auditError?: string;
}

export async function applyPriceRollback(db: Db, plan: PriceRollbackPlan, beforeImagePath: string): Promise<PriceRollbackResult> {
  if (!plan.ok) throw new Error("Refusing to apply a plan with errors.");
  const circulars = db.collection<CircularRef>("priceCirculars");
  const hash = saveBeforeImage(beforeImagePath, {
    action: "rollback-price-round",
    round: plan.round,
    generatedAt: new Date(),
    producers: plan.producers,
  });

  let restored = 0;
  let superseded = 0;
  let stopped = false;
  const completed: string[] = [];
  const failures: string[] = [];
  for (const p of plan.producers) {
    const now = new Date();
    // 1. Reactivate the earlier circulars (compare-and-set on status and date).
    const reactivated: CircularRef[] = [];
    const missed: string[] = [];
    for (const c of p.restore) {
      const r = await circulars.updateOne(
        { _id: c._id, producer: p.producer, status: "superseded", effectiveDate: c.effectiveDate },
        { $set: { status: "active", updatedAt: now } },
      );
      if (r.modifiedCount === 1) reactivated.push(c);
      else missed.push(`${p.producer}: ${String(c._id)} was not "superseded" at write time — not reactivated`);
    }
    // 2. Read them back. Only if every one is active is the round's circular superseded.
    const activeNow = new Set((await circulars.find({ producer: p.producer, status: "active" }).toArray()).map((c) => String(c._id)));
    if (missed.length || !p.restore.every((c) => activeNow.has(String(c._id)))) {
      // Put this producer back as it was: the round stays active, the earlier circulars superseded.
      for (const c of reactivated) {
        await circulars.updateOne(
          { _id: c._id, producer: p.producer, status: "active" },
          { $set: { status: "superseded", updatedAt: new Date() } },
        );
      }
      failures.push(...missed, `${p.producer}: not rolled back — its ${plan.round} circular is still active`);
      stopped = true;
      break;
    }
    restored += reactivated.length;
    // 3. Supersede the round's circular.
    const r = await circulars.updateOne(
      { _id: p.supersede._id, producer: p.producer, status: "active", effectiveDate: p.supersede.effectiveDate },
      { $set: { status: "superseded", updatedAt: now } },
    );
    if (r.modifiedCount !== 1) {
      failures.push(`${p.producer}: round circular ${String(p.supersede._id)} was not active at write time`);
      stopped = true;
      break;
    }
    superseded++;
    completed.push(p.producer);
  }
  const notDone = plan.producers.map((p) => p.producer).filter((p) => !completed.includes(p));
  if (stopped && notDone.length) failures.push(`stopped; not rolled back: ${notDone.join(", ")}`);

  // Read back every producer rolled back: its active set must be exactly what the backup had.
  for (const p of plan.producers.filter((x) => completed.includes(x.producer))) {
    const active = (await circulars.find({ producer: p.producer, status: "active" }).toArray()).map((c) => String(c._id)).sort();
    const want = p.restore.map((c) => String(c._id)).sort();
    if (JSON.stringify(active) !== JSON.stringify(want)) {
      failures.push(`${p.producer}: active after rollback [${active.join(", ")}], expected [${want.join(", ")}]`);
    }
  }

  const result: PriceRollbackResult = {
    beforeImage: beforeImagePath, beforeImageHash: hash, restored, superseded, completed,
    readBack: { pass: failures.length === 0, failures },
  };
  try {
    const at = new Date();
    await db.collection("auditLogs").insertMany(
      plan.producers.map((p) => ({
        action: "price_circular.rollback",
        entity: "price_circular",
        detail: {
          tool: "rollback-price-round",
          producer: p.producer,
          round: plan.round,
          rolledBack: completed.includes(p.producer),
          superseded: String(p.supersede._id),
          restored: p.restore.map((c) => String(c._id)),
          beforeImage: beforeImagePath,
          beforeImageHash: hash,
          readBackPass: result.readBack.pass,
        },
        createdAt: at,
        updatedAt: at,
      })),
    );
  } catch (error) {
    result.auditError = String((error as Error)?.message ?? error);
  }
  return result;
}

export function printPlan(plan: PriceRollbackPlan): void {
  console.log(`round ${plan.round}`);
  for (const p of plan.producers) {
    console.log(`  ${p.producer.padEnd(5)} supersede ${describe(p.supersede)}`);
    for (const c of p.restore) console.log(`  ${"".padEnd(5)} restore   ${describe(c)}`);
  }
  for (const e of plan.errors) console.log(`  ABORT ${e}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const round = arg("round") ?? "";
  const producers = (arg("producers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const migrationsDir = apply ? beforeImageDir() : "";
  const backupDir = arg("backup");
  if (!backupDir) throw new Error("--backup <P2 backup directory> is required.");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required.");

  const backup = readBackup<CircularRef>(backupDir, "priceCirculars");
  await mongoose.connect(uri);
  console.log(`connected: ${redact(uri)}`);
  console.log(apply ? "mode: APPLY (writing)\n" : "mode: plan only (nothing is written; pass --apply)\n");
  const db = mongoose.connection.db!;

  const plan = await planPriceRollback(db, round, producers, backup);
  printPlan(plan);
  if (!plan.ok) {
    console.log(`\nABORTED: ${plan.errors.length} problem(s). Nothing was written.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!apply) {
    console.log(`\nwould reactivate ${plan.producers.reduce((n, p) => n + p.restore.length, 0)} circular(s) and supersede ${plan.producers.length}.`);
    await mongoose.disconnect();
    return;
  }
  const result = await applyPriceRollback(db, plan, join(migrationsDir, `rollback-price-round-${round}-${Date.now()}.json`));
  console.log(`\nbefore-image saved: ${result.beforeImage} (sha256 ${result.beforeImageHash})`);
  console.log(`reactivated ${result.restored}, superseded ${result.superseded}; rolled back: ${result.completed.join(", ") || "none"}`);
  console.log(result.readBack.pass ? "read-back: PASS" : "read-back: FAIL");
  for (const f of result.readBack.failures) console.log(`  ${f}`);
  if (result.auditError) console.log(`  WARNING: the audit entry could not be written: ${result.auditError}`);
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
