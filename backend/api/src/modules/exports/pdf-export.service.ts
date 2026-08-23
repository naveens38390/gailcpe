/**
 * PDF Generation — Published Circular -> Template Renderer -> PDF.
 *
 * Server-side only, from published data. Never hand-edited: a mistake in a
 * circular gets fixed by rolling back or publishing a correction, and the PDF
 * is regenerated from whatever is active at the time it's downloaded.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import PDFDocument from "pdfkit";

import { Producer } from "../../database/schemas/catalog.schema";
import {
  DiscountScheme,
  FreightCircular,
  FreightEntry,
  PriceCircular,
  PriceEntry,
} from "../../database/schemas/circular.schema";
import { DiscountTerms } from "../../database/schemas/discount-terms.schema";

const INK = "#1F3B57";
const RULE = "#D0D7DE";
const MUTED = "#5B6B7A";

interface Column {
  header: string;
  width: number;
  key: string;
  align?: "left" | "right";
  numeric?: boolean;
}

function drawTable(
  doc: PDFKit.PDFDocument,
  columns: Column[],
  rows: Array<Record<string, string | number>>,
  startX: number,
) {
  const rowHeight = 16;
  const bottomMargin = doc.page.margins.bottom;
  const pageBottom = doc.page.height - bottomMargin;

  function header() {
    const y = doc.y;
    doc.rect(startX, y, columns.reduce((s, c) => s + c.width, 0), rowHeight).fill("#E4ECF3");
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8);
    let x = startX;
    for (const col of columns) {
      doc.text(col.header, x + 3, y + 4, { width: col.width - 6, align: col.align ?? "left" });
      x += col.width;
    }
    doc.y = y + rowHeight;
    doc.font("Helvetica").fillColor("#000000");
  }

  header();
  let stripe = false;
  for (const row of rows) {
    if (doc.y + rowHeight > pageBottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      header();
    }
    const y = doc.y;
    if (stripe) {
      doc.rect(startX, y, columns.reduce((s, c) => s + c.width, 0), rowHeight).fill("#F7F9FB");
    }
    stripe = !stripe;
    doc.fillColor("#1A1A1A").fontSize(8);
    let x = startX;
    for (const col of columns) {
      const raw = row[col.key];
      const text = col.numeric && typeof raw === "number" ? raw.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(raw ?? "");
      doc.text(text, x + 3, y + 4, { width: col.width - 6, align: col.align ?? "left" });
      x += col.width;
    }
    doc
      .moveTo(startX, y + rowHeight)
      .lineTo(startX + columns.reduce((s, c) => s + c.width, 0), y + rowHeight)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    doc.y = y + rowHeight;
  }
}

function titleBlock(doc: PDFKit.PDFDocument, title: string, subtitle: string, meta: string) {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(title);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(subtitle);
  doc.fillColor(MUTED).fontSize(8).text(meta);
  doc.moveDown(0.75);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(RULE)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.5);
}

@Injectable()
export class PdfExportService {
  constructor(
    @InjectModel(PriceCircular.name) private priceCirculars: Model<PriceCircular>,
    @InjectModel(PriceEntry.name) private priceEntries: Model<PriceEntry>,
    @InjectModel(FreightCircular.name) private freightCirculars: Model<FreightCircular>,
    @InjectModel(FreightEntry.name) private freightEntries: Model<FreightEntry>,
    @InjectModel(DiscountScheme.name) private discountSchemes: Model<DiscountScheme>,
    @InjectModel(DiscountTerms.name) private discountTerms: Model<DiscountTerms>,
    @InjectModel(Producer.name) private producers: Model<Producer>,
  ) {}

  async priceCircularPdf(circularId: string): Promise<Buffer> {
    const circular = await this.priceCirculars.findById(circularId).lean();
    if (!circular) throw new NotFoundException("No such price circular.");
    const rows = await this.priceEntries
      .find({ circular: new Types.ObjectId(circularId) })
      .sort({ zone: 1, grade: 1 })
      .lean();

    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 40, bufferPages: true });
    titleBlock(
      doc,
      `${circular.producer} — Price Circular`,
      `Reference ${circular.reference} · Effective ${circular.effectiveDate.toLocaleDateString("en-IN")} · ${circular.basis}`,
      `${rows.length.toLocaleString("en-IN")} price lines across ${circular.stats?.zones ?? new Set(rows.map((r) => r.zone)).size} zones · Generated ${new Date().toLocaleString("en-IN")}`,
    );

    drawTable(
      doc,
      [
        { header: "Zone / Location", width: 260, key: "zone" },
        { header: "Grade", width: 110, key: "grade" },
        { header: "Price (₹/MT)", width: 105, key: "price", align: "right", numeric: true },
      ],
      rows.map((r) => ({ zone: r.zone, grade: r.grade, price: r.price })),
      40,
    );

    return this.toBuffer(doc);
  }

  async freightCircularPdf(circularId: string): Promise<Buffer> {
    const circular = await this.freightCirculars.findById(circularId).lean();
    if (!circular) throw new NotFoundException("No such freight circular.");
    const rows = await this.freightEntries
      .find({ circular: new Types.ObjectId(circularId) })
      .sort({ destination: 1 })
      .lean();

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40, bufferPages: true });
    titleBlock(
      doc,
      `${circular.producer} — Freight Circular`,
      `${circular.reference ? `Reference ${circular.reference} · ` : ""}Effective ${circular.effectiveDate.toLocaleDateString("en-IN")}`,
      `${rows.length.toLocaleString("en-IN")} destinations · Generated ${new Date().toLocaleString("en-IN")}`,
    );

    drawTable(
      doc,
      [
        { header: "Destination", width: 190, key: "destination" },
        { header: "State", width: 130, key: "state" },
        { header: "District", width: 130, key: "district" },
        { header: "Cluster", width: 110, key: "cluster" },
        { header: "Dist. (km)", width: 80, key: "distanceKm", align: "right", numeric: true },
        { header: "Transit (d)", width: 80, key: "transitDays", align: "right", numeric: true },
        { header: "Rate (₹/MT)", width: 90, key: "ratePerMt", align: "right", numeric: true },
        { header: "Insurance (₹/MT)", width: 100, key: "insurancePerMt", align: "right", numeric: true },
      ],
      rows.map((r) => ({
        destination: r.destination,
        state: r.state ?? "",
        district: r.district ?? "",
        cluster: r.cluster ?? "",
        distanceKm: r.distanceKm ?? "",
        transitDays: r.transitDays ?? "",
        ratePerMt: r.ratePerMt,
        insurancePerMt: r.insurancePerMt ?? 0,
      })),
      40,
    );

    return this.toBuffer(doc);
  }

  async discountCircularPdf(): Promise<Buffer> {
    const gail = await this.discountTerms.findOne({ producer: "GAIL" }).lean();
    const producers = await this.producers.find({ active: true }).sort({ code: 1 }).lean();
    const others = producers.filter((p) => p.code !== "GAIL");
    const latestByProducer = await this.discountSchemes.aggregate<DiscountScheme>([
      { $match: { producer: { $in: others.map((p) => p.code) } } },
      { $sort: { effectiveDate: -1 } },
      { $group: { _id: "$producer", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ]);

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40, bufferPages: true });
    titleBlock(
      doc,
      "Discount Terms — GAIL vs Others",
      "Cash discount, early-payment incentive, interest-free credit and dealer discount, by producer",
      `Generated ${new Date().toLocaleString("en-IN")}`,
    );

    const rows = [
      { producer: "GAIL", d: gail, asOf: gail?.effectiveFrom ? new Date(gail.effectiveFrom).toLocaleDateString("en-IN") : "live" },
      ...others.map((p) => {
        const d = latestByProducer.find((x) => x.producer === p.code);
        return { producer: p.code, d, asOf: d?.effectiveDate ? new Date(d.effectiveDate).toLocaleDateString("en-IN") : "—" };
      }),
    ];

    drawTable(
      doc,
      [
        { header: "Producer", width: 90, key: "producer" },
        { header: "Cash discount (₹/MT)", width: 130, key: "cashDiscount", align: "right", numeric: true },
        { header: "CD — LDPE (₹/MT)", width: 120, key: "cashDiscountLdpe", align: "right", numeric: true },
        { header: "EPI (₹/MT/day)", width: 110, key: "earlyPaymentPerDay", align: "right", numeric: true },
        { header: "EPI max (days)", width: 100, key: "earlyPaymentMaxDays", align: "right", numeric: true },
        { header: "IFC (days)", width: 90, key: "interestFreeCreditDays", align: "right", numeric: true },
        { header: "Dealer disc. (₹/MT)", width: 120, key: "dealerDiscount", align: "right", numeric: true },
        { header: "As of", width: 100, key: "asOf" },
      ],
      rows.map((r) => ({
        producer: r.producer,
        cashDiscount: r.d?.cashDiscount ?? "",
        cashDiscountLdpe: r.d?.cashDiscountLdpe ?? "",
        earlyPaymentPerDay: r.d?.earlyPaymentPerDay ?? "",
        earlyPaymentMaxDays: r.d?.earlyPaymentMaxDays ?? "",
        interestFreeCreditDays: r.d?.interestFreeCreditDays ?? "",
        dealerDiscount: r.d?.dealerDiscount ?? "",
        asOf: r.asOf,
      })),
      40,
    );

    const slabRows: Array<{ producer: string; from: number; to: string | number; rate: number }> = [];
    for (const r of rows) {
      for (const s of r.d?.quantitySlabs ?? []) {
        slabRows.push({ producer: r.producer, from: s.from_mt, to: s.to_mt ?? "and above", rate: s.rate_per_mt });
      }
    }
    if (slabRows.length) {
      doc.moveDown(1);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text("Quantity discount slabs");
      doc.moveDown(0.5);
      drawTable(
        doc,
        [
          { header: "Producer", width: 120, key: "producer" },
          { header: "From (MT)", width: 120, key: "from", align: "right", numeric: true },
          { header: "To (MT)", width: 120, key: "to", align: "right" },
          { header: "Rate (₹/MT)", width: 120, key: "rate", align: "right", numeric: true },
        ],
        slabRows,
        40,
      );
    }

    return this.toBuffer(doc);
  }

  private toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
  }
}
