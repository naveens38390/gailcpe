/**
 * Add the ex-depot price books to a round that is already loaded.
 *
 *   MONGODB_URI=... npm run load-depot            # reports what it would do, writes nothing
 *   MONGODB_URI=... npm run load-depot -- --apply # writes
 *
 * The seeder replaces a whole round and deletes collections before it inserts.
 * This does not: it only ever adds. It is what upgrades a database that is
 * already in service to carry the second price list.
 *
 *   - Ex-depot price entries are written for the round's existing circulars.
 *     Only rows tagged `ex_depot` are replaced, so running it twice is harmless
 *     and no ex-works price is touched.
 *   - Locations gain their depot zone maps. A works zone is filled in only where
 *     a location has none for that producer; an existing one, which may have been
 *     corrected by hand in the admin panel, is never overwritten.
 *   - Discount schemes gain the depot cash-discount rate where the source has one.
 *
 * ORDER MATTERS. An API build that predates the ex-depot list reads every price
 * entry of a round as an ordinary price, so depot rows would be merged into the
 * works prices — GAIL's Bhiwandi stock point over GAIL's Bhiwandi ex-works price.
 * Deploy the API that understands `basis: "ex_depot"` first, then run this.
 *
 * Reads a staged directory (GCPE_DATA) the same way the seeder does.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import { LocationSchema } from "./schemas/catalog.schema";
import {
  DiscountSchemeSchema,
  PriceCircularSchema,
  PriceEntrySchema,
} from "./schemas/circular.schema";

const DATA = process.env.GCPE_DATA ?? join(__dirname, "..", "..", "..", "data", "normalized");
const read = (name: string) => JSON.parse(readFileSync(join(DATA, `${name}.json`), "utf8"));
const APPLY = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required: this adds to a database that already holds a round.");
  await mongoose.connect(uri);
  console.log(`connected: ${uri.replace(/\/\/[^@]*@/, "//***@")}`);
  console.log(APPLY ? "mode: APPLY (writing)\n" : "mode: dry run (nothing is written; pass --apply)\n");

  const priceIndex = read("price_index");
  const discounts = read("discounts");
  const priceDate = new Date(priceIndex.effective_date);
  if (!priceIndex.depot) throw new Error(`${DATA}/price_index.json carries no ex-depot books.`);

  const PriceCircular = mongoose.model("PriceCircular", PriceCircularSchema);
  const PriceEntry = mongoose.model("PriceEntry", PriceEntrySchema);
  const Location = mongoose.model("Location", LocationSchema);
  const DiscountScheme = mongoose.model("DiscountScheme", DiscountSchemeSchema);

  // ---- price entries ---------------------------------------------------------
  let written = 0;
  for (const [producer, book] of Object.entries<any>(priceIndex.depot)) {
    const circular = await PriceCircular.findOne({
      producer,
      effectiveDate: priceDate,
      status: "active",
    }).lean();
    if (!circular) {
      console.log(`  ${producer.padEnd(5)} no active circular for ${priceIndex.effective_date} — skipped`);
      continue;
    }
    const rows: any[] = [];
    for (const [zone, cells] of Object.entries<any>(book.zones)) {
      for (const [grade, price] of Object.entries<any>(cells)) {
        rows.push({
          circular: circular._id,
          producer,
          effectiveDate: priceDate,
          zone,
          grade,
          price,
          basis: "ex_depot",
          supplyPoint: book.supply_point?.[zone]?.[grade],
        });
      }
    }
    const current = await PriceEntry.find(
      { producer, effectiveDate: priceDate, basis: "ex_depot" },
      { zone: 1, grade: 1, price: 1, supplyPoint: 1 },
    ).lean<any[]>();
    const fingerprint = (r: any) => `${r.zone}|${r.grade}|${r.price}|${r.supplyPoint ?? ""}`;
    const loaded = new Set(current.map(fingerprint));
    const identical =
      current.length === rows.length && loaded.size === rows.length && rows.every((r) => loaded.has(fingerprint(r)));
    if (identical) {
      // Same rows already there: writing them again would only churn ids and leave
      // a moment with no depot book, so leave them alone.
      console.log(`  ${producer.padEnd(5)} ${rows.length.toLocaleString("en-IN")} ex-depot prices — already loaded, unchanged`);
      continue;
    }
    console.log(`  ${producer.padEnd(5)} ${rows.length.toLocaleString("en-IN")} ex-depot prices (replacing ${current.length})`);
    if (APPLY) {
      await PriceEntry.deleteMany({ producer, effectiveDate: priceDate, basis: "ex_depot" });
      for (let i = 0; i < rows.length; i += 5000) {
        await PriceEntry.insertMany(rows.slice(i, i + 5000), { ordered: false });
      }
    }
    written += rows.length;
  }

  // ---- locations -------------------------------------------------------------
  const worksMap = priceIndex.location_map ?? {};
  const worksTier = priceIndex.location_tier ?? {};
  const depotMap = priceIndex.depot_location_map ?? {};
  const depotTier = priceIndex.depot_location_tier ?? {};
  let touched = 0;
  let filled = 0;
  const same = (a: unknown, b: unknown) => {
    const norm = (o: any) => JSON.stringify(Object.entries(o ?? {}).sort(([x], [y]) => x.localeCompare(y)));
    return norm(a) === norm(b);
  };
  for (const doc of await Location.find({}).lean<any[]>()) {
    const set: Record<string, unknown> = {};
    const depotZone: Record<string, string> = {};
    const depotZoneTier: Record<string, string> = {};
    for (const producer of Object.keys(depotMap)) {
      if (depotMap[producer]?.[doc.name]) {
        depotZone[producer] = depotMap[producer][doc.name];
        depotZoneTier[producer] = depotTier[producer]?.[doc.name];
      }
    }
    // A town with no depot carries no map at all, as after a fresh seed.
    const unset: Record<string, ""> = {};
    if (Object.keys(depotZone).length) {
      if (!same(doc.producerDepotZone, depotZone) || !same(doc.producerDepotZoneTier, depotZoneTier)) {
        set.producerDepotZone = depotZone;
        set.producerDepotZoneTier = depotZoneTier;
      }
    } else if (doc.producerDepotZone !== undefined || doc.producerDepotZoneTier !== undefined) {
      unset.producerDepotZone = "";
      unset.producerDepotZoneTier = "";
    }
    // Additive only: never replace a works zone that is already set.
    for (const producer of Object.keys(worksMap)) {
      const zone = worksMap[producer]?.[doc.name];
      if (zone && !doc.producerZone?.[producer]) {
        set[`producerZone.${producer}`] = zone;
        set[`producerZoneTier.${producer}`] = worksTier[producer]?.[doc.name];
        filled++;
      }
    }
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) continue;
    touched++;
    if (APPLY) {
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      await Location.updateOne({ _id: doc._id }, update);
    }
  }
  console.log(`  locations: ${touched} changed; ${filled} missing works zones filled in`);

  // ---- discount schemes ---------------------------------------------------------
  let rates = 0;
  for (const [producer, terms] of Object.entries<any>(discounts.producers)) {
    if (terms.cash_discount_depot === undefined) continue;
    const scheme = await DiscountScheme.findOne({ producer, effectiveDate: priceDate }).lean<any>();
    if (scheme && scheme.cashDiscountDepot === terms.cash_discount_depot) {
      console.log(`  ${producer.padEnd(5)} depot cash discount ${terms.cash_discount_depot} — already set, unchanged`);
      continue;
    }
    rates++;
    console.log(`  ${producer.padEnd(5)} depot cash discount ${terms.cash_discount_depot}`);
    if (APPLY) {
      await DiscountScheme.updateOne(
        { producer, effectiveDate: priceDate },
        { $set: { cashDiscountDepot: terms.cash_discount_depot } },
      );
    }
  }

  if (written === 0 && touched === 0 && rates === 0) {
    console.log("\nNothing to change: the ex-depot data is already loaded exactly as this file has it.");
  } else {
    console.log(
      `\n${APPLY ? "wrote" : "would write"} ${written.toLocaleString("en-IN")} price entries, ` +
        `${touched} locations changed, ${rates} discount rates.`,
    );
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
