import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";

import {
  FreightCircular,
  PriceCircular,
  PriceEntry,
  type CircularStatus,
  type FreightCircularDocument,
} from "../../database/schemas/circular.schema";
import { DatasetService } from "../dataset/dataset.service";
import { CircularStoreService } from "./circular-store.service";
import { parseExtract } from "./extract-format";
import {
  parseFreightExtract,
  validateFreightRows,
  type ParsedFreightRow,
} from "./freight-extract-format";
import { extractFreightPdf, type FreightPdfExtractResult } from "./freight-pdf-extractor";
import { PriceCircularsService } from "../price-circulars/price-circulars.service";
import { FreightCircularsService } from "../freight-circulars/freight-circulars.service";
import { UploadCircularDto } from "./dto/upload-circular.dto";

/**
 * Circular Repository.
 *
 * Versioned by effective date from the first record, because new circulars
 * arrive monthly and an officer defending a quote needs the circular that was
 * live on the day they gave it — not today's.
 *
 * Publishing supersedes rather than deletes: `status` moves to "superseded" and
 * the entries stay, so `asOf` queries keep working.
 */
@Injectable()
export class CircularsService {
  constructor(
    @InjectModel(PriceCircular.name) private prices: Model<PriceCircular>,
    @InjectModel(FreightCircular.name) private freight: Model<FreightCircular>,
    @InjectModel(PriceEntry.name) private entries: Model<PriceEntry>,
    private dataset: DatasetService,
    private store: CircularStoreService,
    private priceCirculars: PriceCircularsService,
    private freightCirculars: FreightCircularsService,
  ) {}

  /**
   * Take receipt of a circular document.
   *
   * This records the source and nothing else. It deliberately does not touch
   * prices: extraction still runs outside the application, and a circular that
   * has been filed is not the same thing as a circular that has been applied.
   * The record lands with no entries and no status change, so nothing an
   * officer quotes from moves because a file was uploaded.
   */
  async upload(
    dto: UploadCircularDto,
    file: { buffer: Buffer; originalname?: string },
    userId?: string,
  ) {
    const effectiveDate = new Date(dto.effectiveDate);
    if (Number.isNaN(effectiveDate.getTime())) {
      throw new BadRequestException("That effective date is not a real date.");
    }

    const round = effectiveDate.toISOString().slice(0, 10);
    const reference = dto.reference?.trim();
    // A price circular always prints a reference; a freight schedule often
    // does not, and a system-assigned label is more honest than an invented one.
    if (!reference && dto.kind === "price") {
      throw new BadRequestException("A price circular needs its reference number.");
    }
    const stored = await this.store.put(file, round);

    const common = {
      producer: dto.producer.trim(),
      reference: reference || `${dto.producer.trim()} freight ${round}`,
      effectiveDate,
      sourceKey: stored.key,
      sourceFilename: file.originalname,
      uploadedBy: userId ? new Types.ObjectId(userId) : undefined,
      uploadedAt: new Date(),
      // Filed, not live — the existing "draft" state. Publishing stays a
      // separate, deliberate act.
      status: "draft" as CircularStatus,
    };

    const created =
      dto.kind === "price"
        ? await this.prices.create({ ...common, basis: "ex_works" })
        : await this.freight.create(common);

    return {
      id: String(created._id),
      kind: dto.kind,
      producer: common.producer,
      reference: common.reference,
      effectiveDate: round,
      sourceKey: stored.key,
      sourceFilename: file.originalname ?? null,
      bytes: stored.bytes,
      documentType: stored.label,
      status: common.status,
    };
  }

  /**
   * Attach the extracted reading of a circular already on file, and turn it
   * into a draft for review.
   *
   * The extract is stored beside the document it came from rather than
   * standing alone, so the circular record answers both halves of "why did
   * this price move" — what the producer published, and what was read out of
   * it. Publishing remains a separate, deliberate act on the draft.
   */
  async attachExtract(
    id: string,
    file: { buffer: Buffer; originalname?: string },
    userId?: string,
  ) {
    const circular = await this.prices.findById(id);
    if (!circular) {
      // Freight circulars go through the same two-files-one-event flow, into
      // their own draft model — the rows are keyed on destination, not on
      // zone and grade, so the reading is parsed and drafted separately.
      const freight = await this.freight.findById(id);
      if (freight) return this.attachFreightExtract(freight, file, userId);
      throw new NotFoundException("No such circular.");
    }
    if (circular.draft) {
      throw new BadRequestException(
        "That circular already has a draft. Discard it before attaching a different reading.",
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(file.buffer.toString("utf8"));
    } catch {
      throw new BadRequestException("That file is not valid JSON.");
    }
    const extract = parseExtract(parsedJson, circular.producer);

    const round = circular.effectiveDate.toISOString().slice(0, 10);
    const stored = await this.store.put(file, round, { allowJson: true });

    const result = await this.priceCirculars.createFromExtract({
      producer: circular.producer,
      circularNumber: circular.reference,
      effectiveDate: circular.effectiveDate,
      reason: `Extracted from ${circular.sourceFilename ?? circular.reference}`,
      userId: userId ?? "",
      zones: extract.zones,
      basis: extract.basis,
    });

    circular.extractKey = stored.key;
    circular.extractFilename = file.originalname;
    circular.extractedAt = new Date();
    circular.draft = result.draft._id;
    await circular.save();

    return {
      circularId: String(circular._id),
      draftId: String(result.draft._id),
      producer: circular.producer,
      reference: circular.reference,
      effectiveDate: round,
      rowCount: result.rowCount,
      changedRowCount: result.changedRowCount,
      addedCount: result.addedCount,
      added: result.added,
      removedCount: result.removedCount,
      removed: result.removed,
      status: result.draft.status,
    };
  }

  /**
   * The freight half of `attachExtract`.
   *
   * Same contract, same guards, same "publishing stays a separate act" — the
   * only differences are the shape being parsed and which draft model it
   * lands in.
   */
  private async attachFreightExtract(
    circular: FreightCircularDocument,
    file: { buffer: Buffer; originalname?: string },
    userId?: string,
  ) {
    if (circular.draft) {
      throw new BadRequestException(
        "That circular already has a draft. Discard it before attaching a different reading.",
      );
    }

    const round = circular.effectiveDate.toISOString().slice(0, 10);
    const isPdf = file.buffer.subarray(0, 4).toString("latin1") === "%PDF";

    let rows: ParsedFreightRow[];
    let pdfMeta: FreightPdfExtractResult | null = null;
    if (isPdf) {
      const extract = await extractFreightPdf(file.buffer, circular.producer);
      if (extract.confidence === "low") {
        // Stop before a draft is built at all — the caller sees exactly what
        // was and was not read, and can attach a JSON reading instead rather
        // than review a draft built on a guess.
        throw new BadRequestException({
          message:
            "This PDF could not be read with enough confidence to build a draft automatically.",
          extraction: {
            producer: extract.producer,
            candidateRowCount: extract.candidateRowCount,
            parsedRowCount: extract.parsedRowCount,
            confidence: extract.confidence,
            warnings: extract.warnings,
          },
        });
      }
      // The same rules a JSON reading has to pass. Reading a PDF is a less
      // certain business than being handed numbers, not a more certain one.
      rows = validateFreightRows(extract.rows, file.originalname ?? "the PDF");
      pdfMeta = extract;
    } else {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(file.buffer.toString("utf8"));
      } catch {
        throw new BadRequestException(
          "That is not a PDF this can read, and not valid JSON either.",
        );
      }
      rows = parseFreightExtract(parsedJson, circular.producer).rows;
    }

    const stored = await this.store.put(file, round, { allowJson: !isPdf });

    const result = await this.freightCirculars.createFromExtract({
      producer: circular.producer,
      circularNumber: circular.reference ?? `${circular.producer} freight ${round}`,
      effectiveDate: circular.effectiveDate,
      reason: `Extracted from ${circular.sourceFilename ?? circular.reference ?? "the filed circular"}`,
      userId: userId ?? "",
      rows,
    });

    circular.extractKey = stored.key;
    circular.extractFilename = file.originalname;
    circular.extractedAt = new Date();
    circular.draft = result.draft._id;
    await circular.save();

    // Cross-checks the PDF's own printed date and reference against what the
    // circular was filed with. Informational only — the filed values are
    // what the draft is built against, never overwritten by a guess.
    const notes: string[] = [];
    if (pdfMeta?.effectiveDate && pdfMeta.effectiveDate !== round) {
      notes.push(
        `This PDF reads its effective date as ${pdfMeta.effectiveDate}, but the circular was filed as ${round}.`,
      );
    }
    if (
      pdfMeta?.circularNumber &&
      circular.reference &&
      pdfMeta.circularNumber !== circular.reference
    ) {
      notes.push(
        `This PDF reads its own reference as "${pdfMeta.circularNumber}", but the circular was filed as "${circular.reference}".`,
      );
    }

    return {
      circularId: String(circular._id),
      draftId: String(result.draft._id),
      kind: "freight" as const,
      producer: circular.producer,
      reference: circular.reference ?? null,
      effectiveDate: round,
      rowCount: result.rowCount,
      changedRowCount: result.changedRowCount,
      addedCount: result.addedCount,
      added: result.added,
      removedCount: result.removedCount,
      removed: result.removed,
      unmappedCount: result.unmappedCount,
      unmapped: result.unmapped,
      ambiguousCount: result.ambiguousCount,
      ambiguous: result.ambiguous,
      status: result.draft.status,
      pdfExtraction: pdfMeta
        ? {
            candidateRowCount: pdfMeta.candidateRowCount,
            parsedRowCount: pdfMeta.parsedRowCount,
            notes,
          }
        : undefined,
    };
  }

  /** The stored source document, for the "open the circular" link. */
  async source(id: string) {
    const record =
      (await this.prices.findById(id).lean()) ?? (await this.freight.findById(id).lean());
    if (!record?.sourceKey) {
      throw new NotFoundException("No source document was stored for that circular.");
    }
    const stored = await this.store.read(record.sourceKey);
    return {
      data: stored.data,
      filename: record.sourceFilename ?? stored.filename ?? record.sourceKey.split("/").pop()!,
    };
  }

  async list(kind?: "price" | "freight") {
    const [price, freight] = await Promise.all([
      kind === "freight" ? [] : this.prices.find().sort({ effectiveDate: -1 }).lean(),
      kind === "price" ? [] : this.freight.find().sort({ effectiveDate: -1 }).lean(),
    ]);
    return {
      price: price.map((c) => ({ ...c, kind: "price" as const })),
      freight: freight.map((c) => ({ ...c, kind: "freight" as const })),
    };
  }

  async rounds() {
    const rows = await this.prices.aggregate([
      { $group: { _id: "$effectiveDate", producers: { $addToSet: "$producer" } } },
      { $sort: { _id: -1 } },
    ]);
    return rows.map((r) => ({
      effectiveDate: r._id,
      producers: r.producers.sort(),
    }));
  }

  async detail(id: string) {
    const circular = await this.prices.findById(id).lean();
    if (!circular) throw new NotFoundException("No such circular.");
    const sample = await this.entries
      .find({ circular: circular._id })
      .limit(50)
      .lean();
    return { circular, sample };
  }

  /**
   * What changed between two rounds for one producer — the question a pricing
   * officer asks the morning a circular lands.
   */
  async diff(producer: string, from: Date, to: Date) {
    const [before, after] = await Promise.all([
      this.entries.find({ producer, effectiveDate: from }).lean(),
      this.entries.find({ producer, effectiveDate: to }).lean(),
    ]);
    const key = (e: { zone: string; grade: string }) => `${e.zone}|${e.grade}`;
    const beforeMap = new Map(before.map((e) => [key(e), e.price]));

    const changes: Array<{
      zone: string;
      grade: string;
      from: number | null;
      to: number;
      delta: number | null;
    }> = [];
    for (const entry of after) {
      const previous = beforeMap.get(key(entry)) ?? null;
      if (previous === entry.price) continue;
      changes.push({
        zone: entry.zone,
        grade: entry.grade,
        from: previous,
        to: entry.price,
        delta: previous === null ? null : Math.round((entry.price - previous) * 100) / 100,
      });
    }
    changes.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

    const moved = changes.filter((c) => c.delta !== null);
    return {
      producer,
      from,
      to,
      changed: changes.length,
      increased: moved.filter((c) => c.delta! > 0).length,
      decreased: moved.filter((c) => c.delta! < 0).length,
      added: changes.filter((c) => c.delta === null).length,
      changes: changes.slice(0, 200),
    };
  }

  /** Called after a new circular is loaded, so the next request re-reads. */
  async publish(id: string) {
    const circular = await this.prices.findById(id);
    if (!circular) throw new NotFoundException("No such circular.");
    await this.prices.updateMany(
      {
        producer: circular.producer,
        effectiveDate: { $lt: circular.effectiveDate },
        status: "active",
      },
      { status: "superseded" },
    );
    circular.status = "active";
    await circular.save();
    this.dataset.invalidate();
    return circular;
  }
}
