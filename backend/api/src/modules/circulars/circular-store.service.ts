/**
 * Where uploaded circulars are kept.
 *
 * The documents live in MongoDB, in their own collection, addressed by an
 * opaque key that the circular record stores. That indirection is the point:
 * the store is a mounted disk in one deployment and object storage in another,
 * and swapping it stays a change to this file alone.
 *
 * MongoDB is the right backend *here* specifically because this deployment has
 * no persistent volume. A hosted instance without one comes back from a
 * restart with an empty filesystem, so anything written to disk would vanish —
 * silently, leaving circular records pointing at documents that no longer
 * exist. Atlas is already provisioned and already backed up.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { randomUUID } from "node:crypto";

import { CircularDocument } from "../../database/schemas/circular-document.schema";

/**
 * The kinds of document a circular actually arrives as, recognised by their
 * leading bytes rather than by the name the browser sent.
 *
 * A filename is caller-controlled and proves nothing. Checking the signature
 * is what stops something that is not a document at all being filed under a
 * `.pdf` name.
 */
const SIGNATURES: Array<{ ext: string; magic: number[]; label: string }> = [
  { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46], label: "PDF" }, // %PDF
  { ext: "xlsx", magic: [0x50, 0x4b, 0x03, 0x04], label: "Excel workbook" }, // ZIP container
  { ext: "xls", magic: [0xd0, 0xcf, 0x11, 0xe0], label: "legacy Excel workbook" }, // OLE2
];

/**
 * A whole BSON document caps at 16MB and this stores the bytes inline, so the
 * ceiling is real rather than advisory. The largest circular in the current
 * round is 1.9MB, which leaves the limit a long way from binding.
 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export interface StoredDocument {
  /** What goes in the circular record's sourceKey or extractKey. */
  key: string;
  bytes: number;
  label: string;
}

@Injectable()
export class CircularStoreService {
  private readonly logger = new Logger(CircularStoreService.name);

  constructor(
    @InjectModel(CircularDocument.name) private documents: Model<CircularDocument>,
  ) {}

  /**
   * Store one uploaded document and return the key to record against the
   * circular. Nothing the caller sent is used to build that key.
   */
  async put(
    file: { buffer: Buffer; originalname?: string },
    round: string,
    options: { allowJson?: boolean } = {},
  ): Promise<StoredDocument> {
    if (!file?.buffer?.length) {
      throw new BadRequestException("That upload arrived empty.");
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `That file is ${(file.buffer.length / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
      );
    }

    // An extract is JSON, which has no signature to check. The caller has
    // already parsed it by this point, so its validity is established — this
    // only decides what the stored document is called.
    const match = options.allowJson
      ? { ext: "json", label: "extract" }
      : SIGNATURES.find((s) => s.magic.every((byte, i) => file.buffer[i] === byte));

    if (!match) {
      throw new BadRequestException(
        "That is not a PDF or Excel workbook. Circulars are published as one of those two.",
      );
    }

    // The round prefixes the key so a person reading the collection can see
    // what belongs together; the UUID is what makes it unique and unguessable.
    const key = `${sanitiseSegment(round)}/${randomUUID()}.${match.ext}`;

    await this.documents.create({
      key,
      filename: file.originalname,
      label: match.label,
      bytes: file.buffer.length,
      data: file.buffer,
    });

    this.logger.log(
      `stored ${match.label} ${(file.buffer.length / 1024).toFixed(0)}KB as ${key}` +
        (file.originalname ? ` (${file.originalname})` : ""),
    );
    return { key, bytes: file.buffer.length, label: match.label };
  }

  /** A stored document, for the "open the circular" link. */
  async read(key: string): Promise<{ data: Buffer; filename?: string; label: string }> {
    // Not `.lean()`: that hands back Mongo's Binary wrapper, and the point of
    // this method is to return something the response can be written from.
    const found = await this.documents.findOne({ key });
    if (!found) {
      throw new NotFoundException("That source document is no longer in the store.");
    }
    return { data: found.data, filename: found.filename, label: found.label };
  }
}

/** One key segment, reduced to characters that mean the same thing everywhere. */
function sanitiseSegment(value: string): string {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "");
  return cleaned || "unfiled";
}
