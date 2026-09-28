/**
 * C3 rollback tools on an in-memory MongoDB (never Atlas, R17): plan-only
 * writes nothing, apply restores exactly the backup, and every refusal
 * condition aborts before the first write. Runs the real exported logic of
 * `rollback-price-round.ts` and `rollback-depot-round.ts`.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { EJSON, canonical, loadBeforeImage, readBackup, sha256 } from "./release-lib";
import { applyPriceRollback, planPriceRollback } from "./rollback-price-round";
import { applyDepotRollback, planDepotRollback } from "./rollback-depot-round";

jest.setTimeout(60_000);

const { ObjectId } = mongoose.mongo;
let server: MongoMemoryServer;
let db: mongoose.mongo.Db;
const tmp = mkdtempSync(join(tmpdir(), "gcpe-rollback-"));

const AUG = new Date("2026-08-01T00:00:00.000Z");
const SEP1 = new Date("2026-09-01T00:00:00.000Z");
const SEP16 = new Date("2026-09-16T00:00:00.000Z");
const OCT1 = new Date("2026-10-01T00:00:00.000Z");
const id = () => new ObjectId();

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri("gcpe-rollback"));
  db = mongoose.connection.db!;
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

/** Everything in the database, canonical, for "nothing was written" assertions. */
async function snapshot() {
  const out: Record<string, string> = {};
  for (const { name } of await db.listCollections().toArray()) {
    out[name] = canonical(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pre-window state and what a publish of 2026-09-16 leaves behind
// ---------------------------------------------------------------------------
const C = {
  hmelAug: id(), hmelSep: id(), hplAug: id(), hplSep: id(), hplOld: id(),
  hmelNew: id(), hplNew: id(), hmelFiled: id(),
};
async function seedPreWindow() {
  await db.dropDatabase();
  await db.collection("priceCirculars").insertMany([
    { _id: C.hmelAug, producer: "HMEL", reference: "H-AUG", effectiveDate: AUG, status: "active", basis: "ex_works" },
    { _id: C.hmelSep, producer: "HMEL", reference: "H-SEP", effectiveDate: SEP1, status: "active", basis: "ex_works" },
    { _id: C.hplAug, producer: "HPL", reference: "P-AUG", effectiveDate: AUG, status: "active", basis: "ex_works" },
    { _id: C.hplSep, producer: "HPL", reference: "P-SEP", effectiveDate: SEP1, status: "active", basis: "ex_works" },
    { _id: C.hplOld, producer: "HPL", reference: "P-JUL", effectiveDate: new Date("2026-07-01T00:00:00Z"), status: "superseded", basis: "ex_works" },
  ]);
  await db.collection("priceEntries").insertMany([
    { circular: C.hmelSep, producer: "HMEL", effectiveDate: SEP1, zone: "Pune", grade: "G1", price: 100, basis: "ex_works" },
    { circular: C.hmelSep, producer: "HMEL", effectiveDate: SEP1, zone: "Pune", grade: "G1", price: 99, basis: "ex_depot" },
    { circular: C.hplSep, producer: "HPL", effectiveDate: SEP1, zone: "Orissa_Bargarh", grade: "G1", price: 101, basis: "ex_depot" },
  ]);
  await db.collection("locations").insertMany([
    { name: "SAMBALPUR", producerZone: { HPL: "Orissa_Bargarh" }, producerDepotZone: { HPL: "Orissa_Bargarh" }, producerDepotZoneTier: { HPL: "published_map" } },
    { name: "NASHIK", producerZone: { HMEL: "Nashik" }, producerDepotZone: { HMEL: "Nashik" }, producerDepotZoneTier: { HMEL: "exact" } },
    { name: "GOA", producerZone: { HMEL: "Goa" } },
  ]);
  await db.collection("discountSchemes").insertMany([
    { producer: "HMEL", effectiveDate: SEP1, cashDiscountDepot: 0 },
    { producer: "HPL", effectiveDate: SEP1 },
  ]);
  await db.collection("depotLoadAudits").insertOne({ effectiveDate: AUG, worksZoneFills: [{ producer: "HPL", location: "X", zone: "Y" }] });
}

/** A P2 backup of the three collections, in backup-collections' exact format. */
function writeBackup(dir: string, collections: Record<string, unknown[]>) {
  const sums: string[] = [];
  for (const [name, docs] of Object.entries(collections)) {
    const text = EJSON.stringify(docs, { relaxed: false });
    writeFileSync(join(dir, `${name}.ejson`), text);
    sums.push(`${sha256(text)}  ${name}.ejson`);
  }
  writeFileSync(join(dir, "SHA256SUMS"), sums.join("\n") + "\n");
}
async function takeBackup(): Promise<string> {
  const dir = mkdtempSync(join(tmp, "backup-"));
  writeBackup(dir, {
    locations: await db.collection("locations").find({}).toArray(),
    priceCirculars: await db.collection("priceCirculars").find({}).toArray(),
    discountSchemes: await db.collection("discountSchemes").find({}).toArray(),
  });
  return dir;
}

/** W1 + W3 as the real tools leave them: publish supersedes every active circular, load-depot adds rows + relabel. */
async function publishRound() {
  const circ = db.collection("priceCirculars");
  await circ.updateMany({ producer: { $in: ["HMEL", "HPL"] }, status: "active" }, { $set: { status: "superseded" } });
  await circ.insertMany([
    { _id: C.hmelNew, producer: "HMEL", reference: "H-16", effectiveDate: SEP16, status: "active", basis: "ex_works" },
    { _id: C.hplNew, producer: "HPL", reference: "P-16", effectiveDate: SEP16, status: "active", basis: "ex_works" },
    { _id: C.hmelFiled, producer: "HMEL", reference: "H-16 source", effectiveDate: SEP16, status: "draft", basis: "ex_works" },
  ]);
  await db.collection("priceEntries").insertMany([
    { circular: C.hmelNew, producer: "HMEL", effectiveDate: SEP16, zone: "Pune", grade: "G1", price: 110, basis: "ex_works" },
    { circular: C.hmelNew, producer: "HMEL", effectiveDate: SEP16, zone: "Pune", grade: "G1", price: 109, basis: "ex_depot" },
    { circular: C.hmelNew, producer: "HMEL", effectiveDate: SEP16, zone: "Mumbai", grade: "G1", price: 108, basis: "ex_depot" },
    { circular: C.hplNew, producer: "HPL", effectiveDate: SEP16, zone: "Orissa_Barhgarh", grade: "G1", price: 111, basis: "ex_depot" },
  ]);
  await db.collection("locations").updateOne(
    { name: "SAMBALPUR" },
    { $set: { producerDepotZone: { HPL: "Orissa_Barhgarh" }, producerZone: { HPL: "Orissa_Barhgarh" } } },
  );
}

const depotOpts = (dir: string, over: Partial<{ expect: number; expectLocations: string[] }> = {}) => ({
  round: "2026-09-16",
  expect: 3,
  expectLocations: ["SAMBALPUR"],
  backupLocations: readBackup(dir, "locations"),
  backupDiscounts: readBackup(dir, "discountSchemes"),
  ...over,
});

// ---------------------------------------------------------------------------
describe("release-lib backups", () => {
  it("refuses a backup file whose hash does not match SHA256SUMS", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    writeFileSync(join(dir, "locations.ejson"), readFileSync(join(dir, "locations.ejson"), "utf8").replace("NASHIK", "NASIK"));
    expect(() => readBackup(dir, "locations")).toThrow(/does not match its SHA256SUMS/);
    expect(() => readBackup(tmp, "locations")).toThrow(/SHA256SUMS not found/);
  });
});

describe("rollback-price-round (C3a)", () => {
  it("plans correctly and plan-only writes nothing", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    const before = await snapshot();
    const plan = await planPriceRollback(db, "2026-09-16", ["HMEL", "HPL"], readBackup(dir, "priceCirculars"));
    expect(plan.errors).toEqual([]);
    expect(plan.producers.map((p) => [p.producer, String(p.supersede._id), p.restore.map((c) => String(c._id)).sort()])).toEqual([
      ["HMEL", String(C.hmelNew), [String(C.hmelAug), String(C.hmelSep)].sort()],
      ["HPL", String(C.hplNew), [String(C.hplAug), String(C.hplSep)].sort()],
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it("applies: restores exactly the backed-up statuses, leaves entries alone, reads back PASS, saves a before-image", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    const circularsBefore = canonical((await db.collection("priceCirculars").find({}).sort({ _id: 1 }).toArray()).map((c) => ({ _id: c._id, status: c.status })));
    await publishRound();
    const entriesBefore = canonical(await db.collection("priceEntries").find({}).sort({ _id: 1 }).toArray());
    const plan = await planPriceRollback(db, "2026-09-16", ["HMEL", "HPL"], readBackup(dir, "priceCirculars"));
    const result = await applyPriceRollback(db, plan, join(tmp, "price-before.json"));
    expect(result.readBack).toEqual({ pass: true, failures: [] });
    expect([result.restored, result.superseded]).toEqual([4, 2]);

    const after = await db.collection("priceCirculars").find({}).sort({ _id: 1 }).toArray();
    const preExisting = after.filter((c) => ![C.hmelNew, C.hplNew, C.hmelFiled].some((n) => n.equals(c._id)));
    expect(canonical(preExisting.map((c) => ({ _id: c._id, status: c.status })))).toEqual(circularsBefore);
    expect(after.find((c) => c._id.equals(C.hmelNew))!.status).toBe("superseded");
    expect(after.find((c) => c._id.equals(C.hmelFiled))!.status).toBe("draft");
    expect(canonical(await db.collection("priceEntries").find({}).sort({ _id: 1 }).toArray())).toEqual(entriesBefore);

    const audit = await db.collection("auditLogs").find({ action: "price_circular.rollback" }).toArray();
    expect(audit.map((a) => a.detail.producer).sort()).toEqual(["HMEL", "HPL"]);
    expect(loadBeforeImage<any>(join(tmp, "price-before.json")).producers).toHaveLength(2);

    // A second run finds nothing to roll back and refuses.
    const again = await planPriceRollback(db, "2026-09-16", ["HMEL"], readBackup(dir, "priceCirculars"));
    expect(again.ok).toBe(false);
  });

  const refusals: [string, () => Promise<void>, RegExp][] = [
    ["the round circular is not active", async () => { await db.collection("priceCirculars").updateOne({ _id: C.hmelNew }, { $set: { status: "superseded" } }); }, /expected exactly one active circular dated 2026-09-16/],
    ["a second circular is active", async () => { await db.collection("priceCirculars").updateOne({ _id: C.hmelSep }, { $set: { status: "active" } }); }, /expected exactly one active/],
    ["a backed-up active circular was deleted", async () => { await db.collection("priceCirculars").deleteOne({ _id: C.hmelAug }); }, /no longer exists/],
    ["an older circular's status changed", async () => { await db.collection("priceCirculars").updateOne({ _id: C.hplOld }, { $set: { status: "draft" } }); }, /only the round may have changed it/],
    ["a later round exists", async () => {
      await db.collection("priceCirculars").insertOne({ producer: "HMEL", reference: "H-OCT", effectiveDate: OCT1, status: "draft", basis: "ex_works" });
    }, /created after the backup for a different date/],
  ];
  it.each(refusals)("refuses, writing nothing, when %s", async (_why, tamper, message) => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    await tamper();
    const before = await snapshot();
    const plan = await planPriceRollback(db, "2026-09-16", ["HMEL", "HPL"], readBackup(dir, "priceCirculars"));
    expect(plan.ok).toBe(false);
    expect(plan.errors.join("\n")).toMatch(message);
    await expect(applyPriceRollback(db, plan, join(tmp, "never.json"))).rejects.toThrow(/Refusing/);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a backup taken after the round was published, and an unknown producer", async () => {
    await seedPreWindow();
    await publishRound();
    const late = await takeBackup();
    const plan = await planPriceRollback(db, "2026-09-16", ["HMEL", "NOPE"], readBackup(late, "priceCirculars"));
    expect(plan.errors.join("\n")).toMatch(/HMEL: the backup already holds a 2026-09-16 circular/);
    expect(plan.errors.join("\n")).toMatch(/NOPE: no circulars for this producer/);
  });
});

describe("rollback-depot-round (C3b)", () => {
  it("plans correctly and plan-only writes nothing", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    // M1's works-zone change is R2's job; this tool must look only at depot fields.
    const before = await snapshot();
    const plan = await planDepotRollback(db, depotOpts(dir));
    expect(plan.errors).toEqual([]);
    expect(plan.entriesByProducer).toEqual({ HMEL: 2, HPL: 1 });
    expect(plan.locations.map((l) => l.name)).toEqual(["SAMBALPUR"]);
    expect(await snapshot()).toEqual(before);
  });

  it("applies: deletes only the round's ex-depot entries, restores only depot fields, reads back PASS", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    await db.collection("priceEntries").insertOne({ circular: id(), producer: "HMEL", effectiveDate: OCT1, zone: "Pune", grade: "G1", price: 120, basis: "ex_depot" });
    const plan = await planDepotRollback(db, depotOpts(dir));
    const result = await applyDepotRollback(db, plan, join(tmp, "depot-before.json"));
    expect(result.readBack).toEqual({ pass: true, failures: [] });
    expect([result.deleted, result.restored]).toEqual([3, 1]);

    const entries = await db.collection("priceEntries").find({}).toArray();
    expect(entries.filter((e) => e.basis === "ex_depot").map((e) => e.effectiveDate.toISOString().slice(0, 10)).sort()).toEqual(["2026-09-01", "2026-09-01", "2026-10-01"]);
    expect(entries.filter((e) => e.effectiveDate.getTime() === SEP16.getTime()).map((e) => e.basis)).toEqual(["ex_works"]);

    const sambalpur = await db.collection("locations").findOne({ name: "SAMBALPUR" });
    expect(sambalpur!.producerDepotZone).toEqual({ HPL: "Orissa_Bargarh" });
    expect(sambalpur!.producerZone).toEqual({ HPL: "Orissa_Barhgarh" }); // works side untouched (R2 restores it)
    const nashik = await db.collection("locations").findOne({ name: "NASHIK" });
    expect(nashik!.producerDepotZone).toEqual({ HMEL: "Nashik" });

    const image = loadBeforeImage<any>(join(tmp, "depot-before.json"));
    expect(image.entries).toHaveLength(3);
    expect((await db.collection("auditLogs").findOne({ action: "depot.rollback" }))!.detail.deleted).toBe(3);
  });

  it("restores an absent depot map by unsetting it", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    await db.collection("locations").updateOne({ name: "GOA" }, { $set: { producerDepotZone: { HMEL: "Goa" }, producerDepotZoneTier: { HMEL: "exact" } } });
    const plan = await planDepotRollback(db, depotOpts(dir, { expectLocations: ["GOA", "SAMBALPUR"] }));
    const result = await applyDepotRollback(db, plan, join(tmp, "depot-goa.json"));
    expect(result.readBack.pass).toBe(true);
    const goa = await db.collection("locations").findOne({ name: "GOA" });
    expect("producerDepotZone" in goa!).toBe(false);
    expect("producerDepotZoneTier" in goa!).toBe(false);
  });

  const refusals: [string, () => Promise<void>, Partial<{ expect: number; expectLocations: string[] }>, RegExp][] = [
    ["the entry count differs from --expect", async () => {}, { expect: 27460 }, /found 3 ex-depot entries dated 2026-09-16, expected exactly 27460/],
    ["an entry belongs to a circular of another date", async () => {
      await db.collection("priceEntries").insertOne({ circular: C.hmelSep, producer: "HMEL", effectiveDate: SEP16, zone: "X", grade: "G1", price: 1, basis: "ex_depot" });
    }, { expect: 4 }, /1 targeted entry does not belong to a 2026-09-16 circular/],
    ["an entry's circular belongs to another producer", async () => {
      await db.collection("priceEntries").insertOne({ circular: C.hplNew, producer: "HMEL", effectiveDate: SEP16, zone: "X", grade: "G1", price: 1, basis: "ex_depot" });
    }, { expect: 4 }, /does not belong/],
    ["an unexpected location's depot map changed", async () => {
      await db.collection("locations").updateOne({ name: "NASHIK" }, { $set: { producerDepotZone: { HMEL: "Pune" } } });
    }, {}, /differs from the backup: \[NASHIK, SAMBALPUR\]; expected \[SAMBALPUR\]/],
    ["an expected location did not change", async () => {}, { expectLocations: ["SAMBALPUR", "NASHIK"] }, /expected \[NASHIK, SAMBALPUR\]/],
    ["a location was deleted", async () => { await db.collection("locations").deleteOne({ name: "GOA" }); }, {}, /no longer in the database: GOA/],
    ["load-depot recorded works-zone fills", async () => {
      await db.collection("depotLoadAudits").insertOne({ effectiveDate: SEP16, worksZoneFills: [{ producer: "HPL", location: "GOA", zone: "Z" }] });
    }, {}, /recorded 1 works-zone fill/],
    ["a depot cash discount changed", async () => {
      await db.collection("discountSchemes").updateOne({ producer: "HPL" }, { $set: { cashDiscountDepot: 250 } });
    }, {}, /discount schemes differ from the backup \(HPL 2026-09-01\)/],
  ];
  it.each(refusals)("refuses, writing nothing, when %s", async (_why, tamper, over, message) => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    await tamper();
    const before = await snapshot();
    const plan = await planDepotRollback(db, depotOpts(dir, over));
    expect(plan.ok).toBe(false);
    expect(plan.errors.join("\n")).toMatch(message);
    await expect(applyDepotRollback(db, plan, join(tmp, "never.json"))).rejects.toThrow(/Refusing/);
    expect(await snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Failure paths and edge cases added after the pre-review (M1, M2, L1, L2, L3)
// ---------------------------------------------------------------------------
describe("rollback-price-round failure paths (M1)", () => {
  it("a failed reactivation leaves that producer exactly as it was and stops before the next producer", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    const plan = await planPriceRollback(db, "2026-09-16", ["HMEL", "HPL"], readBackup(dir, "priceCirculars"));
    expect(plan.ok).toBe(true);
    // Between plan and apply, something reactivates HMEL's 1 Aug circular: its compare-and-set must fail.
    await db.collection("priceCirculars").updateOne({ _id: C.hmelAug }, { $set: { status: "active" } });
    const result = await applyPriceRollback(db, plan, join(tmp, "m1-first.json"));
    expect(result.readBack.pass).toBe(false);
    expect(result.completed).toEqual([]);
    const status = async (id: any) => (await db.collection("priceCirculars").findOne({ _id: id }))!.status;
    expect(await status(C.hmelNew)).toBe("active"); // the round is still served for HMEL
    expect(await status(C.hmelSep)).toBe("superseded"); // reactivated then put back
    expect(await status(C.hplNew)).toBe("active"); // HPL untouched
    expect(await status(C.hplSep)).toBe("superseded");
    expect(result.readBack.failures.join("\n")).toMatch(/HMEL: not rolled back[\s\S]*stopped; not rolled back: HMEL, HPL/);
  });

  it("a failure on a later producer keeps the earlier ones rolled back and reports exactly which", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    const plan = await planPriceRollback(db, "2026-09-16", ["HMEL", "HPL"], readBackup(dir, "priceCirculars"));
    await db.collection("priceCirculars").deleteOne({ _id: C.hplAug });
    const result = await applyPriceRollback(db, plan, join(tmp, "m1-second.json"));
    expect(result.completed).toEqual(["HMEL"]);
    expect(result.readBack.pass).toBe(false);
    const active = async (p: string) => (await db.collection("priceCirculars").find({ producer: p, status: "active" }).toArray()).map((c) => String(c._id)).sort();
    expect(await active("HMEL")).toEqual([String(C.hmelAug), String(C.hmelSep)].sort());
    expect(await active("HPL")).toEqual([String(C.hplNew)]); // never left without an active circular
  });

  it("refuses an invalid round, duplicate producers, and a round circular stored off UTC midnight", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    const backup = readBackup(dir, "priceCirculars");
    expect((await planPriceRollback(db, "2026-02-30", ["HMEL"], backup)).errors.join()).toMatch(/real date/);
    expect((await planPriceRollback(db, "2026-09-16", ["HMEL", "HMEL"], backup)).errors.join()).toMatch(/twice/);
    // Stored at IST midnight (2026-09-15T18:30Z) it is not the 2026-09-16 round: refuse, never guess.
    await db.collection("priceCirculars").updateOne({ _id: C.hmelNew }, { $set: { effectiveDate: new Date("2026-09-15T18:30:00Z") } });
    const plan = await planPriceRollback(db, "2026-09-16", ["HMEL"], backup);
    expect(plan.ok).toBe(false);
    expect(plan.errors.join()).toMatch(/expected exactly one active circular dated 2026-09-16/);
  });
});

describe("rollback-depot-round failure paths (M2)", () => {
  it("a location changed between plan and apply: refuses before any write", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    const plan = await planDepotRollback(db, depotOpts(dir));
    await db.collection("locations").updateOne({ name: "SAMBALPUR" }, { $set: { producerDepotZone: { HPL: "Somewhere" } } });
    const before = await snapshot();
    await expect(applyDepotRollback(db, plan, join(tmp, "m2-changed.json"))).rejects.toThrow(/changed between plan and apply. Nothing was written/);
    expect(await snapshot()).toEqual(before);
  });

  it("a location restore failing at write time puts the restored ones back and deletes nothing", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    await publishRound();
    await db.collection("locations").updateOne({ name: "GOA" }, { $set: { producerDepotZone: { HMEL: "Goa" }, producerDepotZoneTier: { HMEL: "exact" } } });
    const plan = await planDepotRollback(db, depotOpts(dir, { expectLocations: ["GOA", "SAMBALPUR"] }));
    const depotOf = async (n: string) => canonical(await db.collection("locations").findOne({ name: n }, { projection: { _id: 0, producerDepotZone: 1, producerDepotZoneTier: 1 } }));
    const goaBefore = await depotOf("GOA"), sambalpurBefore = await depotOf("SAMBALPUR");
    // Make the second location update match nothing, as if it changed in the instant before the write.
    const proto = Object.getPrototypeOf(db.collection("locations"));
    const original = proto.updateOne;
    let calls = 0;
    proto.updateOne = function (this: any, ...args: any[]) {
      if (this.collectionName === "locations" && ++calls === 2) return Promise.resolve({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null });
      return original.apply(this, args);
    };
    let result;
    try {
      result = await applyDepotRollback(db, plan, join(tmp, "m2-conflict.json"));
    } finally {
      proto.updateOne = original;
    }
    expect(result!.readBack.pass).toBe(false);
    expect(result!.deleted).toBe(0);
    expect(result!.readBack.failures.join()).toMatch(/stopped before deleting/);
    expect(await db.collection("priceEntries").countDocuments({ effectiveDate: SEP16, basis: "ex_depot" })).toBe(3);
    expect(await depotOf("GOA")).toBe(goaBefore); // the first restore was put back
    expect(await depotOf("SAMBALPUR")).toBe(sambalpurBefore);
  });

  it("a backup written with $numberDouble does not raise a false discount difference (L1)", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    // Rewrite the discount backup as another tool would (doubles kept as doubles), with a fresh SHA256SUMS entry.
    const docs = readBackup<any>(dir, "discountSchemes").map((d) => (d.cashDiscountDepot === undefined ? d : { ...d, cashDiscountDepot: new mongoose.mongo.BSON.Double(Number(d.cashDiscountDepot)) }));
    expect(EJSON.stringify(docs, { relaxed: false })).toMatch(/\$numberDouble/);
    const alt = mkdtempSync(join(tmp, "backup-double-"));
    writeBackup(alt, { locations: readBackup(dir, "locations"), discountSchemes: docs });
    await publishRound();
    const plan = await planDepotRollback(db, { ...depotOpts(alt) });
    expect(plan.errors).toEqual([]);
  });

  it("refuses an invalid round before reading anything", async () => {
    await seedPreWindow();
    const dir = await takeBackup();
    const plan = await planDepotRollback(db, { ...depotOpts(dir), round: "2026-02-30" });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join()).toMatch(/real date/);
  });
});
