/**
 * Client request 2026-09-28: file a whole round at once, delete what was filed by mistake, and publish
 * every ready draft with one click (with the Ex Depot book travelling with each circular). In-memory
 * MongoDB, real schemas, the real services; the dataset, notifications and PDF reading are stubbed.
 */

import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { PriceCircularSchema, PriceEntrySchema, FreightCircularSchema } from "../../database/schemas/circular.schema";
import { CircularDocumentSchema } from "../../database/schemas/circular-document.schema";
import { PriceCircularDraftRowSchema, PriceCircularDraftSchema } from "../../database/schemas/price-circular-draft.schema";
import { CircularStoreService } from "./circular-store.service";
import { CircularsService } from "./circulars.service";
import { detectMeta, effectiveDateIn } from "./circular-meta";
import { parseExtract } from "./extract-format";
import { PriceCircularsService } from "../price-circulars/price-circulars.service";

jest.setTimeout(60_000);

let server: MongoMemoryServer;
const M: Record<string, mongoose.Model<any>> = {};
const PRODUCERS = ["GAIL", "IOCL", "RIL", "HMEL", "HPL", "OPaL"];
const SEP16 = new Date("2026-09-16T00:00:00Z");
const OCT1 = new Date("2026-10-01T00:00:00Z");
const PDF = Buffer.from("%PDF-1.4 test");

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri("gcpe-round"));
  M.pc = mongoose.model("PriceCircular", PriceCircularSchema);
  M.pe = mongoose.model("PriceEntry", PriceEntrySchema);
  M.fc = mongoose.model("FreightCircular", FreightCircularSchema);
  M.doc = mongoose.model("CircularDocument", CircularDocumentSchema);
  M.dr = mongoose.model("PriceCircularDraft", PriceCircularDraftSchema);
  M.row = mongoose.model("PriceCircularDraftRow", PriceCircularDraftRowSchema);
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

const liveBook = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`Z${i}`, { G1: 1000 + i }]));
const audit = { log: jest.fn() };
const dataset = {
  load: async () => ({ priceIndex: { producers: { GAIL: { basis: "ex_works", zones: liveBook(10) }, IOCL: { basis: "delivered", zones: liveBook(10) }, OPaL: { basis: "ex_works", zones: liveBook(10) } } } }),
  invalidate: jest.fn(),
};
const price = () => new PriceCircularsService(M.dr, M.row, M.pc, M.pe, dataset as any, audit as any, { notify: jest.fn() } as any);
const detector = { detectAll: async (buf: Buffer, name: string, producers: string[]) => ({ reference: /IOC/.test(name) ? "PEPL/2026-2027/21" : null, method: "none", ...detectMeta(buf.toString("latin1"), name, producers) }) };
const circulars = (p = price()) => new CircularsService(M.pc, M.fc, M.pe, dataset as any, new CircularStoreService(M.doc), p, { discardUnpublished: jest.fn() } as any, detector as any, audit as any);

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  audit.log.mockClear();
});

describe("reading producer, date and kind from a circular", () => {
  it.each([
    ["IOC PE Price List 16 Sept 2026.pdf", "", "IOCL", "2026-09-16", "price", false],
    ["RIL (2).pdf", "Reliance Industries Limited\nDate: September 15 , 2026\nRef.: PE/ 2026-27/022\nEff.Date: September 16 , 2026 , 06:00 AM", "RIL", "2026-09-16", "price", false],
    ["OPAL DTA.pdf", "ONGC Petro additions Limited price circular w.e.f. 16.09.2026. Freight charges extra as applicable", "OPaL", "2026-09-16", "price", false],
    ["OPAL CSA.pdf", "ONGC Petro additions Limited w.e.f. 16.09.2026", "OPaL", "2026-09-16", "price", true],
    ["PE - Stock Point Prices w.e.f. September 16, 2026.pdf", "GAIL (India) Limited stock point", "GAIL", "2026-09-16", "price", true],
    ["HPL Freight Circular w.e.f. 1st June 2026.pdf", "Haldia Petrochemicals", "HPL", "2026-06-01", "freight", false],
    ["HMEL (2).pdf", "HPCL-Mittal Energy Limited Ref. : HMEL/Marketing/PE/2026-27/19 w.e.f. 16.09.2026", "HMEL", "2026-09-16", "price", false],
  ])("%s", (name, text, producer, date, kind, secondary) => {
    const m = detectMeta(text, name, PRODUCERS);
    expect([m.producer, m.effectiveDate, m.kind, m.secondary]).toEqual([producer, date, kind, secondary]);
  });

  it("keeps the producer's exact code (OPaL, not OPAL) and refuses to guess an ambiguous one", () => {
    expect(detectMeta("", "opal dta.pdf", PRODUCERS).producer).toBe("OPaL");
    const m = detectMeta("GAIL and IOCL joint note", "note.pdf", PRODUCERS);
    expect(m.producer).toBeNull();
    expect(m.notes.join()).toMatch(/ambiguous/);
  });

  it("prefers the date after w.e.f. and never rolls an impossible date over", () => {
    expect(effectiveDateIn("Issued 10.09.2026. Prices w.e.f. 16.09.2026")).toBe("2026-09-16");
    expect(effectiveDateIn("dated 30.02.2026")).toBeNull();
  });
});

describe("the reading carries the Ex Depot book", () => {
  it("per-producer extract and whole price index", () => {
    const one = parseExtract({ producer: "GAIL", basis: "ex_works", zones: { A: { G1: 1 } }, depot: { zones: { D1: { G1: 2 }, D2: { G1: 3 } } } }, "GAIL");
    expect([one.rowCount, one.depotRowCount, one.depotZones]).toEqual([1, 2, { D1: { G1: 2 }, D2: { G1: 3 } }]);
    const idx = parseExtract({ producers: { opal: { zones: { A: { G1: 1 } } } }, depot: { OPaL: { zones: { D: { G1: 5 } } } } }, "OPaL");
    expect(idx.depotRowCount).toBe(1);
    expect(() => parseExtract({ zones: { A: { G1: 1 } }, depot: { zones: { D: { G1: "x" } } } }, "GAIL")).toThrow(/Ex Depot D \/ G1/);
  });
});

async function fileAndExtract(c: CircularsService, producer: string, date: Date, extract: object, secondary = false) {
  const rec = await M.pc.create({ producer, reference: `${producer} ref`, effectiveDate: date, status: "draft", basis: "ex_works", secondary });
  return c.attachExtract(String(rec._id), { buffer: Buffer.from(JSON.stringify(extract)), originalname: "x.json" }, new Types.ObjectId().toHexString());
}

describe("attaching a reading", () => {
  it("refuses a reading for another round, and a reading for a record-only document", async () => {
    const c = circulars();
    await expect(fileAndExtract(c, "GAIL", SEP16, { effective_date: "2026-10-01", zones: { A: { G1: 1 } } })).rejects.toThrow(/is for 2026-10-01, but this circular is filed for 2026-09-16/);
    await expect(fileAndExtract(c, "GAIL", SEP16, { zones: { A: { G1: 1 } } }, true)).rejects.toThrow(/record only/);
  });
});

describe("Publish All", () => {
  const book = (n: number) => ({ zones: liveBook(n) });
  const waitFor = async (p: PriceCircularsService, id: string) => {
    for (let i = 0; i < 200; i++) { const j = p.publishAllStatus(id); if (j.state !== "running") return j; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error("job did not finish");
  };

  it("publishes every ready draft with its Ex Depot book, holds the rest with the reason, and audits each step", async () => {
    const p = price();
    const c = circulars(p);
    const old = await M.pc.create({ producer: "GAIL", reference: "old", effectiveDate: SEP16, status: "active", basis: "ex_works" });
    await fileAndExtract(c, "GAIL", OCT1, { ...book(10), depot: { zones: { D1: { G1: 9 }, D2: { G1: 8 } } } });
    await fileAndExtract(c, "IOCL", OCT1, book(10));
    await fileAndExtract(c, "IOCL", OCT1, book(10)); // a second IOCL draft for the same round
    const opal = await M.dr.create({ producer: "OPAL", circularNumber: "x", effectiveDate: OCT1, basis: "ex_works", status: "draft", reason: "r", createdBy: new Types.ObjectId(), rowCount: 10 });

    const preview = await p.publishAllPreview();
    expect(preview.ready).toBe(1);
    const held = Object.fromEntries(preview.items.filter((i) => !i.ready).map((i) => [`${i.producer}:${i.draftId}`, i.problems.join(" ")]));
    expect(Object.values(held).filter((m) => /2 drafts for IOCL/.test(m))).toHaveLength(2);
    expect(held[`OPAL:${opal._id}`]).toMatch(/not a producer code/);

    const job = await waitFor(p, (await p.startPublishAll(new Types.ObjectId().toHexString())).id);
    expect(job.state).toBe("done");
    expect(job.results.map((r) => [r.producer, r.ok])).toEqual([["GAIL", true]]);
    expect((await M.pc.findById(old._id).lean<any>()).status).toBe("superseded");
    const live = await M.pc.findOne({ producer: "GAIL", status: "active" }).lean<any>();
    expect(live.effectiveDate.toISOString()).toBe(OCT1.toISOString());
    expect(await M.pe.countDocuments({ circular: live._id, basis: "ex_works" })).toBe(10);
    expect(await M.pe.countDocuments({ circular: live._id, basis: "ex_depot" })).toBe(2);
    const actions = audit.log.mock.calls.map((a) => a[1]);
    for (const a of ["price_circular.submit", "price_circular.review", "price_circular.publish", "price_circular.publish_all"]) expect(actions).toContain(a);
  });

  it("holds a draft for the round already published, and a reading far smaller than the live book", async () => {
    const p = price();
    const c = circulars(p);
    await M.pc.create({ producer: "GAIL", reference: "live", effectiveDate: SEP16, status: "active", basis: "ex_works" });
    await fileAndExtract(c, "GAIL", SEP16, book(10));
    await fileAndExtract(c, "IOCL", OCT1, book(3));
    const items = (await p.publishAllPreview()).items;
    expect(items.find((i) => i.producer === "GAIL")!.problems.join()).toMatch(/already the published round/);
    expect(items.find((i) => i.producer === "IOCL")!.problems.join()).toMatch(/3 prices against 10/);
    await expect(p.startPublishAll("u")).rejects.toThrow(/No draft is ready/);
  });
});

describe("deleting a filed circular", () => {
  it("removes an unpublished record with its draft and stored documents", async () => {
    const c = circulars();
    const r = await fileAndExtract(c, "GAIL", OCT1, { zones: { A: { G1: 1 } } });
    expect(await M.doc.countDocuments()).toBe(1); // the extract (the record was created directly)
    const out = await c.deleteFiled(r.circularId, new Types.ObjectId().toHexString());
    expect(out.deleted).toBe(true);
    expect(await M.pc.countDocuments()).toBe(0);
    expect(await M.dr.countDocuments()).toBe(0);
    expect(await M.row.countDocuments()).toBe(0);
    expect(await M.doc.countDocuments()).toBe(0);
    expect(audit.log.mock.calls.map((a) => a[1])).toEqual(expect.arrayContaining(["price_circular.discard", "price_circular.delete_filed"]));
  });

  it("refuses a published circular", async () => {
    const live = await M.pc.create({ producer: "GAIL", reference: "live", effectiveDate: SEP16, status: "active", basis: "ex_works" });
    await expect(circulars().deleteFiled(String(live._id), "u")).rejects.toThrow(/not been published/);
    expect(await M.pc.countDocuments()).toBe(1);
  });
});

describe("filing a whole round at once", () => {
  it("files what it can read, flags what it cannot, skips duplicates, marks record-only documents", async () => {
    const c = circulars();
    const files = [
      { buffer: PDF, originalname: "IOC PE Price List 01 Oct 2026.pdf" },
      { buffer: Buffer.from("%PDF-1.4 GAIL (India) Limited, stock point prices"), originalname: "PE - Stock Point Prices w.e.f. October 1, 2026.pdf" },
      { buffer: PDF, originalname: "scan001.pdf" },
    ];
    const first = await c.bulkUpload(files, new Types.ObjectId().toHexString());
    expect([first.filed, first.needsInput]).toEqual([2, 1]);
    const byName = Object.fromEntries(first.results.map((r) => [r.filename, r]));
    expect(byName["IOC PE Price List 01 Oct 2026.pdf"]).toMatchObject({ status: "filed", producer: "IOCL", effectiveDate: "2026-10-01", reference: "PEPL/2026-2027/21" });
    expect(byName["scan001.pdf"]).toMatchObject({ status: "needs_input" });
    const stock = await M.pc.findOne({ producer: "GAIL" }).lean<any>();
    expect([stock.secondary, stock.reference]).toEqual([true, "PE - Stock Point Prices w.e.f. October 1, 2026"]);
    const again = await c.bulkUpload(files.slice(0, 1), "u");
    expect(again.alreadyFiled).toBe(1);
  });
});
