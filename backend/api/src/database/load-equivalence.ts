/**
 * M1 (decision 0010 §9.2): load the Ex-Works nearest-location fallback table
 * — the client-approved Option 3 set (1,016 new + 60 retained-live rows,
 * `backend/etl/reference/location_equivalence.json`) — onto a database that
 * has already received M0 (`fix-hpl-territory.ts`; M1 assumes it has run).
 *
 * Four operation types, derived from the table itself plus what production
 * currently holds — nothing here is a second, independent computation of the
 * mapping; the table was already reviewed and gated (`equivalence.py`) and
 * this only compares it to the database:
 *
 *   ADD      town had no zone for this producer at all
 *   RELABEL  same zone as today, only the tier string changes (legacy
 *            inferred_via_hpl -> inferred_location, or a retained-live row)
 *   REPLACE  the zone itself changes
 *   REMOVE   currently `inferred_via_hpl` for a town/producer NOT in the
 *            approved table (the 2 Latur rows) — decision 0010 §9.2/§9.3:
 *            after WP2a there is no other source of an inferred works
 *            mapping, so anything the table does not carry is gone, not
 *            reduced to a guess
 *
 * A row already matching production (HPL's own genuine district match, the
 * documented no-op bucket) writes nothing.
 *
 *   MONGODB_URI=... npm run load-equivalence                        # dry run
 *   MONGODB_URI=... npm run load-equivalence -- --apply
 *   MONGODB_URI=... npm run load-equivalence -- --verify
 *   MONGODB_URI=... npm run load-equivalence -- --rollback <manifest.json>
 *
 * GCPE_DATA must point at a clean checkout's regenerated data/normalized —
 * never a working folder. The API caches the dataset per round in memory;
 * restart it after --apply.
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
  printPlan,
  readBack,
  rollback,
  saveManifest,
  writeAuditEntry,
  type LocationFieldUpdate,
} from "./migration-lib";

const DATA = process.env.GCPE_DATA ?? join(__dirname, "..", "..", "..", "data", "normalized");
const REFERENCE = process.env.GCPE_REFERENCE ?? join(__dirname, "..", "..", "..", "etl", "reference");
const MIGRATIONS_DIR = process.env.GCPE_MIGRATIONS_DIR ?? join(__dirname, "..", "..", "..", "migrations");
const read = (name: string) => JSON.parse(readFileSync(join(DATA, `${name}.json`), "utf8"));
const ACTION = "migration.m1";

// Option 3, approved 2026-09-22: 1,016 new + 60 retained-live. A different count on the day
// this runs means the table was regenerated without carrying that approval through. Checked
// in main(), not here — computeUpdates stays a pure function testable at any size, the same
// separation equivalence.py's validate()/_row_problems() uses on the ETL side.
export const EXPECTED_ROWS = 1076;

export function computeUpdates(
  equivalence: any[],
  priceIndex: any,
  currentDocs: Map<string, any>,
): LocationFieldUpdate[] {
  const covered = new Set<string>(); // `${producer}|${town}`
  const updates: LocationFieldUpdate[] = [];

  for (const row of equivalence) {
    covered.add(`${row.producer}|${row.town}`);
    const doc = currentDocs.get(row.town);
    const currentZone = doc?.producerZone?.[row.producer];
    const currentTier = doc?.producerZoneTier?.[row.producer];

    // opFor alone only distinguishes "same zone" from "different"; RELABEL (same zone, tier
    // string changes — legacy inferred_via_hpl -> inferred_location) needs the tier compared too.
    let op: LocationFieldUpdate["op"];
    if (currentZone === undefined) op = "ADD";
    else if (currentZone !== row.zone) op = "REPLACE";
    else if (currentTier !== row.tier) op = "RELABEL";
    else op = "NOOP";

    const nextMeta =
      op === "NOOP"
        ? undefined
        : (priceIndex.location_meta?.[row.producer]?.[row.town] ?? {
            km: row.distance_km,
            crossesState: row.crosses_state,
            corroborated: row.corroborated_by_hpl,
            source: row.tier === "published_map" ? "annexure_v" : row.tier === "state_zone" ? "state_zone" : "nearest",
          });
    updates.push({
      location: row.town, producer: row.producer, basis: "works",
      op,
      expectedZone: currentZone, expectedTier: currentTier,
      nextZone: row.zone, nextTier: op === "NOOP" ? currentTier : row.tier, nextMeta,
    });
  }

  // Anything currently inferred_via_hpl that the approved table does not cover is gone —
  // WP2a means there is no other source of an inferred works mapping left to fall back to.
  for (const [name, doc] of currentDocs) {
    for (const [producer, tier] of Object.entries<any>(doc.producerZoneTier ?? {})) {
      if (tier !== "inferred_via_hpl") continue;
      if (covered.has(`${producer}|${name}`)) continue;
      updates.push({
        location: name, producer, basis: "works", op: "REMOVE",
        expectedZone: doc.producerZone[producer], expectedTier: tier,
        nextZone: undefined, nextTier: undefined, nextMeta: undefined,
      });
    }
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

  const equivalence = JSON.parse(readFileSync(join(REFERENCE, "location_equivalence.json"), "utf8"));
  if (equivalence.length !== EXPECTED_ROWS) {
    throw new Error(
      `location_equivalence.json has ${equivalence.length} rows, expected ${EXPECTED_ROWS} ` +
        "(the approved Option 3 set: 1,016 new + 60 retained-live). Stopping rather than loading a set that does not match what was reviewed.",
    );
  }
  const priceIndex = read("price_index");
  const docs = await Location.find({}).lean<any[]>();
  const byName = new Map(docs.map((d) => [d.name, d]));

  const updates = computeUpdates(equivalence, priceIndex, byName);
  const real = updates.filter((u) => u.op !== "NOOP");
  console.log(`${real.length} change(s) proposed (of ${updates.length} rows checked against ${equivalence.length} approved + retained):\n`);
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
  const manifestPath = join(MIGRATIONS_DIR, `m1-${Date.now()}.json`);
  const hash = saveManifest({ action: ACTION, generatedAt: new Date().toISOString(), before, updates: real }, manifestPath);
  console.log(`\nbefore-image saved: ${manifestPath} (sha256 ${hash})`);

  const { applied, conflicts } = await applyUpdates(Location, real);
  console.log(`applied ${applied}, ${conflicts.length} conflict(s) (skipped, not forced)`);
  for (const c of conflicts) console.log(`  CONFLICT ${c.producer} ${c.location}: expected ${c.expectedZone ?? "(absent)"}, database disagrees — left alone`);

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
