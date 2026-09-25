/**
 * The approved Competitor Presence and Fallback Mapping workbook (2026-09-25)
 * reproduced through the database path: a fresh `seed()` of the committed data
 * into an in-memory MongoDB, read back by `DatasetService`, compared cell by
 * cell with the workbook file.
 */

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { assertLocalConnection, loadDatasetFromDb } from "./workbook-harness";
import { readApprovedWorkbook, validateAgainstWorkbook, WORKBOOK_DEFAULT } from "../tools/workbook-verify";

jest.setTimeout(180_000);

let server: MongoMemoryServer;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri("gcpe-workbook-seed"));
  assertLocalConnection();
  // Required, not imported: seed.ts reads GCPE_DATA when it loads. The default is the
  // committed backend/data/normalized — which is what this test means to seed.
  delete process.env.GCPE_DATA;
  const { seed } = require("./seed");
  await seed(mongoose.connection);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

it("a freshly seeded database reproduces the approved workbook exactly", async () => {
  const wb = await readApprovedWorkbook(WORKBOOK_DEFAULT);
  const result = validateAgainstWorkbook(await loadDatasetFromDb(), wb);
  expect(result.mismatches).toEqual([]);
  expect(result.checked).toBe(1565);
  expect(result.counts).toEqual({
    "Exact Published Match": 334,
    "Territory Match": 278,
    "Inferred Location Match": 738,
    "Retained Existing Mapping": 60,
    "No Approved Mapping": 155,
  });
});
