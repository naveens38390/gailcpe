/**
 * P2: read-only backup of the collections a release window changes, in the
 * format the rollback tools read (`src/database/release-lib.ts`).
 *
 *   MONGODB_URI=... npm run backup-collections -- --out <new empty dir> \
 *       [--collections locations,priceCirculars,discountSchemes]
 *
 * Runs under readonly-guard.js (see the npm script), so it cannot write to the
 * database. Writes one canonical-EJSON array per collection, `_manifest.json`
 * (counts, time taken) and `SHA256SUMS`, then reads every file back and checks
 * it against its hash. Copy the directory off the machine before the window.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import { EJSON, arg, redact, sha256 } from "../../database/release-lib";

const DEFAULT = ["locations", "priceCirculars", "discountSchemes"];

async function main() {
  const out = arg("out");
  if (!out) throw new Error("--out <new empty directory> is required.");
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty. Refusing to mix backups.`);
  const collections = (arg("collections") ?? DEFAULT.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required.");

  await mongoose.connect(uri);
  console.log(`connected: ${redact(uri)}`);
  const db = mongoose.connection.db!;
  mkdirSync(out, { recursive: true });

  const takenAt = new Date().toISOString();
  const counts: Record<string, number> = {};
  const sums: string[] = [];
  for (const name of collections) {
    const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    const text = EJSON.stringify(docs, { relaxed: false });
    writeFileSync(join(out, `${name}.ejson`), text, "utf8");
    counts[name] = docs.length;
    sums.push(`${sha256(text)}  ${name}.ejson`);
    console.log(`  ${name.padEnd(18)} ${docs.length} documents`);
  }
  await mongoose.disconnect();
  writeFileSync(join(out, "_manifest.json"), JSON.stringify({ takenAt, database: db.databaseName, collections: counts }, null, 1));
  writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");

  // Read back: every file must hash to its SHA256SUMS line and parse to the counted documents.
  for (const line of sums) {
    const [hash, file] = line.split(/\s+/);
    const raw = readFileSync(join(out, file));
    const n = (EJSON.parse(raw.toString("utf8"), { relaxed: false }) as unknown[]).length;
    if (sha256(raw) !== hash || n !== counts[file.replace(/\.ejson$/, "")]) throw new Error(`${file} did not read back intact.`);
  }
  console.log(`\nbackup written and read back: ${out}\n${sums.join("\n")}`);
}

main().catch((error) => {
  console.error(String(error?.stack ?? error).replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>"));
  process.exit(1);
});
