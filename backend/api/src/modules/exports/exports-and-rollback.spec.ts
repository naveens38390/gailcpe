/**
 * Client request 2026-09-28 ("export pricing is broken"): every producer's price circular exports with its
 * Ex Depot (stock point) list, and a competitor's circular can be restored (R28: the rollback endpoint was
 * hard-coded to GAIL). In-memory MongoDB, real schemas, the real export and circular services.
 */

import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import {
  DiscountSchemeSchema,
  FreightCircularSchema,
  FreightEntrySchema,
  PriceCircularSchema,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";
import { GradeMappingSchema, LocationSchema, ProducerSchema } from "../../database/schemas/catalog.schema";
import { DiscountTermsSchema } from "../../database/schemas/discount-terms.schema";
import { ExcelExportService } from "./excel-export.service";
import { PdfExportService } from "./pdf-export.service";
import { PriceCircularsService } from "../price-circulars/price-circulars.service";

jest.setTimeout(60_000);

let server: MongoMemoryServer;
const M: Record<string, mongoose.Model<any>> = {};
const SEP1 = new Date("2026-09-01T00:00:00Z");
const SEP16 = new Date("2026-09-16T00:00:00Z");

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri("gcpe-exports"));
  M.pc = mongoose.model("PriceCircular", PriceCircularSchema);
  M.pe = mongoose.model("PriceEntry", PriceEntrySchema);
  M.fc = mongoose.model("FreightCircular", FreightCircularSchema);
  M.fe = mongoose.model("FreightEntry", FreightEntrySchema);
  M.ds = mongoose.model("DiscountScheme", DiscountSchemeSchema);
  M.dt = mongoose.model("DiscountTerms", DiscountTermsSchema);
  M.gm = mongoose.model("GradeMapping", GradeMappingSchema);
  M.loc = mongoose.model("Location", LocationSchema);
  M.pr = mongoose.model("Producer", ProducerSchema);
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

const ids = { iocl1: new Types.ObjectId(), iocl16: new Types.ObjectId(), ioclFiled: new Types.ObjectId(), hmel16: new Types.ObjectId() };
beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await M.pc.insertMany([
    { _id: ids.iocl1, producer: "IOCL", reference: "PEPL/2026-2027/19", effectiveDate: SEP1, status: "superseded", basis: "delivered", stats: { zones: 1, prices: 2 } },
    { _id: ids.iocl16, producer: "IOCL", reference: "PEPL/2026-2027/20", effectiveDate: SEP16, status: "active", basis: "delivered", stats: { zones: 1, prices: 2 } },
    { _id: ids.ioclFiled, producer: "IOCL", reference: "IOC source PDF", effectiveDate: SEP16, status: "draft", basis: "ex_works" },
    { _id: ids.hmel16, producer: "HMEL", reference: "HMEL/Marketing/PE/2026-27/19", effectiveDate: SEP16, status: "active", basis: "ex_works", stats: { zones: 1, prices: 1 } },
  ]);
  await M.pe.insertMany([
    { circular: ids.iocl16, producer: "IOCL", effectiveDate: SEP16, zone: "Mumbai", grade: "012DB54", price: 142596, basis: "delivered" },
    { circular: ids.iocl16, producer: "IOCL", effectiveDate: SEP16, zone: "Delhi", grade: "012DB54", price: 143000, basis: "delivered" },
    { circular: ids.iocl16, producer: "IOCL", effectiveDate: SEP16, zone: "Mumbai", grade: "012DB54", price: 142396, basis: "ex_depot" },
    { circular: ids.iocl16, producer: "IOCL", effectiveDate: SEP16, zone: "Thane", grade: "012DB54", price: 142400, basis: "ex_depot" },
    { circular: ids.iocl16, producer: "IOCL", effectiveDate: SEP16, zone: "Pune", grade: "012DB54", price: 142450, basis: "ex_depot" },
    { circular: ids.hmel16, producer: "HMEL", effectiveDate: SEP16, zone: "Bhiwandi", grade: "B0155D", price: 139770, basis: "ex_works" },
  ]);
});

const excel = () => new ExcelExportService(M.pc, M.pe, M.fc, M.fe, M.ds, M.dt, M.gm, M.loc, M.pr);
const pdf = () => new PdfExportService(M.pc, M.pe, M.fc, M.fe, M.ds, M.dt, M.pr);
const pages = (buf: Buffer) => (buf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

describe("price circular exports carry the Ex Depot list", () => {
  it("Excel: a competitor circular exports its works/delivered rows and a separate Ex Depot sheet", async () => {
    const wb = await excel().priceCircularWorkbook(String(ids.iocl16));
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Circular", "Price Entries", "Ex Depot"]);
    const data = (name: string) => {
      const out: unknown[][] = [];
      wb.getWorksheet(name)!.eachRow((row, n) => { if (n > 4) out.push((row.values as unknown[]).slice(1)); });
      return out;
    };
    expect(data("Price Entries").map((r) => r[2])).toEqual([143000, 142596]);
    expect(data("Ex Depot").map((r) => [r[0], r[2]])).toEqual([["Mumbai", 142396], ["Pune", 142450], ["Thane", 142400]]);
    const info: Record<string, unknown> = {};
    wb.getWorksheet("Circular")!.eachRow((row) => { info[String(row.getCell(1).value)] = row.getCell(2).value; });
    expect(info["Ex Depot price lines"]).toBe(3);
  });

  it("Excel: a circular with no depot rows has no Ex Depot sheet", async () => {
    const wb = await excel().priceCircularWorkbook(String(ids.hmel16));
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Circular", "Price Entries"]);
  });

  it("PDF: the Ex Depot list starts its own section (an extra page) only when there are depot rows", async () => {
    const withDepot = await pdf().priceCircularPdf(String(ids.iocl16));
    const without = await pdf().priceCircularPdf(String(ids.hmel16));
    expect(withDepot.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(withDepot)).toBe(pages(without) + 1);
  });
});

describe("rollback of a competitor's circular (R28)", () => {
  const service = () => {
    const s = Object.create(PriceCircularsService.prototype) as any;
    s.circulars = M.pc;
    s.dataset = { invalidate: jest.fn() };
    s.auditLog = { log: jest.fn() };
    return s as PriceCircularsService;
  };
  const status = async (id: Types.ObjectId) => (await M.pc.findById(id).lean<any>())!.status;

  it("restores a superseded IOCL circular: the producer comes from the circular, not a hard-coded GAIL", async () => {
    const s = service();
    await s.rollbackCircularById(String(ids.iocl1), "user", "restore 1 Sep");
    expect(await status(ids.iocl1)).toBe("active");
    expect(await status(ids.iocl16)).toBe("superseded");
    expect(await status(ids.hmel16)).toBe("active"); // another producer is untouched
    expect((s as any).dataset.invalidate).toHaveBeenCalled();
  });

  it("refuses a filed source document (status draft): it carries no prices", async () => {
    await expect(service().rollbackCircularById(String(ids.ioclFiled), "user", "wrong row")).rejects.toThrow(/previously published/);
    expect(await status(ids.iocl16)).toBe("active");
  });

  it("refuses an unknown id and an already active circular", async () => {
    await expect(service().rollbackCircularById(String(new Types.ObjectId()), "user", "x")).rejects.toThrow(/No such published circular/);
    await expect(service().rollbackCircularById(String(ids.iocl16), "user", "x")).rejects.toThrow(/already active/);
  });
});
