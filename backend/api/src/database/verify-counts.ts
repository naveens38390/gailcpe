/**
 * Read-only sanity check against whatever MONGODB_URI points at. Prints
 * document counts per collection — no writes, no deletes. Run after `npm run
 * seed` to confirm Atlas actually holds what the seed script claimed.
 *
 *   npx ts-node -r tsconfig-paths/register src/database/verify-counts.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv();
import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set in .env — nothing to verify.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const collections = await db.listCollections().toArray();
  console.log(`connected: ${uri.replace(/\/\/[^@]*@/, "//***@")}`);
  console.log(`database: ${db.databaseName}\n`);
  if (collections.length === 0) {
    console.log("No collections found — Atlas is empty. Run `npm run seed` first.");
  } else {
    for (const c of collections.sort((a, b) => a.name.localeCompare(b.name))) {
      const count = await db.collection(c.name).countDocuments();
      console.log(`  ${c.name.padEnd(20)} ${count.toLocaleString("en-IN")}`);
    }
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
