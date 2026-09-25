/**
 * Test harness: build the engine's Dataset the way production does — through
 * `DatasetService` reading MongoDB — so the approved-workbook validation covers
 * the database path (seed, loaders, schema, DatasetService), not only the
 * staged JSON.
 *
 * Test use only, against mongodb-memory-server. `assertLocalConnection` exists
 * because backend/api/.env holds the production URI and `seed()` deletes
 * collections: nothing here runs unless mongoose is connected to localhost.
 */

import mongoose from "mongoose";

import type { Dataset } from "../core/pricing";
import { DatasetService } from "../modules/dataset/dataset.service";
import { GradeMappingSchema, LocationSchema, ProducerSchema } from "./schemas/catalog.schema";
import {
  DiscountSchemeSchema,
  FreightEntrySchema,
  PriceCircularSchema,
  PriceEntrySchema,
} from "./schemas/circular.schema";
import { PriceCorrectionSchema } from "./schemas/correction.schema";
import { DiscountTermsSchema } from "./schemas/discount-terms.schema";

export function assertLocalConnection(): void {
  const host = mongoose.connection.host;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing to run: mongoose is connected to ${host}, not a local in-memory server.`);
  }
}

const model = (name: string, schema: mongoose.Schema): mongoose.Model<any> =>
  mongoose.models[name] ?? mongoose.model(name, schema);

export async function loadDatasetFromDb(): Promise<Dataset> {
  assertLocalConnection();
  const service = new DatasetService(
    model("PriceCircular", PriceCircularSchema),
    model("PriceEntry", PriceEntrySchema),
    model("FreightEntry", FreightEntrySchema),
    model("DiscountScheme", DiscountSchemeSchema),
    model("Location", LocationSchema),
    model("GradeMapping", GradeMappingSchema),
    model("PriceCorrection", PriceCorrectionSchema),
    model("DiscountTerms", DiscountTermsSchema),
    model("Producer", ProducerSchema),
  );
  return service.load();
}
