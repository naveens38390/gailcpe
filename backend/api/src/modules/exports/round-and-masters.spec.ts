/**
 * Client review 2026-09-29: the whole-round export (every producer, Ex Works + Ex Depot, any published
 * round), the Grade Mapping export listing the GAIL codes that inherit a row ("Equivalent (inherited)"
 * in the client's tables), the Location Master's Ex Depot and match-type columns, and Grade Finder
 * resolving an A-form code the way Compare does. In-memory MongoDB, real schemas and services.
 */

import { NotFoundException } from "@nestjs/common";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import {
  DiscountSchemeSchema,
  FreightCircularSchema,
  FreightEntrySchema,
  PriceCircularSchema,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";
import { GradeMappingSchema, GradeSchema, LocationSchema, ProducerSchema } from "../../database/schemas/catalog.schema";
import { DiscountTermsSchema } from "../../database/schemas/discount-terms.schema";
import { GradesService } from "../grades/grades.service";
import { ExcelExportService } from "./excel-export.service";

jest.setTimeout(60_000);

let server: MongoMemoryServer;
const M: Record<string, mongoose.Model<any>> = {};
const SEP1 = new Date("2026-09-01T00:00:00Z");
const SEP16 = new Date("2026-09-16T00:00:00Z");
const id = { gail1: new Types.ObjectId(), gail16: new Types.ObjectId(), gailSp: new Types.ObjectId(), ioclFiled: new Types.ObjectId(), iocl16: new Types.ObjectId(), ril16: new Types.ObjectId() };

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri("gcpe-round-export"));
  M.pc = mongoose.model("PriceCircular", PriceCircularSchema);
  M.pe = mongoose.model("PriceEntry", PriceEntrySchema);
  M.fc = mongoose.model("FreightCircular", FreightCircularSchema);
  M.fe = mongoose.model("FreightEntry", FreightEntrySchema);
  M.ds = mongoose.model("DiscountScheme", DiscountSchemeSchema);
  M.dt = mongoose.model("DiscountTerms", DiscountTermsSchema);
  M.gm = mongoose.model("GradeMapping", GradeMappingSchema);
  M.g = mongoose.model("Grade", GradeSchema);
  M.loc = mongoose.model("Location", LocationSchema);
  M.pr = mongoose.model("Producer", ProducerSchema);
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await M.pc.insertMany([
    { _id: id.gail1, producer: "GAIL", reference: "GAIL 1 Sep", effectiveDate: SEP1, status: "superseded", basis: "ex_works" },
    { _id: id.gail16, producer: "GAIL", reference: "GAIL 16 Sep", effectiveDate: SEP16, status: "active", basis: "ex_works" },
    { _id: id.gailSp, producer: "GAIL", reference: "GAIL Stock Point 16 Sep", effectiveDate: SEP16, status: "active", basis: "ex_works", secondary: true },
    { _id: id.ioclFiled, producer: "IOCL", reference: "IOC unextracted copy", effectiveDate: SEP16, status: "draft", basis: "ex_works" },
    { _id: id.iocl16, producer: "IOCL", reference: "PEPL/2026-2027/20", effectiveDate: SEP16, status: "active", basis: "delivered" },
    { _id: id.ril16, producer: "RIL", reference: "PE/2026-27/022", effectiveDate: SEP16, status: "active", basis: "delivered" },
  ]);
  await M.pe.insertMany([
    { circular: id.gail1, producer: "GAIL", effectiveDate: SEP1, zone: "BHIWANDI", grade: "W52A009A", price: 140000, basis: "ex_works" },
    { circular: id.gail16, producer: "GAIL", effectiveDate: SEP16, zone: "BHIWANDI", grade: "W52A009A", price: 142000, basis: "ex_works" },
    { circular: id.gail16, producer: "GAIL", effectiveDate: SEP16, zone: "BHIWANDI", grade: "W52A009NA", price: 142500, basis: "ex_works" },
    { circular: id.gail16, producer: "GAIL", effectiveDate: SEP16, zone: "BHIWANDI", grade: "Z99A001", price: 150000, basis: "ex_works" },
    { circular: id.gail16, producer: "GAIL", effectiveDate: SEP16, zone: "AGRA", grade: "W52A009A", price: 141500, basis: "ex_depot" },
    { circular: id.iocl16, producer: "IOCL", effectiveDate: SEP16, zone: "Mumbai", grade: "012DB54", price: 141000, basis: "delivered" },
    { circular: id.ril16, producer: "RIL", effectiveDate: SEP16, zone: "MUMBAI", grade: "E52009", price: 140500, basis: "delivered" },
    { circular: id.ril16, producer: "RIL", effectiveDate: SEP16, zone: "MUMBAI", grade: "E52009", price: 140200, basis: "ex_depot" },
  ]);
  await M.gm.insertMany([
    { gailGrade: "W52A009", polymer: "HDPE", status: "active", equivalents: { RIL: ["E52009", "52GB002"], HMEL: ["R0151D"] } },
    { gailGrade: "F55HM0003", polymer: "HDPE", status: "active", equivalents: { RIL: ["F46003"] } },
  ]);
  await M.pr.insertMany([
    { code: "GAIL", name: "GAIL", isSelf: true, active: true, basis: "ex_works" },
    { code: "HMEL", name: "HMEL", isSelf: false, active: true, basis: "ex_works" },
    { code: "RIL", name: "RIL", isSelf: false, active: true, basis: "delivered" },
  ]);
  await M.g.insertMany([
    { code: "F46003", producer: "RIL" },
    { code: "E52009", producer: "RIL" },
  ]);
  await M.loc.insertMany([
    { name: "BHIWANDI", producerZone: { RIL: "MUMBAI", HMEL: "Bhiwandi" }, producerZoneTier: { RIL: "alias", HMEL: "exact" },
      producerDepotZone: { GAIL: "BHIWANDI", RIL: "MUMBAI" }, freightDestination: { GAIL: "BHINWANDI", HMEL: "Bhiwandi" } },
    { name: "RANIA", producerZone: { HMEL: "Sirsa" }, producerZoneTier: { HMEL: "inferred_location" } },
  ]);
});

const excel = () => new ExcelExportService(M.pc, M.pe, M.fc, M.fe, M.ds, M.dt, M.gm, M.loc, M.pr);
const rows = (ws: any, headerText: string) => {
  let header: string[] = [];
  const out: Record<string, unknown>[] = [];
  ws.eachRow((row: any) => {
    const v = (row.values as unknown[]).slice(1).map((x) => (x === undefined || x === null ? "" : x));
    if (!header.length) { if (v.includes(headerText)) header = v.map(String); return; }
    out.push(Object.fromEntries(header.map((h, i) => [h, v[i]])));
  });
  return out;
};

describe("whole-round export", () => {
  it("latest: one sheet per producer and list, published main circulars only", async () => {
    const { wb, effectiveDate } = await excel().roundWorkbook("latest");
    expect(effectiveDate).toBe("2026-09-16");
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Round", "GAIL Ex Works", "GAIL Ex Depot", "IOCL Ex Works", "RIL Ex Works", "RIL Ex Depot"]);
    const summary = rows(wb.getWorksheet("Round"), "Producer");
    expect(summary.map((r) => [r.Producer, r.Circular, r["Ex Works lines"], r["Ex Depot lines"]])).toEqual([
      ["GAIL", "GAIL 16 Sep", 3, 1],
      ["IOCL", "PEPL/2026-2027/20", 1, 0],
      ["RIL", "PE/2026-27/022", 1, 1],
    ]);
    expect(rows(wb.getWorksheet("RIL Ex Depot"), "Grade").map((r) => r["Price (Rs/MT)"])).toEqual([140200]);
  });

  it("a past round exports the circular it was priced from, even though it is superseded now", async () => {
    const { wb } = await excel().roundWorkbook("2026-09-01");
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Round", "GAIL Ex Works"]);
    expect(rows(wb.getWorksheet("GAIL Ex Works"), "Grade").map((r) => r["Price (Rs/MT)"])).toEqual([140000]);
  });

  it("refuses a date with no published round, and a malformed one", async () => {
    await expect(excel().roundWorkbook("2026-10-01")).rejects.toBeInstanceOf(NotFoundException);
    await expect(excel().roundWorkbook("16-09-2026")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("Grade Mapping export lists the codes that inherit a row", () => {
  it("A form, NA additive and GAIL-only codes from the live book, each saying where its equivalents come from", async () => {
    const wb = await excel().gradeMappingWorkbook();
    const byGrade = Object.fromEntries(rows(wb.worksheets[0], "GAIL grade").map((r) => [r["GAIL grade"], r]));
    expect(Object.keys(byGrade)).toEqual(["F55HM0003", "W52A009", "W52A009A", "W52A009NA", "Z99A001"]);
    expect(byGrade.W52A009A["RIL equivalent"]).toBe("E52009, 52GB002");
    expect(byGrade.W52A009A["Equivalents from"]).toBe("inherited: form letter of W52A009");
    expect(byGrade.W52A009NA["Equivalents from"]).toBe("inherited: NA additive of W52A009");
    expect(byGrade.W52A009["Equivalents from"]).toBe("own row");
    expect(byGrade.Z99A001["Equivalents from"]).toBe("no row: GAIL only");
    expect(byGrade.Z99A001["RIL equivalent"]).toBe("");
  });
});

describe("Location Master export", () => {
  it("keeps the original columns first and adds match type and Ex Depot points", async () => {
    const wb = await excel().locationMasterWorkbook();
    const data = rows(wb.worksheets[0], "GAIL location");
    const header = Object.keys(data[0]!);
    expect(header.slice(0, 6)).toEqual(["GAIL location", "SAP code", "HMEL pricing zone", "RIL pricing zone", "HMEL freight destination", "RIL freight destination"]);
    const b = data.find((r) => r["GAIL location"] === "BHIWANDI")!;
    expect([b["RIL match type"], b["HMEL match type"], b["GAIL Ex Depot point"], b["RIL Ex Depot point"], b["HMEL Ex Depot point"]])
      .toEqual(["Exact published match", "Exact published match", "BHIWANDI", "MUMBAI", ""]);
    const r = data.find((x) => x["GAIL location"] === "RANIA")!;
    expect(r["HMEL match type"]).toBe("Inferred location match");
  });
});

describe("Grade Finder resolves variants the way Compare does", () => {
  const grades = () => new GradesService(M.g, M.gm);
  it("an A-form code takes its base row (was a 404)", async () => {
    const d: any = await grades().detail("F55HM0003A");
    expect(d.gailGrade).toBe("F55HM0003A");
    expect(d.equivalents.find((e: any) => e.producer === "RIL").codes.map((c: any) => c.code)).toEqual(["F46003"]);
    expect(d.characteristic).toMatch(/F55HM0003 as supplied/);
  });
  it("an NA code still takes its base row, labelled as the additive", async () => {
    const d: any = await grades().detail("W52A009NA");
    expect(d.characteristic).toMatch(/NA additive/);
  });
  it("a code with no row and no base is still refused", async () => {
    await expect(grades().detail("Z99A001")).rejects.toBeInstanceOf(NotFoundException);
  });
});
