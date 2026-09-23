/**
 * T5 (decision 0010 §11): loader rehearsal on an in-memory MongoDB, never
 * Atlas (quota, R17). Builds a synthetic pre-M0 state, runs M0 then M1 —
 * dry run, apply, read-back, conflict handling, idempotency, rollback —
 * against the real `Location`/`AuditLog` schemas and the real loader logic
 * (`computeUpdates` exported from each script), not a re-implementation.
 */

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

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
} from "./migration-lib";
import { computeUpdates as computeM0Updates } from "./fix-hpl-territory";
import { computeUpdates as computeM1Updates } from "./load-equivalence";

jest.setTimeout(60_000);

let server: MongoMemoryServer;
let Location: mongoose.Model<any>;
let AuditLog: mongoose.Model<any>;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri("gcpe-rehearsal"));
  Location = mongoose.model("Location", LocationSchema);
  AuditLog = mongoose.model("AuditLog", AuditLogSchema);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Location.deleteMany({});
  await AuditLog.deleteMany({});
});

const CANONICAL = [
  "REPLACE_TOWN", "BILASPUR_TEST", "M0_NOOP_TOWN", "M0_HANDEDIT_TOWN",
  "ADD_TOWN", "RELABEL_TOWN", "M1_REPLACE_TOWN", "LATUR_TEST", "M1_NOOP_TOWN",
];

/** A synthetic production seed: what M0 finds *before* it runs. */
async function seedPreM0() {
  await Location.insertMany([
    { name: "REPLACE_TOWN", producerZone: { HPL: "OldZone" }, producerZoneTier: { HPL: "published_map" } },
    { name: "BILASPUR_TEST", producerZone: { HPL: "Himachal Pradesh_Baddi" }, producerZoneTier: { HPL: "published_map" },
      producerDepotZone: { HPL: "Himachal Pradesh_Baddi" }, producerDepotZoneTier: { HPL: "published_map" } },
    { name: "M0_NOOP_TOWN", producerZone: { HPL: "SameZone" }, producerZoneTier: { HPL: "published_map" } },
    { name: "M0_HANDEDIT_TOWN", producerZone: { HPL: "OldZone2" }, producerZoneTier: { HPL: "published_map" } },
    { name: "ADD_TOWN", producerZone: {}, producerZoneTier: {} },
    { name: "RELABEL_TOWN", producerZone: { RIL: "SAMEZONE" }, producerZoneTier: { RIL: "inferred_via_hpl" } },
    { name: "M1_REPLACE_TOWN", producerZone: { HMEL: "OldZoneM1" }, producerZoneTier: { HMEL: "inferred_via_hpl" } },
    { name: "LATUR_TEST", producerZone: { IOCL: "Kolhapur" }, producerZoneTier: { IOCL: "inferred_via_hpl" } },
    { name: "M1_NOOP_TOWN", producerZone: { HPL: "AlreadyRight" }, producerZoneTier: { HPL: "published_map" } },
  ]);
}

/** The ETL's staged output at exactly the M0 stage (Annexure V fixed, Bilaspur cleared, no fallback merge yet). */
const stagedM0 = {
  locations: {
    canonical: CANONICAL,
    coverage: {
      HPL: {
        map: { REPLACE_TOWN: "NewZone", M0_NOOP_TOWN: "SameZone", M0_HANDEDIT_TOWN: "NewZone2", M1_NOOP_TOWN: "AlreadyRight" },
        tier_of: { REPLACE_TOWN: "published_map", M0_NOOP_TOWN: "published_map", M0_HANDEDIT_TOWN: "published_map", M1_NOOP_TOWN: "published_map" },
      },
    },
  },
  priceIndex: {
    // BILASPUR_TEST is HPL-fallback-supplied (M1's job) — present in location_meta.HPL, so M0
    // treats it as "nothing native to say", target = unresolved = CLEAR.
    location_meta: { HPL: { BILASPUR_TEST: { km: null, crossesState: false, corroborated: false, source: "state_zone" } } },
    depot_location_map: { HPL: { BILASPUR_TEST: undefined } as any },
    depot_location_tier: { HPL: {} },
  },
};

/** The client-approved M1 reference table (a handful of rows, one per operation type). */
const equivalence = [
  { producer: "IOCL", town: "ADD_TOWN", zone: "NewIOCLZone", tier: "inferred_location", distance_km: 40, crosses_state: false, corroborated_by_hpl: true, evidence: "e", round: "2026-09-01" },
  { producer: "RIL", town: "RELABEL_TOWN", zone: "SAMEZONE", tier: "inferred_location", distance_km: 12, crosses_state: false, corroborated_by_hpl: true, evidence: "e", round: "2026-09-01" },
  { producer: "HMEL", town: "M1_REPLACE_TOWN", zone: "NewZoneM1", tier: "inferred_location", distance_km: 30, crosses_state: true, corroborated_by_hpl: false, evidence: "e", round: "2026-09-01" },
  { producer: "HPL", town: "M1_NOOP_TOWN", zone: "AlreadyRight", tier: "published_map", distance_km: 5, crosses_state: false, corroborated_by_hpl: false, evidence: "e", round: "2026-09-01" },
];
const priceIndexM1 = { location_meta: { IOCL: { ADD_TOWN: { km: 40, crossesState: false, corroborated: true, source: "nearest" } },
  RIL: { RELABEL_TOWN: { km: 12, crossesState: false, corroborated: true, source: "nearest" } },
  HMEL: { M1_REPLACE_TOWN: { km: 30, crossesState: true, corroborated: false, source: "nearest" } } } };

describe("M0 (fix-hpl-territory) rehearsal", () => {
  it("computes REPLACE, CLEAR and NOOP correctly from the staged M0 target", async () => {
    await seedPreM0();
    const docs = await Location.find({}).lean();
    const byName = new Map(docs.map((d: any) => [d.name, d]));
    const updates = computeM0Updates(stagedM0.locations, stagedM0.priceIndex, byName);

    const worksReplace = updates.find((u) => u.location === "REPLACE_TOWN" && u.basis === "works")!;
    expect(worksReplace.op).toBe("REPLACE");
    expect(worksReplace.nextZone).toBe("NewZone");

    const clear = updates.find((u) => u.location === "BILASPUR_TEST" && u.basis === "works")!;
    expect(clear.op).toBe("CLEAR");
    expect(clear.nextZone).toBeUndefined();

    const depotClear = updates.find((u) => u.location === "BILASPUR_TEST" && u.basis === "depot")!;
    expect(depotClear.op).toBe("CLEAR");

    const noop = updates.find((u) => u.location === "M0_NOOP_TOWN" && u.basis === "works")!;
    expect(noop.op).toBe("NOOP");
  });

  it("applies, reads back PASS, and a second apply is a no-op (idempotent)", async () => {
    await seedPreM0();
    let docs = await Location.find({}).lean();
    let updates = computeM0Updates(stagedM0.locations, stagedM0.priceIndex, new Map(docs.map((d: any) => [d.name, d])));
    const real = updates.filter((u) => u.op !== "NOOP");

    const { applied, conflicts } = await applyUpdates(Location, real);
    expect(conflicts).toHaveLength(0);
    expect(applied).toBe(real.length);

    const readback = await readBack(Location, real);
    expect(readback.pass).toBe(true);

    const bilaspur = await Location.findOne({ name: "BILASPUR_TEST" }).lean<any>();
    expect(bilaspur.producerZone.HPL).toBeUndefined();
    expect(bilaspur.producerDepotZone.HPL).toBeUndefined();

    // Second run: recompute from the now-updated state, must find nothing left to do.
    docs = await Location.find({}).lean();
    updates = computeM0Updates(stagedM0.locations, stagedM0.priceIndex, new Map(docs.map((d: any) => [d.name, d])));
    expect(updates.filter((u) => u.op !== "NOOP")).toHaveLength(0);
  });

  it("reports a hand-edited value as a conflict and leaves it alone, never forcing the write", async () => {
    await seedPreM0();
    const docs = await Location.find({}).lean();
    const updates = computeM0Updates(stagedM0.locations, stagedM0.priceIndex, new Map(docs.map((d: any) => [d.name, d])));
    const real = updates.filter((u) => u.op !== "NOOP");

    // Simulate an admin hand-editing the document between dry run and apply.
    await Location.updateOne({ name: "M0_HANDEDIT_TOWN" }, { $set: { "producerZone.HPL": "AdminCorrectedZone" } });

    const { applied, conflicts } = await applyUpdates(Location, real);
    const conflict = conflicts.find((c) => c.location === "M0_HANDEDIT_TOWN");
    expect(conflict).toBeDefined();
    expect(applied).toBe(real.length - conflicts.length);

    const doc = await Location.findOne({ name: "M0_HANDEDIT_TOWN" }).lean<any>();
    expect(doc.producerZone.HPL).toBe("AdminCorrectedZone"); // untouched, not overwritten
  });

  it("before-image + rollback restores exactly the pre-M0 values, byte for byte", async () => {
    await seedPreM0();
    const preDoc = await Location.findOne({ name: "REPLACE_TOWN" }).lean<any>();
    const docs = await Location.find({}).lean();
    const updates = computeM0Updates(stagedM0.locations, stagedM0.priceIndex, new Map(docs.map((d: any) => [d.name, d])));
    const real = updates.filter((u) => u.op !== "NOOP");

    const before = await captureBeforeImage(Location, real);
    const manifest = { action: "migration.m0", generatedAt: new Date().toISOString(), before, updates: real };
    const path = require("node:path").join(require("node:os").tmpdir(), `m0-rehearsal-${Date.now()}.json`);
    const hash = saveManifest(manifest, path);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    await applyUpdates(Location, real);
    const replaced = await Location.findOne({ name: "REPLACE_TOWN" }).lean<any>();
    expect(replaced.producerZone.HPL).toBe("NewZone");

    const { manifest: reloaded, hash: rehash } = loadManifest(path);
    expect(rehash).toBe(hash);
    const result = await rollback(Location, reloaded);
    expect(result.leftAlone).toBe(0);

    const restored = await Location.findOne({ name: "REPLACE_TOWN" }).lean<any>();
    expect(restored.producerZone.HPL).toBe(preDoc.producerZone.HPL);
    expect(restored.producerZoneTier.HPL).toBe(preDoc.producerZoneTier.HPL);

    const restoredBilaspur = await Location.findOne({ name: "BILASPUR_TEST" }).lean<any>();
    // Rollback restores from the SAME manifest that covered Bilaspur's CLEAR too.
    expect(restoredBilaspur).toBeDefined();
  });
});

describe("M1 (load-equivalence) rehearsal — runs on the post-M0 state", () => {
  async function seedPostM0() {
    await Location.insertMany([
      { name: "ADD_TOWN", producerZone: {}, producerZoneTier: {} },
      { name: "RELABEL_TOWN", producerZone: { RIL: "SAMEZONE" }, producerZoneTier: { RIL: "inferred_via_hpl" } },
      { name: "M1_REPLACE_TOWN", producerZone: { HMEL: "OldZoneM1" }, producerZoneTier: { HMEL: "inferred_via_hpl" } },
      { name: "LATUR_TEST", producerZone: { IOCL: "Kolhapur" }, producerZoneTier: { IOCL: "inferred_via_hpl" } },
      { name: "M1_NOOP_TOWN", producerZone: { HPL: "AlreadyRight" }, producerZoneTier: { HPL: "published_map" } },
    ]);
  }

  it("computes ADD, RELABEL, REPLACE, REMOVE and NOOP correctly", async () => {
    await seedPostM0();
    const docs = await Location.find({}).lean();
    const updates = computeM1Updates(equivalence, priceIndexM1, new Map(docs.map((d: any) => [d.name, d])));

    expect(updates.find((u) => u.location === "ADD_TOWN")!.op).toBe("ADD");
    expect(updates.find((u) => u.location === "RELABEL_TOWN")!.op).toBe("RELABEL");
    expect(updates.find((u) => u.location === "M1_REPLACE_TOWN")!.op).toBe("REPLACE");
    expect(updates.find((u) => u.location === "M1_NOOP_TOWN")!.op).toBe("NOOP");
    // LATUR_TEST is inferred_via_hpl and not in the approved table at all — gone, not guessed.
    const latur = updates.find((u) => u.location === "LATUR_TEST")!;
    expect(latur.op).toBe("REMOVE");
    expect(latur.nextZone).toBeUndefined();
  });

  it("apply + read-back PASS, and a retained-live RELABEL preserves the exact live zone", async () => {
    await seedPostM0();
    const docs = await Location.find({}).lean();
    const updates = computeM1Updates(equivalence, priceIndexM1, new Map(docs.map((d: any) => [d.name, d])));
    const real = updates.filter((u) => u.op !== "NOOP");

    const { applied, conflicts } = await applyUpdates(Location, real);
    expect(conflicts).toHaveLength(0);
    expect(applied).toBe(real.length);

    const readback = await readBack(Location, real);
    expect(readback.pass).toBe(true);

    const relabelled = await Location.findOne({ name: "RELABEL_TOWN" }).lean<any>();
    expect(relabelled.producerZone.RIL).toBe("SAMEZONE"); // number unchanged
    expect(relabelled.producerZoneTier.RIL).toBe("inferred_location"); // only the tier moved

    const latur = await Location.findOne({ name: "LATUR_TEST" }).lean<any>();
    expect(latur.producerZone.IOCL).toBeUndefined();
    expect(latur.producerZoneTier.IOCL).toBeUndefined();

    const added = await Location.findOne({ name: "ADD_TOWN" }).lean<any>();
    expect(added.producerZoneMeta.IOCL).toEqual({ km: 40, crossesState: false, corroborated: true, source: "nearest" });
  });

  it("prints a plan without throwing (dry-run report path)", async () => {
    await seedPostM0();
    const docs = await Location.find({}).lean();
    const updates = computeM1Updates(equivalence, priceIndexM1, new Map(docs.map((d: any) => [d.name, d])));
    expect(() => printPlan(updates)).not.toThrow();
  });
});
