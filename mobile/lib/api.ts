/**
 * The only place this app talks to the backend.
 *
 * There is deliberately no pricing arithmetic anywhere in the mobile project.
 * Netback, freight, discounts and recommendations all come back computed from
 * NestJS, so a number on a phone and a number in a review meeting cannot drift
 * apart because two implementations disagreed.
 */

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "gcpe.accessToken";

/**
 * Where the API lives.
 *
 * On a physical phone `localhost` is the phone, not the dev machine — so derive
 * the machine's LAN address from the Expo dev server the app was loaded from.
 * EXPO_PUBLIC_API_URL overrides this for staging and production.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;
  const host = hostUri?.split(":")[0];
  if (host) return `http://${host}:3000/api`;

  return Platform.OS === "android"
    ? "http://10.0.2.2:3000/api" // Android emulator's alias for the host
    : "http://localhost:3000/api";
}

export const API_BASE_URL = resolveBaseUrl();

// SecureStore is unavailable on web; fall back so `expo start --web` still runs.
const memoryStore = new Map<string, string>();
const storage = {
  async get(key: string) {
    if (Platform.OS === "web") return memoryStore.get(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === "web") {
      memoryStore.set(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string) {
    if (Platform.OS === "web") {
      memoryStore.delete(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const tokenStore = {
  get: () => storage.get(TOKEN_KEY),
  set: (token: string) => storage.set(TOKEN_KEY, token),
  clear: () => storage.remove(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const token = auth ? await tokenStore.get() : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    // A dropped request is the normal case in the field, not an edge case.
    throw new ApiError(
      `Cannot reach the pricing service at ${API_BASE_URL}. Check the connection and try again.`,
      0,
    );
  }

  if (response.status === 401) {
    await tokenStore.clear();
    throw new ApiError("Your session has expired. Sign in again.", 401);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : (body?.message ?? `Request failed (${response.status}).`);
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<AuthUser>("/auth/me"),

  searchGrades: (q: string) =>
    request<GradeHit[]>(`/grades/search?q=${encodeURIComponent(q)}`),

  gradeDetail: (gailGrade: string) =>
    request<GradeDetail>(`/grades/${encodeURIComponent(gailGrade)}`),

  searchLocations: (q: string) =>
    request<LocationHit[]>(`/locations/search?q=${encodeURIComponent(q)}`),

  compare: (input: CompareInput) =>
    request<Comparison>("/pricing/compare", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  simulate: (input: SimulateInput) =>
    request<DealSimulation>("/deals/simulate", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  freight: (location: string) =>
    request<FreightView>(`/freight?location=${encodeURIComponent(location)}`),

  gailBook: () => request<GailBookRow[]>("/pricing/gail-book"),

  circulars: () => request<CircularList>("/circulars"),

  rounds: () => request<Round[]>("/circulars/rounds"),

  corrections: (status?: string) =>
    request<Correction[]>(
      `/corrections${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),

  proposeCorrection: (input: ProposeCorrectionInput) =>
    request<Correction>("/corrections", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  decideCorrection: (id: string, approve: boolean, note?: string) =>
    request<Correction>(`/corrections/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }),

  // ---- Producer master data ------------------------------------------------

  producers: () => request<ProducerRecord[]>("/producers"),

  producerPending: () => request<Revision[]>("/producers/revisions/pending"),

  producerHistory: (code: string) =>
    request<Revision[]>(`/producers/${encodeURIComponent(code)}/history`),

  createProducer: (input: CreateProducerInput) =>
    request<Revision>("/producers", { method: "POST", body: JSON.stringify(input) }),

  draftProducer: (code: string, input: DraftProducerInput) =>
    request<Revision>(`/producers/${encodeURIComponent(code)}/draft`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  submitProducerRevision: (id: string) =>
    request<Revision>(`/producers/revisions/${encodeURIComponent(id)}/submit`, { method: "POST" }),

  reviewProducerRevision: (id: string, approve: boolean, note?: string) =>
    request<Revision>(`/producers/revisions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }),

  publishProducerRevision: (id: string) =>
    request<Revision>(`/producers/revisions/${encodeURIComponent(id)}/publish`, { method: "POST" }),

  rollbackProducer: (code: string, toVersion: number, reason: string) =>
    request<Revision>(`/producers/${encodeURIComponent(code)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ toVersion, reason }),
    }),

  producerDiff: (code: string, from: number, to: number) =>
    request<DiffResult>(`/producers/${encodeURIComponent(code)}/diff?from=${from}&to=${to}`),

  // ---- Location master data --------------------------------------------

  locationPending: () => request<Revision[]>("/locations/revisions/pending"),

  locationHistory: (name: string) =>
    request<Revision[]>(`/locations/${encodeURIComponent(name)}/history`),

  createLocation: (input: CreateLocationInput) =>
    request<Revision>("/locations", { method: "POST", body: JSON.stringify(input) }),

  draftLocation: (name: string, input: DraftLocationInput) =>
    request<Revision>(`/locations/${encodeURIComponent(name)}/draft`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  submitLocationRevision: (id: string) =>
    request<Revision>(`/locations/revisions/${encodeURIComponent(id)}/submit`, { method: "POST" }),

  reviewLocationRevision: (id: string, approve: boolean, note?: string) =>
    request<Revision>(`/locations/revisions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }),

  publishLocationRevision: (id: string) =>
    request<Revision>(`/locations/revisions/${encodeURIComponent(id)}/publish`, { method: "POST" }),

  rollbackLocation: (name: string, toVersion: number, reason: string) =>
    request<Revision>(`/locations/${encodeURIComponent(name)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ toVersion, reason }),
    }),

  locationDiff: (name: string, from: number, to: number) =>
    request<DiffResult>(`/locations/${encodeURIComponent(name)}/diff?from=${from}&to=${to}`),

  // ---- Grade master data -------------------------------------------------

  gradePending: () => request<Revision[]>("/grades/revisions/pending"),

  gradeHistory: (gailGrade: string) =>
    request<Revision[]>(`/grades/${encodeURIComponent(gailGrade)}/history`),

  gradeImpact: (gailGrade: string) =>
    request<GradeImpact>(`/grades/${encodeURIComponent(gailGrade)}/impact`),

  createGrade: (input: CreateGradeInput) =>
    request<Revision>("/grades", { method: "POST", body: JSON.stringify(input) }),

  draftGrade: (gailGrade: string, input: DraftGradeInput) =>
    request<Revision>(`/grades/${encodeURIComponent(gailGrade)}/draft`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  submitGradeRevision: (id: string) =>
    request<Revision>(`/grades/revisions/${encodeURIComponent(id)}/submit`, { method: "POST" }),

  reviewGradeRevision: (id: string, approve: boolean, note?: string) =>
    request<Revision>(`/grades/revisions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }),

  publishGradeRevision: (id: string) =>
    request<Revision>(`/grades/revisions/${encodeURIComponent(id)}/publish`, { method: "POST" }),

  rollbackGrade: (gailGrade: string, toVersion: number, reason: string) =>
    request<Revision>(`/grades/${encodeURIComponent(gailGrade)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ toVersion, reason }),
    }),

  gradeDiff: (gailGrade: string, from: number, to: number) =>
    request<DiffResult>(`/grades/${encodeURIComponent(gailGrade)}/diff?from=${from}&to=${to}`),

  // ---- Discount terms master data ----------------------------------------

  discountTerms: () => request<DiscountTermsRecord[]>("/discounts"),

  discountPending: () => request<Revision[]>("/discounts/revisions/pending"),

  discountHistory: (producer: string) =>
    request<Revision[]>(`/discounts/${encodeURIComponent(producer)}/history`),

  discountImpact: (producer: string) =>
    request<DiscountImpact>(`/discounts/${encodeURIComponent(producer)}/impact`),

  createDiscountTerms: (input: CreateDiscountTermsInput) =>
    request<Revision>("/discounts", { method: "POST", body: JSON.stringify(input) }),

  draftDiscountTerms: (producer: string, input: DraftDiscountTermsInput) =>
    request<Revision>(`/discounts/${encodeURIComponent(producer)}/draft`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  submitDiscountRevision: (id: string) =>
    request<Revision>(`/discounts/revisions/${encodeURIComponent(id)}/submit`, { method: "POST" }),

  reviewDiscountRevision: (id: string, approve: boolean, note?: string) =>
    request<Revision>(`/discounts/revisions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }),

  publishDiscountRevision: (id: string) =>
    request<Revision>(`/discounts/revisions/${encodeURIComponent(id)}/publish`, { method: "POST" }),

  rollbackDiscountTerms: (producer: string, toVersion: number, reason: string) =>
    request<Revision>(`/discounts/${encodeURIComponent(producer)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ toVersion, reason }),
    }),

  discountDiff: (producer: string, from: number, to: number) =>
    request<DiffResult>(`/discounts/${encodeURIComponent(producer)}/diff?from=${from}&to=${to}`),

  // ---- Price Circular Management ------------------------------------------

  priceCirculars: (status?: string) =>
    request<PriceCircularDraft[]>(
      `/price-circulars${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),

  priceCircularDetail: (id: string) =>
    request<PriceCircularDraft>(`/price-circulars/${encodeURIComponent(id)}`),

  priceCircularRows: (id: string) =>
    request<PriceCircularRow[]>(`/price-circulars/${encodeURIComponent(id)}/rows`),

  priceCircularRowDiff: (id: string) =>
    request<PriceCircularRowDiff>(`/price-circulars/${encodeURIComponent(id)}/diff`),

  createPriceCircular: (input: CreatePriceCircularInput) =>
    request<PriceCircularDraft>("/price-circulars", { method: "POST", body: JSON.stringify(input) }),

  updatePriceCircularRow: (draftId: string, rowId: string, basicPrice: number) =>
    request<PriceCircularRow>(
      `/price-circulars/${encodeURIComponent(draftId)}/rows/${encodeURIComponent(rowId)}`,
      { method: "POST", body: JSON.stringify({ basicPrice }) },
    ),

  bulkUpdatePriceCircularRows: (
    draftId: string,
    rowIds: string[],
    type: "set" | "delta" | "percent",
    value: number,
  ) =>
    request<{ updated: number }>(`/price-circulars/${encodeURIComponent(draftId)}/rows/bulk`, {
      method: "POST",
      body: JSON.stringify({ rowIds, type, value }),
    }),

  submitPriceCircular: (id: string) =>
    request<PriceCircularDraft>(`/price-circulars/${encodeURIComponent(id)}/submit`, { method: "POST" }),

  reviewPriceCircular: (id: string, approve: boolean, note?: string) =>
    request<PriceCircularDraft>(`/price-circulars/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }),

  publishPriceCircular: (id: string) =>
    request<{ draft: PriceCircularDraft; circular: Record<string, unknown> }>(
      `/price-circulars/${encodeURIComponent(id)}/publish`,
      { method: "POST" },
    ),

  rollbackPriceCircular: (circularId: string, reason: string) =>
    request<{ circular: Record<string, unknown> }>("/price-circulars/rollback", {
      method: "POST",
      body: JSON.stringify({ circularId, reason }),
    }),
};

// ---------------------------------------------------------------------------
// Response shapes — mirrors of the API's, kept narrow to what screens render.
// ---------------------------------------------------------------------------

export type PaymentMode = "cash" | "credit_ifc";

export type LocationTier =
  | "exact"
  | "alias"
  | "evidence"
  | "published_map"
  | "inferred_via_hpl"
  | "unresolved";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser & { territories: string[] };
}

export type GradeStatus = "active" | "deprecated" | "retired";

export interface GradeHit {
  gailGrade: string;
  polymer?: string;
  application?: string;
  characteristic?: string;
  confidence?: string;
  status?: GradeStatus;
  matchedVia: string;
}

export interface GradeDetail {
  gailGrade: string;
  polymer?: string;
  application?: string;
  characteristic?: string;
  process?: string;
  mfi?: string;
  density?: string;
  confidence?: string;
  status?: GradeStatus;
  international: string[];
  equivalents: Array<{
    producer: string;
    codes: Array<{ code: string; inCurrentCircular: boolean }>;
  }>;
  caveat: string | null;
}

export interface LocationHit {
  name: string;
  sapCode?: string;
  competitorsPriced: number;
  inferredZones: number;
  producerZone?: Record<string, string>;
  producerZoneTier?: Record<string, string>;
}

export interface CompareInput {
  grade: string;
  location: string;
  quantityMt: number;
  paymentMode: PaymentMode;
}

export interface SimulateInput extends CompareInput {
  customer?: string;
}

export interface Quote {
  producer: string;
  grade: string | null;
  basis: string | null;
  basic: number | null;
  cashDiscount: number;
  freight: number | null;
  insurance: number;
  invoiceLanded: number | null;
  quantityDiscount: number;
  effectiveNet: number | null;
  zone: string | null;
  locationTier: LocationTier;
  gaps: string[];
  mappingConfidence: string | null;
}

export interface Comparison {
  grade: string;
  location: string;
  quantityMt: number;
  paymentMode: PaymentMode;
  quotes: Quote[];
  leader: Quote | null;
  gail: Quote | null;
  gapToLeader: number | null;
  gailRank: number | null;
  warnings: string[];
  effectiveDate: string;
  freightDate: string;
}

export interface DealOption {
  label: string;
  correctionPerMt: number;
  gailLanded: number;
  gapAfter: number;
  outcome: "leading" | "matched" | "behind" | "not_priced";
  totalCost: number;
  recommended: boolean;
}

export interface DealSimulation {
  id: string;
  customer: string | null;
  grade: string;
  location: string;
  quantityMt: number;
  comparison: Comparison;
  outcome: "leading" | "matched" | "behind" | "not_priced";
  options: DealOption[];
  narrative: string[];
  dataConfidence: "high" | "medium" | "low";
  dataCaveats: string[];
  effectiveDate: string;
}

export interface FreightView {
  location: string;
  effectiveDate: string;
  rows: Array<{
    producer: string;
    basis: string | null;
    destination: string | null;
    ratePerMt: number | null;
    insurancePerMt: number;
    published: boolean;
  }>;
  cheapest: string | null;
  notes: string[];
}

export interface CircularList {
  price: Array<Record<string, unknown>>;
  freight: Array<Record<string, unknown>>;
}

export interface Round {
  effectiveDate: string;
  producers: string[];
}

export interface GailBookRow {
  zone: string;
  grade: string;
  price: number;
}

export type CorrectionStatus = "pending" | "approved" | "rejected" | "applied";

export interface CorrectionActor {
  _id: string;
  name: string;
  email: string;
  role: string;
}

export interface Correction {
  _id: string;
  producer: string;
  zone: string;
  grade: string;
  currentPrice: number;
  proposedPrice: number;
  reason: string;
  proposedBy: CorrectionActor | string;
  status: CorrectionStatus;
  decidedBy?: CorrectionActor | string;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
}

export interface ProposeCorrectionInput {
  grade: string;
  location: string;
  proposedPrice: number;
  reason: string;
}

export interface QuantitySlab {
  from_mt: number;
  to_mt: number | null;
  rate_per_mt: number;
}

export interface DiscountTermsRecord {
  producer: string;
  cashDiscount?: number;
  cashDiscountLdpe?: number;
  earlyPaymentPerDay?: number;
  earlyPaymentMaxDays?: number;
  interestFreeCreditDays?: number;
  dealerDiscount?: number;
  metalloceneQdCap?: number;
  quantitySlabs?: QuantitySlab[] | null;
  effectiveFrom?: string;
  currentVersion: number;
}

export interface DiscountImpact {
  producer: string;
  windowDays: number;
  comparisons: number;
  simulations: number;
  locations: string[];
}

export interface CreateDiscountTermsInput {
  producer: string;
  cashDiscount?: number;
  cashDiscountLdpe?: number;
  earlyPaymentPerDay?: number;
  earlyPaymentMaxDays?: number;
  interestFreeCreditDays?: number;
  dealerDiscount?: number;
  metalloceneQdCap?: number;
  quantitySlabs?: QuantitySlab[];
  reason: string;
  submit?: boolean;
}

export interface DraftDiscountTermsInput {
  cashDiscount?: number;
  cashDiscountLdpe?: number;
  earlyPaymentPerDay?: number;
  earlyPaymentMaxDays?: number;
  interestFreeCreditDays?: number;
  dealerDiscount?: number;
  metalloceneQdCap?: number;
  quantitySlabs?: QuantitySlab[];
  reason: string;
  submit?: boolean;
}

export type RevisionStatus = "draft" | "review" | "approved" | "published" | "rejected" | "superseded";

export interface DiffResult {
  entityId: string;
  fromVersion: number;
  toVersion: number;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}

export type DraftStatus = "draft" | "review" | "approved" | "published" | "rejected";

export interface PriceCircularDraft {
  _id: string;
  producer: string;
  circularNumber: string;
  effectiveDate: string;
  basis: string;
  status: DraftStatus;
  reason: string;
  rowCount: number;
  changedRowCount: number;
  createdBy: CorrectionActor | string;
  submittedAt?: string;
  reviewedBy?: CorrectionActor | string;
  reviewedAt?: string;
  reviewNote?: string;
  publishedBy?: CorrectionActor | string;
  publishedAt?: string;
  publishedCircular?: string;
  createdAt: string;
}

export interface PriceCircularRow {
  _id: string;
  draft: string;
  zone: string;
  grade: string;
  basicPrice: number;
  previousPrice: number;
  changed: boolean;
}

export interface PriceCircularRowDiff {
  draftId: string;
  changedRowCount: number;
  changes: Array<{ zone: string; grade: string; from: number; to: number; delta: number }>;
}

export interface CreatePriceCircularInput {
  producer?: string;
  circularNumber: string;
  effectiveDate: string;
  reason: string;
}

export interface ProducerRecord {
  code: string;
  name: string;
  basis: string;
  isSelf: boolean;
  active: boolean;
  currentVersion: number;
}

export interface Revision {
  _id: string;
  entityId: string;
  createsNew: boolean;
  fields: Record<string, unknown>;
  baseline: Record<string, unknown> | null;
  version: number;
  status: RevisionStatus;
  reason: string;
  createdBy: CorrectionActor | string;
  submittedAt?: string;
  reviewedBy?: CorrectionActor | string;
  reviewedAt?: string;
  reviewNote?: string;
  publishedBy?: CorrectionActor | string;
  publishedAt?: string;
  createdAt: string;
}

export interface CreateProducerInput {
  code: string;
  name: string;
  basis: string;
  isSelf?: boolean;
  active?: boolean;
  reason: string;
  submit?: boolean;
}

export interface DraftProducerInput {
  name?: string;
  basis?: string;
  isSelf?: boolean;
  active?: boolean;
  reason: string;
  submit?: boolean;
}

/** A value of null deletes that producer's entry rather than setting it. */
export type ZoneMapPatch = Record<string, string | null>;

export interface CreateLocationInput {
  name: string;
  sapCode?: string;
  producerZone?: ZoneMapPatch;
  producerZoneTier?: ZoneMapPatch;
  freightDestination?: ZoneMapPatch;
  reason: string;
  submit?: boolean;
}

export interface DraftLocationInput {
  sapCode?: string;
  producerZone?: ZoneMapPatch;
  producerZoneTier?: ZoneMapPatch;
  freightDestination?: ZoneMapPatch;
  reason: string;
  submit?: boolean;
}

/** A producer set to null removes its whole equivalents list rather than setting it. */
export type EquivalentsPatch = Record<string, string[] | null>;

export interface GradeImpact {
  windowDays: number;
  comparisons: number;
  simulations: number;
  locations: string[];
}

export interface CreateGradeInput {
  gailGrade: string;
  polymer?: string;
  section?: string;
  application?: string;
  characteristic?: string;
  process?: string;
  mfi?: string;
  density?: string;
  confidence?: "H" | "M" | "L";
  status?: GradeStatus;
  equivalents?: EquivalentsPatch;
  international?: string[];
  reason: string;
  submit?: boolean;
}

export interface DraftGradeInput {
  polymer?: string;
  section?: string;
  application?: string;
  characteristic?: string;
  process?: string;
  mfi?: string;
  density?: string;
  confidence?: "H" | "M" | "L";
  status?: GradeStatus;
  equivalents?: EquivalentsPatch;
  international?: string[];
  reason: string;
  submit?: boolean;
}
