/**
 * Release-window helpers that need no database: value-based number comparison
 * (L1), strict round dates (L2), the document hash (the nested-field defect the
 * rollback rehearsal found) and the baseline's write rules (H1).
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";

import { DOCUMENT_HASH_VERSION, documentHash, numericValue, same, validRound } from "../../database/release-lib";
import { BASELINE_FILE, assertBaselineWritable, loadBaseline, saveBaseline } from "./baseline";

const { Int32, Double, Long, Decimal128, ObjectId } = mongoose.mongo.BSON;

describe("numbers compare by value, not by BSON type (L1)", () => {
  it.each([
    ["Int32 / Double", new Int32(5), new Double(5)],
    ["Int64 / Double", Long.fromNumber(5), new Double(5)],
    ["Decimal128 / Int32", Decimal128.fromString("5.0"), new Int32(5)],
    ["Decimal128 exponent / number", Decimal128.fromString("1E+2"), 100],
    ["JS number / Double", 0, new Double(0)],
    ["-0 / 0", new Double(-0), 0],
    ["fraction Double / Decimal128", new Double(0.5), Decimal128.fromString("0.50")],
  ])("%s are equal", (_label, a, b) => {
    expect(same({ x: a }, { x: b })).toBe(true);
  });
  it.each([
    ["5 / 5.5", new Int32(5), new Double(5.5)],
    ["5 / 50", 5, 50],
    ["1 / -1", 1, -1],
    ["number / string", 5, "5"],
  ])("%s are different", (_label, a, b) => {
    expect(same({ x: a }, { x: b })).toBe(false);
  });
  it("normalises spellings", () => {
    expect(["5", "5.0", "05", "0.5e1", "500e-2"].map(numericValue)).toEqual(Array(5).fill("5e0"));
    expect(numericValue("-0.0")).toBe("0");
    expect(numericValue("NaN")).toBe("NaN");
    expect(numericValue("-Infinity")).toBe("-Infinity");
  });
});

describe("round dates are strict (L2)", () => {
  it.each(["2026-09-16", "2028-02-29", "2026-12-31"])("accepts %s", (d) => expect(validRound(d)).toBe(true));
  it.each(["2026-02-30", "2027-02-29", "2026-13-01", "2026-9-16", "16-09-2026", "2026-09-16T00:00", "2026-09-16 ", "", "2026/09/16"])(
    "refuses %p",
    (d) => expect(validRound(d)).toBe(false),
  );
});

describe("documentHash", () => {
  const base = { _id: new ObjectId("6a9bdab26a117ec21c0de396"), name: "LONAWALA", producerZone: { HMEL: "Khalapur", HPL: "Pune" }, updatedAt: new Date(1), __v: 0 };
  it("sees a change to a nested field (the defect the rehearsal found)", () => {
    expect(documentHash({ ...base, producerZone: { HMEL: "Pune", HPL: "Pune" } })).not.toBe(documentHash(base));
  });
  it("ignores key order, updatedAt, __v and numeric BSON type", () => {
    const reordered = { producerZone: { HPL: "Pune", HMEL: "Khalapur" }, name: "LONAWALA", _id: base._id, updatedAt: new Date(2), __v: 3 };
    expect(documentHash(reordered)).toBe(documentHash(base));
    expect(documentHash({ ...base, km: new Double(54) })).toBe(documentHash({ ...base, km: 54 }));
  });
});

describe("baseline write rules (H1)", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "gcpe-baseline-"));
  it("writes a new baseline with the hash version", () => {
    const d = dir();
    const saved = saveBaseline(d, { a: 1 }, { force: false, failedChecks: 0 });
    expect(JSON.parse(readFileSync(saved.path, "utf8"))).toEqual({ a: 1, hashVersion: DOCUMENT_HASH_VERSION });
    expect(loadBaseline(d).a).toBe(1);
  });
  it("refuses to overwrite an existing baseline, and leaves it untouched", () => {
    const d = dir();
    saveBaseline(d, { a: 1 }, { force: false, failedChecks: 0 });
    const before = readFileSync(join(d, BASELINE_FILE), "utf8");
    expect(() => assertBaselineWritable(d, false)).toThrow(/already exists/);
    expect(() => saveBaseline(d, { a: 2 }, { force: false, failedChecks: 0 })).toThrow(/already exists/);
    expect(readFileSync(join(d, BASELINE_FILE), "utf8")).toBe(before);
  });
  it("overwrites only with the force flag", () => {
    const d = dir();
    saveBaseline(d, { a: 1 }, { force: false, failedChecks: 0 });
    saveBaseline(d, { a: 2 }, { force: true, failedChecks: 0 });
    expect(loadBaseline(d).a).toBe(2);
  });
  it("never saves when a pre check failed, even with force", () => {
    const d = dir();
    expect(() => saveBaseline(d, { a: 1 }, { force: true, failedChecks: 1 })).toThrow(/Baseline not saved/);
    expect(() => loadBaseline(d)).toThrow(/not found/);
  });
  it("refuses a baseline made with another document hash", () => {
    const d = dir();
    writeFileSync(join(d, BASELINE_FILE), JSON.stringify({ locationHashes: {} }));
    expect(() => loadBaseline(d)).toThrow(/Retake the baseline/);
  });
});
