/**
 * Where uploaded circulars are kept.
 *
 * The documents themselves never go in MongoDB — a round is ~14 files and
 * several megabytes each, which would bloat every Atlas backup for no benefit.
 * They live on a mounted disk instead, addressed by an opaque key that the
 * circular record stores. The key is deliberately meaningless to the
 * filesystem beyond its round folder, so moving this to object storage later
 * is a change to this file alone.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * The kinds of document a circular actually arrives as, recognised by their
 * leading bytes rather than by the name the browser sent.
 *
 * A filename is caller-controlled and proves nothing. Checking the signature
 * is what stops something that is not a document at all being written into the
 * store under a `.pdf` name.
 */
const SIGNATURES: Array<{ ext: string; magic: number[]; label: string }> = [
  { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46], label: "PDF" }, // %PDF
  { ext: "xlsx", magic: [0x50, 0x4b, 0x03, 0x04], label: "Excel workbook" }, // ZIP container
  { ext: "xls", magic: [0xd0, 0xcf, 0x11, 0xe0], label: "legacy Excel workbook" }, // OLE2
];

/** The largest circular in the current round is 1.9MB; this leaves real room. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export interface StoredDocument {
  /** What goes in the circular record's sourceKey. */
  key: string;
  bytes: number;
  label: string;
}

@Injectable()
export class CircularStoreService {
  private readonly logger = new Logger(CircularStoreService.name);

  /**
   * On Render this is the mount path of the attached disk. Locally it falls
   * back to a folder beside the project so a developer needs no setup.
   */
  private readonly root = resolve(
    process.env.CIRCULAR_STORE_DIR ?? join(process.cwd(), "var", "circulars"),
  );

  constructor() {
    // A hosted instance without a mounted disk has an ephemeral filesystem:
    // uploads would appear to succeed and then disappear on the next restart,
    // leaving circular records pointing at files that no longer exist. Better
    // to say so once at boot than to discover it after a redeploy.
    if (process.env.NODE_ENV === "production" && !process.env.CIRCULAR_STORE_DIR) {
      this.logger.warn(
        `CIRCULAR_STORE_DIR is not set — storing circulars in ${this.root}, ` +
          "which is not persistent on a hosted instance. Uploaded documents " +
          "will be lost on the next restart. Attach a disk and point this at it.",
      );
    }
  }

  /**
   * Write one uploaded document and return the key to record against the
   * circular. Nothing the caller sent is used to build the path.
   */
  async put(file: { buffer: Buffer; originalname?: string }, round: string): Promise<StoredDocument> {
    if (!file?.buffer?.length) {
      throw new BadRequestException("That upload arrived empty.");
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `That file is ${(file.buffer.length / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
      );
    }

    const match = SIGNATURES.find((s) =>
      s.magic.every((byte, i) => file.buffer[i] === byte),
    );
    if (!match) {
      throw new BadRequestException(
        "That is not a PDF or Excel workbook. Circulars are published as one of those two.",
      );
    }

    // The round groups the store so a person can find a file on disk; the UUID
    // is what makes the name safe, and unguessable.
    const folder = sanitiseSegment(round);
    const key = `${folder}/${randomUUID()}.${match.ext}`;

    const destination = this.pathFor(key);
    await mkdir(join(this.root, folder), { recursive: true });
    await writeFile(destination, file.buffer);

    this.logger.log(
      `stored ${match.label} ${(file.buffer.length / 1024).toFixed(0)}KB as ${key}` +
        (file.originalname ? ` (${file.originalname})` : ""),
    );
    return { key, bytes: file.buffer.length, label: match.label };
  }

  /** Stream a stored document back out, for the "open the source" link. */
  async read(key: string): Promise<ReadStream> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch {
      throw new NotFoundException("That source document is no longer in the store.");
    }
    return createReadStream(path);
  }

  /**
   * Resolve a key to a path, refusing anything that climbs out of the store.
   *
   * Keys are generated here, so this should never fire — but a stored key is
   * read back from the database, and treating database content as trusted
   * input is how a traversal gets in later.
   */
  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new BadRequestException("That document key is not valid.");
    }
    return path;
  }
}

/** One path segment, reduced to characters that mean the same thing everywhere. */
function sanitiseSegment(value: string): string {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "");
  return cleaned || "unfiled";
}
