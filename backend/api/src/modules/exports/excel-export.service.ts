/**
 * Excel Generation — outputs, not inputs.
 *
 * Every workbook here is built from published/approved master data only,
 * never a live draft: a PriceCircular that is still `draft`/`review` has no
 * export route at all, because a spreadsheet handed to the market has to be
 * something the organisation actually stands behind.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import ExcelJS from "exceljs";
import { Model, Types } from "mongoose";

import { GradeMapping, Location, Producer } from "../../database/schemas/catalog.schema";
import {
  DiscountScheme,
  FreightCircular,
  FreightEntry,
  PriceCircular,
  PriceEntry,
} from "../../database/schemas/circular.schema";
import { DiscountTerms } from "../../database/schemas/discount-terms.schema";
import { additiveBaseOf, formBaseOf, normaliseGrade } from "../../core/pricing";

const TITLE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F3B57" },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE4ECF3" },
};
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, color: { argb: "FF1F3B57" } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D7DE" } },
  left: { style: "thin", color: { argb: "FFD0D7DE" } },
  bottom: { style: "thin", color: { argb: "FFD0D7DE" } },
  right: { style: "thin", color: { argb: "FFD0D7DE" } },
};

function titleBar(sheet: ExcelJS.Worksheet, span: number, lines: string[]) {
  const startRow = 1;
  lines.forEach((text, i) => {
    const row = sheet.getRow(startRow + i);
    sheet.mergeCells(startRow + i, 1, startRow + i, span);
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = i === 0 ? TITLE_FONT : { ...TITLE_FONT, size: 10, bold: false };
    cell.fill = TITLE_FILL;
    cell.alignment = { vertical: "middle", horizontal: "left" };
    row.height = i === 0 ? 22 : 16;
  });
  sheet.addRow([]);
}

function headerRow(sheet: ExcelJS.Worksheet, headers: string[]) {
  const row = sheet.addRow(headers);
  row.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
  sheet.views = [{ state: "frozen", ySplit: row.number }];
  return row;
}

/** The client's names for how a town reached a producer's price point. */
function tierLabel(tier: string | undefined): string {
  switch (tier) {
    case "exact":
    case "evidence":
    case "alias":
      return "Exact published match";
    case "published_map":
    case "state_zone":
      return "Territory match";
    case "inferred_location":
      return "Inferred location match";
    default:
      return tier ?? "";
  }
}

function borderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = THIN_BORDER;
  });
}

@Injectable()
export class ExcelExportService {
  constructor(
    @InjectModel(PriceCircular.name) private priceCirculars: Model<PriceCircular>,
    @InjectModel(PriceEntry.name) private priceEntries: Model<PriceEntry>,
    @InjectModel(FreightCircular.name) private freightCirculars: Model<FreightCircular>,
    @InjectModel(FreightEntry.name) private freightEntries: Model<FreightEntry>,
    @InjectModel(DiscountScheme.name) private discountSchemes: Model<DiscountScheme>,
    @InjectModel(DiscountTerms.name) private discountTerms: Model<DiscountTerms>,
    @InjectModel(GradeMapping.name) private gradeMappings: Model<GradeMapping>,
    @InjectModel(Location.name) private locations: Model<Location>,
    @InjectModel(Producer.name) private producers: Model<Producer>,
  ) {}

  async priceCircularWorkbook(circularId: string): Promise<ExcelJS.Workbook> {
    const circular = await this.priceCirculars.findById(circularId).lean();
    if (!circular) throw new NotFoundException("No such price circular.");
    const rows = await this.priceEntries
      .find({ circular: new Types.ObjectId(circularId), basis: { $ne: "ex_depot" } })
      .sort({ zone: 1, grade: 1 })
      .lean();
    // The Ex Depot (stock point) list is loaded against the same circular; it is its own price book,
    // so it gets its own sheet rather than being mixed into the works/delivered one.
    const depotRows = await this.priceEntries
      .find({ circular: new Types.ObjectId(circularId), basis: "ex_depot" })
      .sort({ zone: 1, grade: 1 })
      .lean();

    const wb = new ExcelJS.Workbook();
    wb.creator = "GCPE";
    wb.created = new Date();

    const info = wb.addWorksheet("Circular");
    info.columns = [{ width: 22 }, { width: 40 }];
    info.addRow(["Producer", circular.producer]);
    info.addRow(["Circular reference", circular.reference]);
    info.addRow(["Effective date", circular.effectiveDate.toLocaleDateString("en-IN")]);
    info.addRow(["Basis", circular.basis]);
    info.addRow(["Status", circular.status]);
    info.addRow(["Zones", circular.stats?.zones ?? new Set(rows.map((r) => r.zone)).size]);
    info.addRow(["Price lines", circular.stats?.prices ?? rows.length]);
    info.addRow(["Ex Depot price lines", depotRows.length]);
    info.addRow(["Generated", new Date().toLocaleString("en-IN")]);
    info.eachRow((row) => {
      row.getCell(1).font = { bold: true };
      borderRow(row);
    });

    const sheet = wb.addWorksheet("Price Entries");
    sheet.columns = [
      { key: "zone", width: 24 },
      { key: "grade", width: 16 },
      { key: "price", width: 16 },
      { key: "basis", width: 14 },
      { key: "supplyPoint", width: 18 },
    ];
    titleBar(sheet, 5, [
      `${circular.producer} — Price Circular ${circular.reference}`,
      `Effective ${circular.effectiveDate.toLocaleDateString("en-IN")} · ${circular.basis} · ${rows.length} lines`,
    ]);
    headerRow(sheet, ["Zone / Location", "Grade", "Price (₹/MT)", "Basis", "Supply point"]);
    for (const r of rows) {
      const row = sheet.addRow([r.zone, r.grade, r.price, r.basis, r.supplyPoint ?? ""]);
      row.getCell(3).numFmt = "#,##0.00";
      borderRow(row);
    }
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 5 } };

    if (depotRows.length) {
      const depot = wb.addWorksheet("Ex Depot");
      depot.columns = [
        { key: "zone", width: 24 },
        { key: "grade", width: 16 },
        { key: "price", width: 16 },
        { key: "supplyPoint", width: 18 },
      ];
      titleBar(depot, 4, [
        `${circular.producer} — Ex Depot (stock point) prices · ${circular.reference}`,
        `Effective ${circular.effectiveDate.toLocaleDateString("en-IN")} · ${depotRows.length} lines`,
      ]);
      headerRow(depot, ["Depot / Location", "Grade", "Price (₹/MT)", "Supply point"]);
      for (const r of depotRows) {
        const row = depot.addRow([r.zone, r.grade, r.price, r.supplyPoint ?? ""]);
        row.getCell(3).numFmt = "#,##0.00";
        borderRow(row);
      }
      depot.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 4 } };
    }

    return wb;
  }

  async freightCircularWorkbook(circularId: string): Promise<ExcelJS.Workbook> {
    const circular = await this.freightCirculars.findById(circularId).lean();
    if (!circular) throw new NotFoundException("No such freight circular.");
    const rows = await this.freightEntries
      .find({ circular: new Types.ObjectId(circularId) })
      .sort({ destination: 1 })
      .lean();

    const wb = new ExcelJS.Workbook();
    wb.creator = "GCPE";
    wb.created = new Date();

    const info = wb.addWorksheet("Circular");
    info.columns = [{ width: 22 }, { width: 40 }];
    info.addRow(["Producer", circular.producer]);
    info.addRow(["Circular reference", circular.reference ?? "—"]);
    info.addRow(["Effective date", circular.effectiveDate.toLocaleDateString("en-IN")]);
    info.addRow(["Status", circular.status]);
    info.addRow(["Destinations", rows.length]);
    info.addRow(["Generated", new Date().toLocaleString("en-IN")]);
    info.eachRow((row) => {
      row.getCell(1).font = { bold: true };
      borderRow(row);
    });

    const sheet = wb.addWorksheet("Freight Entries");
    sheet.columns = [
      { key: "destination", width: 24 },
      { key: "state", width: 18 },
      { key: "district", width: 18 },
      { key: "cluster", width: 16 },
      { key: "distanceKm", width: 12 },
      { key: "transitDays", width: 12 },
      { key: "ratePerMt", width: 16 },
      { key: "insurancePerMt", width: 16 },
    ];
    titleBar(sheet, 8, [
      `${circular.producer} — Freight Circular ${circular.reference ?? ""}`.trim(),
      `Effective ${circular.effectiveDate.toLocaleDateString("en-IN")} · ${rows.length} destinations`,
    ]);
    headerRow(sheet, [
      "Destination",
      "State",
      "District",
      "Cluster",
      "Distance (km)",
      "Transit (days)",
      "Rate (₹/MT)",
      "Insurance (₹/MT)",
    ]);
    for (const r of rows) {
      const row = sheet.addRow([
        r.destination,
        r.state ?? "",
        r.district ?? "",
        r.cluster ?? "",
        r.distanceKm ?? "",
        r.transitDays ?? "",
        r.ratePerMt,
        r.insurancePerMt ?? 0,
      ]);
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(8).numFmt = "#,##0.00";
      borderRow(row);
    }
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 8 } };

    return wb;
  }

  /**
   * GAIL's live, published discount terms (the master-data entity this
   * platform manages) alongside the latest circular-round terms for every
   * other producer — the same "GAIL vs Others" comparison the source
   * spreadsheets carried, now generated rather than maintained by hand.
   */
  async discountCircularWorkbook(): Promise<ExcelJS.Workbook> {
    const gail = await this.discountTerms.findOne({ producer: "GAIL" }).lean();
    const producers = await this.producers.find({ active: true }).sort({ code: 1 }).lean();
    const others = producers.filter((p) => p.code !== "GAIL");
    const latestByProducer = await this.discountSchemes.aggregate<DiscountScheme>([
      { $match: { producer: { $in: others.map((p) => p.code) } } },
      { $sort: { effectiveDate: -1 } },
      { $group: { _id: "$producer", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GCPE";
    wb.created = new Date();

    const summary = wb.addWorksheet("Comparison");
    summary.columns = [
      { key: "producer", width: 14 },
      { key: "cashDiscount", width: 16 },
      { key: "cashDiscountLdpe", width: 16 },
      { key: "epi", width: 14 },
      { key: "epiMax", width: 12 },
      { key: "ifc", width: 12 },
      { key: "dealer", width: 14 },
      { key: "mtQdCap", width: 14 },
      { key: "asOf", width: 16 },
    ];
    titleBar(summary, 9, [
      "Discount Terms — GAIL vs Others",
      `Generated ${new Date().toLocaleString("en-IN")}`,
    ]);
    headerRow(summary, [
      "Producer",
      "Cash discount (₹/MT)",
      "Cash discount LDPE (₹/MT)",
      "EPI (₹/MT/day)",
      "EPI max days",
      "Interest-free credit (days)",
      "Dealer discount (₹/MT)",
      "Metallocene QD cap",
      "As of",
    ]);
    const gailRow = summary.addRow([
      "GAIL",
      gail?.cashDiscount ?? "",
      gail?.cashDiscountLdpe ?? "",
      gail?.earlyPaymentPerDay ?? "",
      gail?.earlyPaymentMaxDays ?? "",
      gail?.interestFreeCreditDays ?? "",
      gail?.dealerDiscount ?? "",
      gail?.metalloceneQdCap ?? "",
      gail?.effectiveFrom ? new Date(gail.effectiveFrom).toLocaleDateString("en-IN") : "live",
    ]);
    gailRow.font = { bold: true };
    borderRow(gailRow);
    for (const p of others) {
      const d = latestByProducer.find((x) => x.producer === p.code);
      const row = summary.addRow([
        p.code,
        d?.cashDiscount ?? "",
        d?.cashDiscountLdpe ?? "",
        d?.earlyPaymentPerDay ?? "",
        d?.earlyPaymentMaxDays ?? "",
        d?.interestFreeCreditDays ?? "",
        d?.dealerDiscount ?? "",
        d?.metalloceneQdCap ?? "",
        d?.effectiveDate ? new Date(d.effectiveDate).toLocaleDateString("en-IN") : "—",
      ]);
      borderRow(row);
    }
    summary.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 9 } };

    const slabSheet = wb.addWorksheet("Quantity Slabs");
    slabSheet.columns = [
      { key: "producer", width: 14 },
      { key: "from", width: 14 },
      { key: "to", width: 14 },
      { key: "rate", width: 16 },
    ];
    titleBar(slabSheet, 4, ["Quantity Discount Slabs — all producers"]);
    headerRow(slabSheet, ["Producer", "From (MT)", "To (MT)", "Rate (₹/MT)"]);
    const slabSource: Array<{ producer: string; slabs: Array<{ from_mt: number; to_mt: number | null; rate_per_mt: number }> | null | undefined }> = [
      { producer: "GAIL", slabs: gail?.quantitySlabs },
      ...others.map((p) => ({ producer: p.code, slabs: latestByProducer.find((x) => x.producer === p.code)?.quantitySlabs })),
    ];
    for (const { producer, slabs } of slabSource) {
      if (!slabs?.length) continue;
      for (const s of slabs) {
        const row = slabSheet.addRow([producer, s.from_mt, s.to_mt ?? "and above", s.rate_per_mt]);
        row.getCell(4).numFmt = "#,##0.00";
        borderRow(row);
      }
    }

    return wb;
  }

  /**
   * Every producer's published price circular for one round, in one workbook: a summary sheet,
   * then an Ex Works and (where loaded) an Ex Depot sheet per producer. `date` is YYYY-MM-DD or
   * "latest" (the newest round with an active circular). Historical rounds export as they were
   * published: a superseded circular is still the one that round was priced from. Record-only
   * documents (GAIL Stock Point, OPaL CSA) and unpublished drafts are not rounds' price books.
   */
  async roundWorkbook(date: string): Promise<{ wb: ExcelJS.Workbook; effectiveDate: string }> {
    let day: Date;
    if (date === "latest") {
      const newest = await this.priceCirculars
        .findOne({ status: "active", secondary: { $ne: true } })
        .sort({ effectiveDate: -1 })
        .lean();
      if (!newest) throw new NotFoundException("No active price circular.");
      day = newest.effectiveDate;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new NotFoundException(`Not a round date: ${date}`);
      day = new Date(`${date}T00:00:00.000Z`);
    }
    const found = await this.priceCirculars
      .find({ effectiveDate: day, status: { $in: ["active", "superseded"] }, secondary: { $ne: true } })
      .lean();
    if (!found.length) throw new NotFoundException(`No published price circular for ${day.toISOString().slice(0, 10)}.`);
    // One circular per producer: the active one, else the most recently published.
    const byProducer = new Map<string, (typeof found)[number]>();
    for (const c of found.sort((a, b) =>
      a.status === b.status ? +new Date((b as any).updatedAt ?? 0) - +new Date((a as any).updatedAt ?? 0) : a.status === "active" ? -1 : 1,
    )) {
      if (!byProducer.has(c.producer)) byProducer.set(c.producer, c);
    }
    const order = ["GAIL", "IOCL", "RIL", "HMEL", "HPL", "OPaL"];
    const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);
    const circulars = [...byProducer.values()].sort(
      (a, b) => rank(a.producer) - rank(b.producer) || a.producer.localeCompare(b.producer),
    );
    const effectiveDate = day.toISOString().slice(0, 10);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GCPE";
    wb.created = new Date();
    const summary = wb.addWorksheet("Round");
    summary.columns = [
      { key: "producer", width: 10 },
      { key: "reference", width: 44 },
      { key: "status", width: 12 },
      { key: "works", width: 16 },
      { key: "depot", width: 16 },
    ];
    titleBar(summary, 5, [`Price round ${effectiveDate}`, `${circulars.length} producers · Generated ${new Date().toLocaleString("en-IN")}`]);
    headerRow(summary, ["Producer", "Circular", "Status", "Ex Works lines", "Ex Depot lines"]);

    const cols = [
      { key: "zone", width: 26 },
      { key: "grade", width: 16 },
      { key: "price", width: 14 },
      { key: "basis", width: 14 },
      { key: "supplyPoint", width: 16 },
    ];
    const bookSheet = (name: string, title: string, rows: PriceEntry[]) => {
      const sheet = wb.addWorksheet(name);
      sheet.columns = cols;
      titleBar(sheet, cols.length, [title, `${rows.length} lines`]);
      headerRow(sheet, ["Zone / location", "Grade", "Price (Rs/MT)", "Basis", "Supply point"]);
      for (const r of rows) sheet.addRow([r.zone, r.grade, r.price, r.basis, r.supplyPoint ?? ""]);
      sheet.getColumn(3).numFmt = "#,##0.00";
    };
    for (const c of circulars) {
      const [works, depot] = await Promise.all([
        this.priceEntries.find({ circular: c._id, basis: { $ne: "ex_depot" } }).sort({ zone: 1, grade: 1 }).lean(),
        this.priceEntries.find({ circular: c._id, basis: "ex_depot" }).sort({ zone: 1, grade: 1 }).lean(),
      ]);
      borderRow(summary.addRow([c.producer, c.reference, c.status, works.length, depot.length]));
      bookSheet(`${c.producer} Ex Works`, `${c.producer} · ${c.reference} · Ex Works`, works as PriceEntry[]);
      if (depot.length) bookSheet(`${c.producer} Ex Depot`, `${c.producer} · ${c.reference} · Ex Depot`, depot as PriceEntry[]);
    }
    return { wb, effectiveDate };
  }

  /**
   * GAIL codes in the live books that have no cross-reference row of their own, each with the row
   * that governs it — resolved by the same two rules as `crossRefFor` (NA additive, then form
   * letter), so the sheet says what Compare does. The client's equivalence tables list these as
   * "Equivalent (inherited)"; before 2026-09-29 the export left them out entirely.
   */
  private async inheritedGradeRows(own: GradeMapping[]) {
    const live = await this.priceCirculars
      .find({ producer: "GAIL", status: "active", secondary: { $ne: true } }, { _id: 1 })
      .lean();
    const codes: string[] = live.length
      ? await this.priceEntries.distinct("grade", { circular: { $in: live.map((c) => c._id) } })
      : [];
    const byFolded = new Map(own.map((g) => [normaliseGrade(g.gailGrade), g]));
    const rows: Array<{ code: string; base: GradeMapping | null; rule: string }> = [];
    for (const code of [...new Set(codes)].sort()) {
      const folded = normaliseGrade(code);
      if (byFolded.has(folded)) continue;
      const additive = additiveBaseOf(code);
      const form = formBaseOf(code);
      const viaAdditive = additive ? byFolded.get(additive) : undefined;
      const viaForm = !viaAdditive && form ? byFolded.get(form) : undefined;
      rows.push({
        code,
        base: viaAdditive ?? viaForm ?? null,
        rule: viaAdditive ? "NA additive of" : viaForm ? "form letter of" : "",
      });
    }
    return rows;
  }

  async gradeMappingWorkbook(): Promise<ExcelJS.Workbook> {
    const grades = await this.gradeMappings.find().sort({ gailGrade: 1 }).lean();
    const producers = await this.producers.find({ active: true, isSelf: false }).sort({ code: 1 }).lean();
    const inherited = await this.inheritedGradeRows(grades as GradeMapping[]);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GCPE";
    wb.created = new Date();
    const sheet = wb.addWorksheet("Grade Mapping");

    const baseCols = [
      { key: "gailGrade", width: 16 },
      { key: "polymer", width: 10 },
      { key: "section", width: 12 },
      { key: "application", width: 20 },
      { key: "characteristic", width: 18 },
      { key: "process", width: 14 },
      { key: "mfi", width: 10 },
      { key: "density", width: 10 },
      { key: "confidence", width: 12 },
      { key: "status", width: 12 },
    ];
    const producerCols = producers.map((p) => ({ key: `eq_${p.code}`, width: 20 }));
    sheet.columns = [...baseCols, ...producerCols, { key: "intl", width: 24 }, { key: "via", width: 30 }];

    const span = sheet.columns.length;
    titleBar(sheet, span, [
      "Grade Mapping Master",
      `${grades.length} grades with their own row · ${inherited.length} more GAIL codes priced in the live book · Generated ${new Date().toLocaleString("en-IN")}`,
    ]);
    headerRow(sheet, [
      "GAIL grade",
      "Polymer",
      "Section",
      "Application",
      "Characteristic",
      "Process",
      "MFI",
      "Density",
      "Confidence",
      "Status",
      ...producers.map((p) => `${p.code} equivalent`),
      "International equivalents",
      "Equivalents from",
    ]);

    type Line = { g: any; code: string; via: string; muted: boolean };
    const lines: Line[] = [
      ...grades.map((g) => ({ g, code: g.gailGrade, via: "own row", muted: g.status !== "active" })),
      ...inherited.map((r) => ({
        g: r.base ?? { status: "unmapped", application: "Not in the cross-reference", equivalents: {} },
        code: r.code,
        via: r.base ? `inherited: ${r.rule} ${r.base.gailGrade}` : "no row: GAIL only",
        muted: true,
      })),
    ].sort((a, b) => a.code.localeCompare(b.code));

    for (const { g, code, via, muted } of lines) {
      const row = sheet.addRow([
        g.gailGrade,
        g.polymer ?? "",
        g.section ?? "",
        g.application ?? "",
        g.characteristic ?? "",
        g.process ?? "",
        g.mfi ?? "",
        g.density ?? "",
        g.confidence ?? "",
        g.status,
        ...producers.map((p) => (g.equivalents?.[p.code] ?? []).join(", ")),
        (g.international ?? []).join(", "),
        via,
      ]);
      row.getCell(1).value = code;
      if (muted) {
        // Orange: a row that is not active. Grey: a code that takes another row's equivalents.
        const inactive = via === "own row" || g.status === "unmapped";
        row.eachCell((cell) => {
          cell.font = { italic: true, color: { argb: inactive ? "FF9A6B00" : "FF5B6770" } };
        });
      }
      borderRow(row);
    }
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: span } };

    return wb;
  }

  async locationMasterWorkbook(): Promise<ExcelJS.Workbook> {
    const locations = await this.locations.find().sort({ name: 1 }).lean();
    const producers = await this.producers.find({ active: true, isSelf: false }).sort({ code: 1 }).lean();

    const wb = new ExcelJS.Workbook();
    wb.creator = "GCPE";
    wb.created = new Date();
    const sheet = wb.addWorksheet("Location Master");

    const zoneCols = producers.map((p) => ({ key: `zone_${p.code}`, width: 20 }));
    const freightCols = producers.map((p) => ({ key: `freight_${p.code}`, width: 20 }));
    // Appended after the original columns so a sheet built on the old layout still lines up.
    const depotProducers = ["GAIL", ...producers.map((p) => p.code)];
    const tierCols = producers.map((p) => ({ key: `tier_${p.code}`, width: 18 }));
    const depotCols = depotProducers.map((p) => ({ key: `depot_${p}`, width: 22 }));
    sheet.columns = [
      { key: "name", width: 24 },
      { key: "sapCode", width: 14 },
      ...zoneCols,
      ...freightCols,
      ...tierCols,
      ...depotCols,
    ];

    const span = sheet.columns.length;
    titleBar(sheet, span, [
      "Location Master",
      `${locations.length} locations · Generated ${new Date().toLocaleString("en-IN")}`,
    ]);
    headerRow(sheet, [
      "GAIL location",
      "SAP code",
      ...producers.map((p) => `${p.code} pricing zone`),
      ...producers.map((p) => `${p.code} freight destination`),
      ...producers.map((p) => `${p.code} match type`),
      ...depotProducers.map((p) => `${p} Ex Depot point`),
    ]);

    for (const loc of locations) {
      const row = sheet.addRow([
        loc.name,
        loc.sapCode ?? "",
        ...producers.map((p) => loc.producerZone?.[p.code] ?? ""),
        ...producers.map((p) => loc.freightDestination?.[p.code] ?? ""),
        ...producers.map((p) => (loc.producerZone?.[p.code] ? tierLabel(loc.producerZoneTier?.[p.code]) : "")),
        ...depotProducers.map((p) => loc.producerDepotZone?.[p] ?? ""),
      ]);
      borderRow(row);
    }
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: span } };

    return wb;
  }
}
