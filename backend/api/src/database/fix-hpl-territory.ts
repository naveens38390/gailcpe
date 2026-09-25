/**
 * M0 (decision 0010 §9.1): load the HPL Annexure V table-cell fix (decision
 * 0009) onto a database that has never received it, and clear — not correct
 * — HPL's Bilaspur mapping.
 *
 * REPLACE: a works or depot location whose HPL mapping the old, line-based
 * Annexure V reader got wrong (R19) now gets the zone the corrected,
 * table-cell reader gives.
 *
 * CLEAR: HPL Bilaspur, works and depot. Bilaspur is a real Chhattisgarh town
 * and, separately, a real Himachal Pradesh district; the old resolver had no
 * state check at all and always returned the HP one (R20). The state guard
 * (`locations.py`) now rejects that match — but production's HPL resolver
 * has no whole-state mechanism to supply the *correct* Chhattisgarh answer;
 * that is `load-equivalence.ts` (M1)'s job, via rule S. Between M0 and M1,
 * Bilaspur honestly reads "not published" — decided as an acceptable, short
 * gap rather than a wrong price (§14 decision 8): ship M0 and M1 in the same
 * release window.
 *
 * Scope: HPL only. Never touches another producer, and never adds a mapping
 * HPL's own resolver did not find natively — a town the fallback table
 * supplies (present in `price_index.json`'s `location_meta.HPL`) is M1's
 * job, not this script's; this script's target for such a town is
 * "unresolved" (the same as if the fallback table did not exist yet), which
 * is exactly what "M0 without M1" is supposed to mean.
 *
 *   MONGODB_URI=... npm run fix-hpl-territory                        # dry run
 *   MONGODB_URI=... npm run fix-hpl-territory -- --apply
 *   MONGODB_URI=... npm run fix-hpl-territory -- --verify
 *   MONGODB_URI=... npm run fix-hpl-territory -- --rollback <manifest.json>
 *
 * GCPE_DATA must point at a clean checkout's regenerated data/normalized —
 * never a working folder (release-checklist.md's rule). The API caches the
 * dataset per round in memory; restart it after --apply.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import { LocationSchema } from "./schemas/catalog.schema";
import { AuditLogSchema } from "./schemas/activity.schema";
import {
  applyUpdates,
  captureBeforeImage,
  loadManifest,
  opFor,
  printPlan,
  readBack,
  rollback,
  saveManifest,
  writeAuditEntry,
  type LocationFieldUpdate,
  type MigrationOp,
} from "./migration-lib";

const DATA = process.env.GCPE_DATA ?? join(__dirname, "..", "..", "..", "data", "normalized");
const MIGRATIONS_DIR = process.env.GCPE_MIGRATIONS_DIR ?? join(__dirname, "..", "..", "..", "migrations");
const read = (name: string) => JSON.parse(readFileSync(join(DATA, `${name}.json`), "utf8"));
const ACTION = "migration.m0";

export function computeUpdates(locations: any, priceIndex: any, currentDocs: Map<string, any>): LocationFieldUpdate[] {
  const canonical: string[] = locations.canonical;
  // A town the fallback table supplies is M1's job — this script's target for it is
  // "unresolved", the same as before the fallback table existed. A table row with
  // `supplied: false` only confirms a zone HPL's own district list already gives (the
  // workbook shows those too, with a distance), so it stays in this script's target.
  // Data built before 2026-09-25 has no `supplied` field and only supplied rows.
  const m1Supplied: Set<string> = new Set(
    Object.entries<any>(priceIndex.location_meta?.HPL ?? {})
      .filter(([, meta]) => meta?.supplied !== false)
      .map(([town]) => town),
  );
  const cov = locations.coverage.HPL;
  const depotMap = priceIndex.depot_location_map?.HPL ?? {};
  const depotTier = priceIndex.depot_location_tier?.HPL ?? {};

  // M0's own operation names (§9.1): REPLACE (a wrong value corrected) and CLEAR (a wrong
  // value removed, with no replacement yet — Bilaspur). opFor()'s REMOVE means exactly CLEAR
  // here; there is no REMOVE in M0's vocabulary at all. An ADD would mean a town HPL's old
  // resolver never touched now gets a first-ever mapping — the design lists none, so it is
  // reported as-is (never silently relabelled) if the live data ever turns one up.
  const m0Label = (op: MigrationOp): MigrationOp => (op === "REMOVE" ? "CLEAR" : op);

  const updates: LocationFieldUpdate[] = [];
  for (const name of canonical) {
    const doc = currentDocs.get(name);

    const targetZone = m1Supplied.has(name) ? undefined : cov.map?.[name];
    const targetTier = targetZone ? cov.tier_of?.[name] : undefined;
    const currentZone = doc?.producerZone?.HPL;
    const currentTier = doc?.producerZoneTier?.HPL;
    updates.push({
      location: name, producer: "HPL", basis: "works",
      op: m0Label(opFor(currentZone, targetZone)),
      expectedZone: currentZone, expectedTier: currentTier,
      nextZone: targetZone, nextTier: targetTier,
    });

    const depotTarget = depotMap[name];
    const depotTargetTier = depotTarget ? depotTier[name] : undefined;
    const currentDepotZone = doc?.producerDepotZone?.HPL;
    const currentDepotTier = doc?.producerDepotZoneTier?.HPL;
    updates.push({
      location: name, producer: "HPL", basis: "depot",
      op: m0Label(opFor(currentDepotZone, depotTarget)),
      expectedZone: currentDepotZone, expectedTier: currentDepotTier,
      nextZone: depotTarget, nextTier: depotTargetTier,
    });
  }
  return updates;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  const rollbackIdx = process.argv.indexOf("--rollback");
  const rollbackPath = rollbackIdx >= 0 ? process.argv[rollbackIdx + 1] : undefined;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required.");
  await mongoose.connect(uri);
  console.log(`connected: ${uri.replace(/\/\/[^@]*@/, "//***@")}`);

  const Location = mongoose.model("Location", LocationSchema);
  const AuditLog = mongoose.model("AuditLog", AuditLogSchema);

  if (rollbackPath) {
    console.log(`mode: ROLLBACK from ${rollbackPath}\n`);
    const { manifest } = loadManifest(rollbackPath);
    if (manifest.action !== ACTION) {
      throw new Error(`${rollbackPath} is a ${manifest.action} manifest, not ${ACTION}. Refusing.`);
    }
    const result = await rollback(Location, manifest);
    console.log(`restored ${result.restored}, left alone ${result.leftAlone} (changed since the migration ran)`);
    for (const c of result.conflicts) console.log(`  ${c}`);
    await writeAuditEntry(AuditLog, `${ACTION}.rollback`, result);
    console.log("\nRestart the API — the dataset is cached per round.");
    await mongoose.disconnect();
    return;
  }

  const locations = read("locations");
  const priceIndex = read("price_index");
  const docs = await Location.find({}).lean<any[]>();
  const byName = new Map(docs.map((d) => [d.name, d]));

  const updates = computeUpdates(locations, priceIndex, byName);
  const real = updates.filter((u) => u.op !== "NOOP");
  console.log(`${real.length} change(s) proposed (of ${updates.length} locations x basis checked):\n`);
  printPlan(updates);

  if (verify) {
    console.log(
      real.length === 0
        ? "\nVERIFY: database already matches the staged data exactly."
        : `\nVERIFY: ${real.length} location(s) differ from the staged data.`,
    );
    await mongoose.disconnect();
    process.exit(real.length === 0 ? 0 : 1);
  }

  if (!apply) {
    console.log("\nDry run only — nothing written. Pass --apply to write.");
    await mongoose.disconnect();
    return;
  }

  if (real.length === 0) {
    console.log("\nNothing to apply — already up to date.");
    await mongoose.disconnect();
    return;
  }

  const before = await captureBeforeImage(Location, real);
  const manifestPath = join(MIGRATIONS_DIR, `m0-${Date.now()}.json`);
  const hash = saveManifest({ action: ACTION, generatedAt: new Date().toISOString(), before, updates: real }, manifestPath);
  console.log(`\nbefore-image saved: ${manifestPath} (sha256 ${hash})`);

  const { applied, conflicts } = await applyUpdates(Location, real);
  console.log(`applied ${applied}, ${conflicts.length} conflict(s) (skipped, not forced)`);
  for (const c of conflicts) console.log(`  CONFLICT ${c.producer} ${c.basis} ${c.location}: expected ${c.expectedZone ?? "(absent)"}, database disagrees — left alone`);

  const readback = await readBack(Location, real.filter((u) => !conflicts.includes(u)));
  console.log(readback.pass ? "read-back: PASS" : "read-back: FAIL");
  for (const f of readback.failures) console.log(`  ${f}`);

  await writeAuditEntry(AuditLog, ACTION, {
    applied,
    conflicts: conflicts.length,
    manifestPath,
    manifestHash: hash,
    readbackPass: readback.pass,
  });

  console.log("\nRestart the API — the dataset is cached per round.");
  await mongoose.disconnect();
  if (!readback.pass) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
