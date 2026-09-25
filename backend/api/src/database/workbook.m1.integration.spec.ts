/**
 * The production upgrade path, validated against the approved Competitor
 * Presence and Fallback Mapping workbook (2026-09-25): a database holding the
 * post-M0 state (HPL Annexure V fixed, Bilaspur cleared, legacy
 * inferred_via_hpl mappings still in place) has M1 (`load-equivalence`)
 * applied, is read back by `DatasetService`, and must then match the
 * workbook cell for cell. A second M1 run must change nothing.
 *
 * Needs the post-M0 regenerated data, which is in git history, not the
 * working tree (the ETL output at PR1's first commit, the Bilaspur guard, before
 * the fallback merge). Stage it and point GCPE_POST_M0_DATA at the directory:
 *
 *   git show <commit>:backend/data/normalized/<file>.json > <dir>/<file>.json
 *   for price_index, locations, freight, discounts, crossref
 *
 * Skipped, with a message, when GCPE_POST_M0_DATA is not set.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { assertLocalConnection, loadDatasetFromDb } from "./workbook-harness";
import { applyUpdates, opCounts, readBack } from "./migration-lib";
import { computeUpdates } from "./load-equivalence";
import { LocationSchema } from "./schemas/catalog.schema";
import { readApprovedWorkbook, validateAgainstWorkbook, WORKBOOK_DEFAULT } from "../tools/workbook-verify";

jest.setTimeout(180_000);

const POST_M0 = process.env.GCPE_POST_M0_DATA;
const REPO = join(__dirname, "..", "..", "..");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const describeIf = POST_M0 ? describe : describe.skip;
if (!POST_M0) {
  // eslint-disable-next-line no-console
  console.log("workbook.m1.integration.spec: skipped — set GCPE_POST_M0_DATA to a staged post-M0 data directory");
}

describeIf("M1 on post-M0 data reproduces the approved workbook", () => {
  let server: MongoMemoryServer;
  let Location: mongoose.Model<any>;
  let depotBefore: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri("gcpe-workbook-m1"));
    assertLocalConnection();
    process.env.GCPE_DATA = POST_M0; // read by seed.ts when it loads
    const { seed } = require("./seed");
    await seed(mongoose.connection);
    Location = mongoose.models.Location ?? mongoose.model("Location", LocationSchema);
    const docs = await Location.find({}).sort({ name: 1 }).lean<any[]>();
    depotBefore = JSON.stringify(docs.map((d) => [d.name, d.producerDepotZone, d.producerDepotZoneTier]));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  it("plans exactly the approved operation counts, applies them, and matches the workbook", async () => {
    const equivalence = read(join(REPO, "etl", "reference", "location_equivalence.json"));
    const priceIndex = read(join(REPO, "data", "normalized", "price_index.json"));
    const docs = await Location.find({}).lean<any[]>();
    const updates = computeUpdates(equivalence, priceIndex, new Map(docs.map((d) => [d.name, d])));

    // 1,078 rows examined = 1,016 approved + 60 retained + 2 removed (PR1 reconciliation):
    // 699 ADD, 257 RELABEL, 23 REPLACE, and the 97 rows confirming an HPL direct match now
    // record their distance/classification (META); 2 REMOVE are the Latur rows.
    expect(opCounts(updates)).toEqual({ ADD: 699, RELABEL: 257, REPLACE: 23, META: 97, REMOVE: 2 });
    const removed = updates.filter((u) => u.op === "REMOVE").map((u) => `${u.producer}|${u.location}`).sort();
    expect(removed).toEqual(["HMEL|LATUR", "IOCL|LATUR"]);
    const beawar = updates.filter((u) => u.location === "BEAWAR" && ["IOCL", "RIL", "OPaL"].includes(u.producer));
    for (const u of beawar) expect(u.nextMeta?.source).toBe("retained"); // candidates only via retained-live

    const real = updates.filter((u) => u.op !== "NOOP");
    const { applied, conflicts } = await applyUpdates(Location, real);
    expect(conflicts).toEqual([]);
    expect(applied).toBe(real.length);
    expect((await readBack(Location, real)).failures).toEqual([]);

    const after = await Location.find({}).sort({ name: 1 }).lean<any[]>();
    expect(JSON.stringify(after.map((d) => [d.name, d.producerDepotZone, d.producerDepotZoneTier]))).toBe(depotBefore);

    const wb = await readApprovedWorkbook(WORKBOOK_DEFAULT);
    const result = validateAgainstWorkbook(await loadDatasetFromDb(), wb);
    expect(result.mismatches).toEqual([]);
    expect(result.checked).toBe(1565);
  });

  it("a second M1 run finds nothing left to do", async () => {
    const equivalence = read(join(REPO, "etl", "reference", "location_equivalence.json"));
    const priceIndex = read(join(REPO, "data", "normalized", "price_index.json"));
    const docs = await Location.find({}).lean<any[]>();
    const updates = computeUpdates(equivalence, priceIndex, new Map(docs.map((d) => [d.name, d])));
    expect(updates.filter((u) => u.op !== "NOOP")).toEqual([]);
  });
});
