/**
 * Remove the ex-depot price books from a round, and undo everything
 * `load-depot.ts` (or a full `seed.ts`) added for them — without touching
 * anything else.
 *
 *   MONGODB_URI=... npm run rollback-depot            # reports what it would undo, writes nothing
 *   MONGODB_URI=... npm run rollback-depot -- --apply # writes
 *
 * This exists for one situation: ex-depot data is live in production and
 * something about it needs to come back out — a bad load, a bad source round,
 * a client-confirmed error — while Ex Works keeps running undisturbed.
 *
 * It removes exactly what adding the depot list adds:
 *   - every PriceEntry with basis:"ex_depot" for the round (whichever script wrote them)
 *   - producerDepotZone / producerDepotZoneTier on every Location — nothing else in
 *     this codebase writes these fields, so removing them is unconditional
 *   - cashDiscountDepot on every DiscountScheme for the round — likewise nothing
 *     else writes this field. IMPORTANT: the engine falls back to the WORKS cash
 *     discount when cashDiscountDepot is undefined but a depot price still
 *     exists (core/pricing.ts). Clearing this field is only correct done
 *     together with removing the depot price entries and zone maps above, which
 *     this script always does in the same pass — never clear it alone.
 *   - a works zone/tier that load-depot filled in, but ONLY where the current
 *     value still equals exactly what load-depot would have filled in. If an
 *     admin corrected it since (to a different zone), the values differ and the
 *     correction is left alone — the same compare-and-set rule load-depot itself
 *     uses when deciding whether to fill a works zone at all. A hand correction
 *     that happens to re-type the identical value cannot be told apart from an
 *     untouched fill and would be removed too — a narrow, known limitation with
 *     no revision history to check against for Location (R16).
 *
 * Never run `seed.ts` as a rollback — it replaces master data outright and
 * discards any hand correction (R4). This script only removes what depot
 * loading added.
 *
 * Reads a staged directory (GCPE_DATA) the same way `load-depot.ts` and the
 * seeder do, so it knows exactly what to undo for a given round.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import { LocationSchema } from "./schemas/catalog.schema";
import {
  DiscountSchemeSchema,
  PriceEntrySchema,
} from "./schemas/circular.schema";

const DATA = process.env.GCPE_DATA ?? join(__dirname, "..", "..", "..", "data", "normalized");
const read = (name: string) => JSON.parse(readFileSync(join(DATA, `${name}.json`), "utf8"));
const APPLY = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required: this removes ex-depot data from a specific database.");
  await mongoose.connect(uri);
  console.log(`connected: ${uri.replace(/\/\/[^@]*@/, "//***@")}`);
  console.log(APPLY ? "mode: APPLY (writing)\n" : "mode: dry run (nothing is written; pass --apply)\n");

  const priceIndex = read("price_index");
  const discounts = read("discounts");
  const priceDate = new Date(priceIndex.effective_date);
  console.log(`round: ${priceIndex.effective_date}\n`);

  const PriceEntry = mongoose.model("PriceEntry", PriceEntrySchema);
  const Location = mongoose.model("Location", LocationSchema);
  const DiscountScheme = mongoose.model("DiscountScheme", DiscountSchemeSchema);

  // ---- price entries ---------------------------------------------------------
  const byProducer = await PriceEntry.aggregate([
    { $match: { effectiveDate: priceDate, basis: "ex_depot" } },
    { $group: { _id: "$producer", n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  let removed = 0;
  for (const row of byProducer) {
    console.log(`  ${String(row._id).padEnd(5)} ${row.n.toLocaleString("en-IN")} ex-depot prices to remove`);
    removed += row.n;
  }
  if (APPLY && removed > 0) {
    await PriceEntry.deleteMany({ effectiveDate: priceDate, basis: "ex_depot" });
  }

  // ---- locations -------------------------------------------------------------
  const worksMap = priceIndex.location_map ?? {};
  const worksTier = priceIndex.location_tier ?? {};
  let depotMapsCleared = 0;
  let worksZonesReverted = 0;
  for (const doc of await Location.find({}).lean<any[]>()) {
    const unset: Record<string, ""> = {};
    if (doc.producerDepotZone !== undefined || doc.producerDepotZoneTier !== undefined) {
      unset.producerDepotZone = "";
      unset.producerDepotZoneTier = "";
      depotMapsCleared++;
    }
    // Only undo a works-zone fill that still exactly matches what load-depot
    // would have written — never touch a value an admin has since corrected.
    for (const producer of Object.keys(worksMap)) {
      const zone = worksMap[producer]?.[doc.name];
      const tier = worksTier[producer]?.[doc.name];
      if (
        zone &&
        doc.producerZone?.[producer] === zone &&
        (doc.producerZoneTier?.[producer] ?? null) === (tier ?? null)
      ) {
        unset[`producerZone.${producer}`] = "";
        unset[`producerZoneTier.${producer}`] = "";
        worksZonesReverted++;
      }
    }
    if (Object.keys(unset).length === 0) continue;
    if (APPLY) {
      await Location.updateOne({ _id: doc._id }, { $unset: unset });
    }
  }
  console.log(
    `  locations: ${depotMapsCleared} depot zone maps to clear; ${worksZonesReverted} works-zone fills to revert (only where unchanged since the load)`,
  );

  // ---- discount schemes ---------------------------------------------------------
  let ratesCleared = 0;
  for (const [producer, terms] of Object.entries<any>(discounts.producers)) {
    if (terms.cash_discount_depot === undefined) continue;
    const scheme = await DiscountScheme.findOne({ producer, effectiveDate: priceDate }).lean<any>();
    if (!scheme || scheme.cashDiscountDepot === undefined) continue;
    console.log(`  ${producer.padEnd(5)} depot cash discount ${scheme.cashDiscountDepot} to clear`);
    ratesCleared++;
    if (APPLY) {
      await DiscountScheme.updateOne({ producer, effectiveDate: priceDate }, { $unset: { cashDiscountDepot: "" } });
    }
  }

  if (removed === 0 && depotMapsCleared === 0 && worksZonesReverted === 0 && ratesCleared === 0) {
    console.log("\nNothing to roll back: no ex-depot data found for this round.");
  } else {
    console.log(
      `\n${APPLY ? "removed" : "would remove"} ${removed.toLocaleString("en-IN")} price entries, ` +
        `cleared ${depotMapsCleared} depot zone maps, reverted ${worksZonesReverted} works-zone fills, ` +
        `cleared ${ratesCleared} discount rates.`,
    );
    if (!APPLY) console.log("Restart the API afterwards — the dataset is cached per round.");
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
