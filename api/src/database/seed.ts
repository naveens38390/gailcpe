/**
 * Load the normalized dataset into MongoDB.
 *
 *   npm run seed                       # uses MONGODB_URI, or an ephemeral instance
 *   MONGODB_URI=mongodb+srv://... npm run seed
 *
 * Reads `data/normalized/*.json` — the output of `py -3 etl/build.py`, which is
 * where the 14 source circulars are actually parsed. This script only moves that
 * result into collections; it deliberately does no parsing of its own, so there
 * is exactly one place where a circular is interpreted.
 *
 * Re-running replaces the round it is loading and leaves earlier rounds alone.
 * Circulars accumulate by effective date rather than overwriting, because a
 * quote given last month has to stay defensible.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import {
  GradeMappingSchema,
  GradeSchema,
  LocationSchema,
  ProducerSchema,
} from "./schemas/catalog.schema";
import {
  DiscountSchemeSchema,
  FreightCircularSchema,
  FreightEntrySchema,
  PriceCircularSchema,
  PriceEntrySchema,
} from "./schemas/circular.schema";
import { RoleSchema, UserSchema } from "./schemas/activity.schema";

const DATA = join(__dirname, "..", "..", "..", "data", "normalized");
const read = (name: string) =>
  JSON.parse(readFileSync(join(DATA, `${name}.json`), "utf8"));

const PRODUCERS: Array<{ code: string; name: string; basis: string; isSelf?: boolean }> = [
  { code: "GAIL", name: "GAIL (India) Limited", basis: "ex_works", isSelf: true },
  { code: "RIL", name: "Reliance Industries Limited", basis: "delivered" },
  { code: "IOCL", name: "Indian Oil Corporation Limited", basis: "delivered" },
  { code: "HMEL", name: "HPCL-Mittal Energy Limited", basis: "ex_works" },
  { code: "OPaL", name: "ONGC Petro additions Limited", basis: "ex_works" },
  { code: "HPL", name: "Haldia Petrochemicals Limited", basis: "ex_works" },
];

const ROLE_SEED = [
  { key: "sales_officer", label: "Sales Officer", permissions: ["compare", "simulate"] },
  {
    key: "territory_manager",
    label: "Territory Manager",
    permissions: ["compare", "simulate", "propose_correction"],
  },
  {
    key: "regional_manager",
    label: "Regional Manager",
    permissions: ["compare", "simulate", "propose_correction", "view_region"],
  },
  {
    key: "corporate_pricing",
    label: "Corporate Pricing Team",
    permissions: [
      "compare",
      "simulate",
      "propose_correction",
      "approve_correction",
      "publish_circular",
    ],
  },
  { key: "admin", label: "Administrator", permissions: ["*"] },
];

async function connect(): Promise<{ uri: string; stop?: () => Promise<void> }> {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    await mongoose.connect(uri);
    return { uri };
  }
  // No Atlas URI: fall back to an ephemeral instance so the stack can be run
  // and verified locally. It is still MongoDB — same driver, same queries — it
  // just does not survive the process.
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri("gcpe"));
  return {
    uri: server.getUri("gcpe"),
    stop: async () => {
      await server.stop();
    },
  };
}

/**
 * @param connection the connection to seed. Defaults to the default mongoose
 * connection, which is what the standalone script opens. Nest owns its own
 * connection, so when this runs at boot it must be handed that one — models
 * registered on the default connection would buffer forever against a
 * connection that never opens.
 */
export async function seed(
  connection: mongoose.Connection = mongoose.connection,
): Promise<Record<string, number>> {
  const priceIndex = read("price_index");
  const freight = read("freight");
  const discounts = read("discounts");
  const crossref = read("crossref");
  const locations = read("locations");

  const priceDate = new Date(priceIndex.effective_date);
  const freightDate = new Date(freight.effective_date);

  // Reuse an already-registered model rather than redefining it: Nest has
  // registered these on its connection via MongooseModule.forFeature.
  // Deliberately untyped: a generic Model<T> here sends tsc into a very deep
  // instantiation of Mongoose's types and it runs out of heap. The seed writes
  // plain objects and gains nothing from the extra typing.
  const model = (name: string, schema: mongoose.Schema): mongoose.Model<any> =>
    connection.models[name] ?? connection.model(name, schema);

  const Producer = model("Producer", ProducerSchema);
  const Grade = model("Grade", GradeSchema);
  const GradeMapping = model("GradeMapping", GradeMappingSchema);
  const Location = model("Location", LocationSchema);
  const PriceCircular = model("PriceCircular", PriceCircularSchema);
  const PriceEntry = model("PriceEntry", PriceEntrySchema);
  const FreightCircular = model("FreightCircular", FreightCircularSchema);
  const FreightEntry = model("FreightEntry", FreightEntrySchema);
  const DiscountScheme = model("DiscountScheme", DiscountSchemeSchema);
  const Role = model("Role", RoleSchema);
  const User = model("User", UserSchema);

  const counts: Record<string, number> = {};

  await Producer.deleteMany({});
  await Producer.insertMany(PRODUCERS);
  counts.producers = PRODUCERS.length;

  await Role.deleteMany({});
  await Role.insertMany(ROLE_SEED);
  counts.roles = ROLE_SEED.length;

  // ---- grade mappings + grades -------------------------------------------
  const mappings = Object.values(crossref.index) as any[];
  await GradeMapping.deleteMany({});
  await GradeMapping.insertMany(
    mappings.map((m) => ({
      gailGrade: m.gail_grade,
      polymer: m.polymer,
      section: m.section,
      application: m.application,
      characteristic: m.characteristic,
      process: m.process,
      mfi: m.mfi,
      density: m.density,
      equivalents: m.equivalents,
      international: m.international,
      confidence: m.confidence,
      sourceReference: m.source,
    })),
  );
  counts.gradeMappings = mappings.length;

  // Every grade that appears in any circular, so Grade Finder can search the
  // competitor codes an officer is handed by a customer, not only GAIL's.
  const gradeDocs = new Map<string, any>();
  for (const [producer, payload] of Object.entries<any>(priceIndex.producers)) {
    for (const cells of Object.values<any>(payload.zones)) {
      for (const code of Object.keys(cells)) {
        gradeDocs.set(`${producer}|${code}`, { code, producer });
      }
    }
  }
  for (const m of mappings) {
    const existing = gradeDocs.get(`GAIL|${m.gail_grade}`) ?? {
      code: m.gail_grade,
      producer: "GAIL",
    };
    gradeDocs.set(`GAIL|${m.gail_grade}`, {
      ...existing,
      polymer: m.polymer,
      application: m.application,
      characteristic: m.characteristic,
      process: m.process,
      mfi: m.mfi,
      density: m.density,
    });
  }
  await Grade.deleteMany({});
  await Grade.insertMany([...gradeDocs.values()]);
  counts.grades = gradeDocs.size;

  // ---- locations ----------------------------------------------------------
  const canonical: string[] = locations.canonical;
  await Location.deleteMany({});
  await Location.insertMany(
    canonical.map((name) => ({
      name,
      producerZone: Object.fromEntries(
        Object.entries<any>(locations.coverage)
          .map(([producer, cov]) => [producer, cov.map?.[name]])
          .filter(([, zone]) => zone),
      ),
      producerZoneTier: Object.fromEntries(
        Object.entries<any>(locations.coverage)
          .map(([producer, cov]) => [producer, cov.tier_of?.[name]])
          .filter(([, tier]) => tier),
      ),
      freightDestination: Object.fromEntries(
        Object.entries<any>(freight.destination_map ?? {})
          .map(([producer, map]) => [producer, map?.[name]])
          .filter(([, dest]) => dest),
      ),
    })),
  );
  counts.locations = canonical.length;

  // ---- price circulars ----------------------------------------------------
  await PriceCircular.deleteMany({ effectiveDate: priceDate });
  await PriceEntry.deleteMany({ effectiveDate: priceDate });
  counts.priceEntries = 0;

  for (const [producer, payload] of Object.entries<any>(priceIndex.producers)) {
    const circular = await PriceCircular.create({
      producer,
      reference: `${producer} PE ${priceIndex.effective_date}`,
      effectiveDate: priceDate,
      status: "active",
      basis: payload.basis,
      stats: {
        zones: Object.keys(payload.zones).length,
        prices: Object.values<any>(payload.zones).reduce(
          (n, cells) => n + Object.keys(cells).length,
          0,
        ),
      },
    });

    const rows: any[] = [];
    for (const [zone, cells] of Object.entries<any>(payload.zones)) {
      for (const [grade, price] of Object.entries<any>(cells)) {
        rows.push({
          circular: circular._id,
          producer,
          effectiveDate: priceDate,
          zone,
          grade,
          price,
          basis: payload.basis,
          supplyPoint: payload.supply_point?.[zone]?.[grade],
        });
      }
    }
    // Batched: RIL alone contributes ~21,500 entries.
    for (let i = 0; i < rows.length; i += 5000) {
      await PriceEntry.insertMany(rows.slice(i, i + 5000), { ordered: false });
    }
    counts.priceEntries += rows.length;
  }

  // ---- freight circulars --------------------------------------------------
  await FreightCircular.deleteMany({ effectiveDate: freightDate });
  await FreightEntry.deleteMany({ effectiveDate: freightDate });
  counts.freightEntries = 0;

  for (const [producer, book] of Object.entries<any[]>(freight.books)) {
    const circular = await FreightCircular.create({
      producer,
      effectiveDate: freightDate,
      status: "active",
      stats: { destinations: book.length },
    });
    const rows = book.map((entry) => ({
      circular: circular._id,
      producer,
      effectiveDate: freightDate,
      destination: entry.destination,
      ratePerMt: entry.rate_per_mt,
      insurancePerMt: entry.insurance_per_mt ?? 0,
      state: entry.state,
      district: entry.district,
      cluster: entry.cluster,
      distanceKm: entry.distance_km,
      transitDays: entry.transit_days,
    }));
    for (let i = 0; i < rows.length; i += 5000) {
      await FreightEntry.insertMany(rows.slice(i, i + 5000), { ordered: false });
    }
    counts.freightEntries += rows.length;
  }

  // ---- discount schemes ---------------------------------------------------
  await DiscountScheme.deleteMany({ effectiveDate: priceDate });
  const schemes = Object.entries<any>(discounts.producers).map(([producer, t]) => ({
    producer,
    effectiveDate: priceDate,
    cashDiscount: t.cash_discount ?? undefined,
    cashDiscountLdpe: t.cash_discount_ldpe,
    cashDiscountSource: t.cash_discount_source,
    cashDiscountNote: t.cash_discount_note,
    earlyPaymentPerDay: t.early_payment_per_day ?? undefined,
    earlyPaymentMaxDays: t.early_payment_max_days,
    interestFreeCreditDays: t.interest_free_credit_days ?? undefined,
    dealerDiscount: t.dealer_discount,
    metalloceneQdCap: t.metallocene_qd_cap,
    quantitySlabs: t.quantity_slabs ?? null,
    quantitySlabsStatus: t.quantity_slabs_status,
  }));
  await DiscountScheme.insertMany(schemes);
  counts.discountSchemes = schemes.length;

  // ---- a starting account per role ---------------------------------------
  const existingUsers = await User.countDocuments();
  if (existingUsers === 0) {
    const password = process.env.SEED_PASSWORD ?? "ChangeMe#2026";
    const passwordHash = await bcrypt.hash(password, 10);
    await User.insertMany(
      ROLE_SEED.map((r) => ({
        email: `${r.key.replace(/_/g, ".")}@gail.example`,
        name: r.label,
        passwordHash,
        role: r.key,
      })),
    );
    counts.users = ROLE_SEED.length;
    console.log(
      `\nSeeded one account per role with password "${password}".` +
        " Set SEED_PASSWORD to choose your own, and change them before anyone else has the URL.",
    );
  }

  return counts;
}

async function main() {
  const { uri, stop } = await connect();
  console.log(`connected: ${uri.replace(/\/\/[^@]*@/, "//***@")}`);
  const counts = await seed();
  console.log("\nseeded:");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(16)} ${value.toLocaleString("en-IN")}`);
  }
  await mongoose.disconnect();
  if (stop) {
    await stop();
    console.log(
      "\nThis was an ephemeral instance — nothing persisted. Set MONGODB_URI to seed Atlas.",
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
