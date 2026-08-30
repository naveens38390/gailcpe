/**
 * The only place this app talks to the backend.
 *
 * There is deliberately no pricing arithmetic anywhere in the mobile project.
 * Netback, freight, discounts and recommendations all come back computed from
 * NestJS, so a number on a phone and a number in a review meeting cannot drift
 * apart because two implementations disagreed.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

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

/**
 * The single account.
 *
 * This app has one administrator and no sign-in screen: the client presents
 * these credentials itself the first time it needs the API, and every screen
 * runs with full access. Override either value with an EXPO_PUBLIC_ADMIN_*
 * environment variable to point a build at a different account.
 */
export const ADMIN_EMAIL =
  process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? "jainam@gmail.com";
const ADMIN_PASSWORD =
  process.env.EXPO_PUBLIC_ADMIN_PASSWORD ?? "passABC@123";

// The token lives in memory for the life of the process. There is nothing to
// persist and nothing to clear: a relaunch simply signs in again.
let accessToken: string | null = null;
let currentUser: AuthUser | null = null;
let signingIn: Promise<AuthUser> | null = null;

async function signIn(): Promise<AuthUser> {
  const result = await request<LoginResponse>("/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  accessToken = result.accessToken;
  currentUser = result.user;
  return result.user;
}

/**
 * Guarantees a usable token before a call goes out. Concurrent callers on a
 * cold start share one sign-in rather than racing five of them.
 */
export function ensureSession(): Promise<AuthUser> {
  if (accessToken && currentUser) return Promise.resolve(currentUser);
  if (!signingIn) {
    signingIn = signIn().finally(() => {
      signingIn = null;
    });
  }
  return signingIn;
}

/** The Authorization header for the one place that fetches outside `request`. */
export async function authHeader(): Promise<Record<string, string>> {
  await ensureSession();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * How long one attempt may run, and how long to wait before repeating it.
 *
 * The API is hosted on an instance that sleeps when idle. A measured cold
 * start is about 43 seconds; a warm call is under half a second. Two things
 * followed from having no timeout at all: a sleeping backend left a screen
 * spinning with nothing to report, and on Android the platform's own socket
 * timeout fires first and fails the call outright — which is why the first
 * open of the day so often needed a second try.
 *
 * Four attempts spread over these delays outlast a cold start, while no
 * single attempt hangs long enough to look like a dead screen.
 */
const ATTEMPT_TIMEOUT_MS = 25_000;
const RETRY_DELAYS_MS = [500, 2_000, 5_000];

/** Statuses that mean the request never reached the application. */
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether a failed call can be repeated safely.
 *
 * A dropped POST may well have reached the server and been applied, so
 * replaying it risks a second price correction from one tap. Reads carry no
 * such risk. Login is the deliberate exception: repeating it costs nothing
 * but an audit row, and it is the first call the app makes — if it cannot
 * survive a cold start, nothing else ever gets a token.
 */
function isReplayable(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return true;
  return verb === "POST" && path === "/auth/login";
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { auth = true, retry = true, headers, ...rest } = init;
  if (auth) await ensureSession();
  const token = auth ? accessToken : null;

  const method = (rest.method ?? "GET").toString();
  const attempts = retry && isReplayable(method, path) ? RETRY_DELAYS_MS.length + 1 : 1;

  let response: Response | null = null;
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await delay(RETRY_DELAYS_MS[attempt - 1]!);

    // Without this the request inherits the platform's own timeout, which on
    // Android is shorter than a cold start and on web is effectively never.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      });
    } catch {
      // A dropped request is the normal case in the field, not an edge case:
      // a lost connection, or this attempt outrunning its own timeout.
      response = null;
      lastError = new ApiError(
        `Cannot reach the pricing service at ${API_BASE_URL}. Check the connection and try again.`,
        0,
      );
      continue;
    } finally {
      clearTimeout(timer);
    }

    // The gateway answered but the application did not, so nothing was acted
    // on and the call can be repeated.
    if (TRANSIENT_STATUS.has(response.status) && attempt < attempts - 1) {
      lastError = new ApiError("The pricing service is still starting up.", response.status);
      response = null;
      continue;
    }
    break;
  }

  if (!response) {
    throw (
      lastError ??
      new ApiError(`Cannot reach the pricing service at ${API_BASE_URL}.`, 0)
    );
  }

  if (response.status === 401) {
    // The token expired mid-session. Nobody should have to notice, so sign in
    // again and replay the call once.
    accessToken = null;
    currentUser = null;
    if (auth && retry) {
      await ensureSession();
      return request<T>(path, { ...init, retry: false });
    }
    throw new ApiError("The pricing service rejected this session.", 401);
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

/**
 * Send a file.
 *
 * Kept apart from `request` for two reasons. The multipart boundary has to be
 * chosen by the platform, so setting Content-Type here produces a body the
 * server cannot parse. And an upload is never replayed: it creates a record,
 * and a dropped one may well have arrived — the same rule that keeps a
 * correction from being submitted twice.
 *
 * The timeout is generous because these carry whole circulars, and the server
 * reads a 16,000-row extract before it answers.
 */
async function upload<T>(path: string, form: FormData, timeoutMs = 120_000): Promise<T> {
  await ensureSession();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  } catch {
    throw new ApiError(
      "The upload did not complete. Check the connection and try again — nothing was saved.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : (body?.message ?? `Upload failed (${response.status}).`);
    throw new ApiError(message, response.status);
  }
  return body as T;
}

/** Builds a query string from a params object, dropping undefined/empty values. */
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  me: () => request<AuthUser>("/auth/me"),

  /**
   * Check a set of credentials without disturbing the session.
   *
   * The app's own token is left alone — this asks the API whether these
   * details are valid, which is what gates the Admin Panel. Returns the
   * account on success and throws ApiError(401) on a bad password.
   */
  verifyCredentials: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      retry: false,
      body: JSON.stringify({ email, password }),
    }),

  /** Every selectable value, straight from the published circular round. */
  catalog: () => request<Catalog>("/catalog"),

  /** Which locations and producers can actually price one grade. */
  gradeAvailability: (gailGrade: string) =>
    request<GradeAvailability>(
      `/catalog/grades/${encodeURIComponent(gailGrade)}/availability`,
    ),

  /**
   * Every grade serving the same application as this one. Pass a location and
   * each comes back with GAIL's price there, which is what the choice between
   * them turns on.
   */
  gradeVariants: (gailGrade: string, location?: string) =>
    request<ProductVariants>(
      `/catalog/grades/${encodeURIComponent(gailGrade)}/variants` +
        (location ? `?location=${encodeURIComponent(location)}` : ""),
    ),

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

  circulars: (kind?: "price" | "freight") =>
    request<CircularList>(`/circulars${kind ? `?kind=${kind}` : ""}`),

  /** File a circular document against a producer and round. */
  uploadCircular: (form: FormData) => upload<UploadedCircular>("/circulars/upload", form),

  /**
   * Read the circular's own reference out of the document, to prefill the
   * form. Advisory only — a miss leaves the field blank and typeable.
   */
  detectCircularReference: (form: FormData) =>
    upload<DetectedReference>("/circulars/detect-reference", form, 60_000),

  /** Attach its extracted reading, which generates the draft to review. */
  attachCircularExtract: (id: string, form: FormData) =>
    upload<CircularExtractResult>(`/circulars/${encodeURIComponent(id)}/extract`, form),

  /** Where the stored source document can be opened from. */
  circularSourceUrl: (id: string) =>
    `${API_BASE_URL}/circulars/${encodeURIComponent(id)}/source`,

  /** Everything that changed, grouped by the day it changed. */
  timeline: (params: { from?: string; to?: string; limit?: number } = {}) =>
    request<Timeline>(`/timeline${qs(params)}`),

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

  correctionSummary: () => request<CorrectionSummary>("/corrections/summary"),

  // ---- Dashboard --------------------------------------------------------

  dashboard: () => request<DashboardResponse>("/admin/dashboard"),

  // ---- Audit Log ----------------------------------------------------------

  auditLogs: (params: AuditLogQuery = {}) =>
    request<AuditLogListResponse>(`/audit-logs${qs({ ...params })}`),

  correctionDetail: (id: string) =>
    request<Correction>(`/corrections/${encodeURIComponent(id)}`),

  requestCorrectionChanges: (id: string, note: string) =>
    request<Correction>(`/corrections/${encodeURIComponent(id)}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  // ---- Notifications --------------------------------------------------------

  notifications: (params: NotificationQuery = {}) =>
    request<NotificationListResponse>(
      `/notifications${qs({
        unread: params.unreadOnly,
        type: params.type,
        q: params.q,
        page: params.page,
        limit: params.limit,
      })}`,
    ),

  unreadNotificationCount: () => request<{ count: number }>("/notifications/unread-count"),

  markNotificationRead: (id: string) =>
    request<AppNotification>(`/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
    }),

  markAllNotificationsRead: () =>
    request<{ acknowledged: boolean }>("/notifications/read-all", { method: "POST" }),

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

  // ---- Freight Circular Management -----------------------------------------

  freightCirculars: (status?: string) =>
    request<FreightCircularDraft[]>(
      `/freight-circulars${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),

  freightCircularProducers: () =>
    request<Array<{ producer: string; destinations: number }>>(
      "/freight-circulars/producers",
    ),

  freightCircularDetail: (id: string) =>
    request<FreightCircularDraft>(`/freight-circulars/${encodeURIComponent(id)}`),

  freightCircularRows: (id: string) =>
    request<FreightCircularRow[]>(`/freight-circulars/${encodeURIComponent(id)}/rows`),

  freightCircularDiff: (id: string) =>
    request<FreightCircularDiff>(`/freight-circulars/${encodeURIComponent(id)}/diff`),

  createFreightCircular: (input: CreateFreightCircularInput) =>
    request<FreightCircularDraft>("/freight-circulars", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateFreightCircularRow: (
    draftId: string,
    rowId: string,
    ratePerMt: number,
    insurancePerMt?: number,
  ) =>
    request<FreightCircularRow>(
      `/freight-circulars/${encodeURIComponent(draftId)}/rows/${encodeURIComponent(rowId)}`,
      { method: "POST", body: JSON.stringify({ ratePerMt, insurancePerMt }) },
    ),

  bulkUpdateFreightCircularRows: (
    draftId: string,
    rowIds: string[],
    type: "set" | "delta" | "percent",
    value: number,
  ) =>
    request<{ updated: number }>(
      `/freight-circulars/${encodeURIComponent(draftId)}/rows/bulk`,
      { method: "POST", body: JSON.stringify({ rowIds, type, value }) },
    ),

  submitFreightCircular: (id: string) =>
    request<FreightCircularDraft>(`/freight-circulars/${encodeURIComponent(id)}/submit`, {
      method: "POST",
    }),

  /** `acknowledgeUnmapped` is required to approve a draft carrying unmapped
   * destinations — the API refuses the approval without it. */
  reviewFreightCircular: (
    id: string,
    approve: boolean,
    note?: string,
    acknowledgeUnmapped?: boolean,
  ) =>
    request<FreightCircularDraft>(`/freight-circulars/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ approve, note, acknowledgeUnmapped }),
    }),

  publishFreightCircular: (id: string) =>
    request<{ draft: FreightCircularDraft; circular: Record<string, unknown> }>(
      `/freight-circulars/${encodeURIComponent(id)}/publish`,
      { method: "POST" },
    ),

  rollbackFreightCircular: (producer: string, circularId: string, reason: string) =>
    request<{ circular: Record<string, unknown> }>("/freight-circulars/rollback", {
      method: "POST",
      body: JSON.stringify({ producer, circularId, reason }),
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

/** How much of an answer a grade can produce, given what the circulars hold. */
export type GradeAvailabilityKind = "comparable" | "gail_only" | "no_gail_price";

export interface CatalogGrade {
  gailGrade: string;
  polymer: string;
  section: string;
  application: string;
  characteristic: string;
  mfi?: string;
  density?: string;
  confidence?: string;
  status?: string;
  availability: GradeAvailabilityKind;
  competitors: string[];
  locationCount: number;
}

export interface CatalogLocation {
  name: string;
  sapCode?: string;
  producers: string[];
}

export interface CatalogProducer {
  code: string;
  name: string;
  basis: string;
  isSelf: boolean;
}

export interface Catalog {
  effectiveDate: string;
  producers: CatalogProducer[];
  grades: CatalogGrade[];
  locations: CatalogLocation[];
}

export interface GradeAvailability {
  grade: string;
  known: boolean;
  locations: Array<{ name: string; producers: string[]; gailPriced: boolean }>;
  producers: string[];
}

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

export type TimelineKind =
  | "circular_published"
  | "circular_filed"
  | "master_data"
  | "correction";

/** One thing that happened, whatever kind of thing it was. */
export interface TimelineEntry {
  kind: TimelineKind;
  at: string;
  by: string;
  title: string;
  detail?: string;
  /** The circular this traces back to, where one exists. */
  source?: string;
  changes?: Array<{ field: string; from: unknown; to: unknown }>;
  link?: { kind: "draft" | "freight_draft" | "circular" | "correction"; id: string };
}

export interface Timeline {
  total: number;
  shown: number;
  days: Array<{ date: string; entries: TimelineEntry[] }>;
}

/** The circular's own reference, read out of the document it was filed from. */
export interface DetectedReference {
  reference: string | null;
  method: "labelled" | "bare" | "none";
  /** The line it was read from, so a wrong guess can be understood. */
  context?: string;
}

/** What comes back when a circular document is filed. */
export interface UploadedCircular {
  id: string;
  kind: "price" | "freight";
  producer: string;
  reference: string;
  effectiveDate: string;
  sourceFilename: string | null;
  bytes: number;
  documentType: string;
  status: string;
}

/** What comes back when its extracted reading is attached. */
export interface CircularExtractResult {
  circularId: string;
  draftId: string;
  producer: string;
  reference: string;
  effectiveDate: string;
  rowCount: number;
  changedRowCount: number;
  addedCount: number;
  added: string[];
  /** Live rows the extract never mentioned — a partial or half-read circular. */
  removedCount: number;
  removed: string[];
  status: string;
  /** Freight readings only: destinations no location maps to. */
  kind?: "freight";
  unmappedCount?: number;
  unmapped?: string[];
  ambiguousCount?: number;
  ambiguous?: string[];
}

export type GradeStatus = "active" | "deprecated" | "retired";

/** One of the grades that can answer a given customer requirement. */
export interface GradeVariant {
  gailGrade: string;
  polymer: string;
  /** Full text, additive marker included — "General purpose, <5L (NA additive)". */
  characteristic: string;
  process?: string;
  mfi?: string;
  density?: string;
  confidence?: string;
  status?: GradeStatus;
  availability: GradeAvailabilityKind;
  competitors: string[];
  /** GAIL's basic price at the requested location; null when not priced there. */
  gailPrice: number | null;
  /** The code GAIL's book publishes it under — B52A003 is listed as B52A003A. */
  pricedAs: string | null;
}

export interface ProductVariants {
  product: { section: string; application: string; characteristic: string };
  location: string | null;
  selected: string;
  variants: GradeVariant[];
}

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

/** One circular as filed, whether or not it has been read yet. */
export interface CircularRecord extends Record<string, unknown> {
  _id: string;
  kind: "price" | "freight";
  producer: string;
  reference?: string;
  effectiveDate: string;
  status: string;
  sourceFilename?: string;
  uploadedAt?: string;
  extractedAt?: string;
  /** The draft its extract generated, once one exists. */
  draft?: string;
}

export interface CircularList {
  price: CircularRecord[];
  freight: CircularRecord[];
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

export type CorrectionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "changes_requested";

export interface CorrectionActor {
  _id: string;
  name: string;
  email: string;
  role: string;
}

export interface CorrectionEvent {
  type: "proposed" | "approved" | "rejected" | "changes_requested";
  by: CorrectionActor | string | null;
  at: string;
  note?: string;
}

export interface Correction {
  _id: string;
  producer: string;
  zone: string;
  grade: string;
  currentPrice: number;
  proposedPrice: number;
  reason: string;
  proposedBy: CorrectionActor | string | null;
  status: CorrectionStatus;
  decidedBy?: CorrectionActor | string | null;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
  events?: CorrectionEvent[];
}

export interface CorrectionSummary {
  pending: number;
  approvedToday: number;
  rejected: number;
  changesRequested: number;
}

export interface ProposeCorrectionInput {
  grade: string;
  location: string;
  proposedPrice: number;
  reason: string;
}

export type NotificationType =
  | "correction.proposed"
  | "correction.approved"
  | "correction.rejected"
  | "correction.changes_requested"
  | "circular.published"
  | "system.warning";

export interface AppNotification {
  _id: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

export interface NotificationQuery {
  unreadOnly?: boolean;
  type?: NotificationType;
  q?: string;
  page?: number;
  limit?: number;
}

export interface NotificationListResponse {
  items: AppNotification[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogQuery {
  from?: string;
  to?: string;
  user?: string;
  action?: string;
  entity?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogEntry {
  _id: string;
  user: CorrectionActor | string | null;
  action: string;
  entity: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogListResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface DashboardResponse {
  kpis: {
    corrections: CorrectionSummary;
    circulars: { drafts: number; published: number; scheduled: number };
    masterData: { producers: number; locations: number; grades: number; priceBookEntries: number };
    activity: { today: number; thisWeek: number; thisMonth: number };
  };
  charts: {
    correctionsTrend: ChartPoint[];
    approvalRate: { approved: number; rejected: number };
    priceUpdates: ChartPoint[];
    circularActivity: ChartPoint[];
  };
  recentActivity: AuditLogEntry[];
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
  createdBy: CorrectionActor | string | null;
  submittedAt?: string;
  reviewedBy?: CorrectionActor | string;
  reviewedAt?: string;
  reviewNote?: string;
  publishedBy?: CorrectionActor | string | null;
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

export interface FreightCircularDraft {
  _id: string;
  producer: string;
  circularNumber: string;
  effectiveDate: string;
  status: DraftStatus;
  reason: string;
  rowCount: number;
  changedRowCount: number;
  addedRowCount: number;
  removedDestinations: string[];
  /** Destinations no location maps to — publishing is blocked until acknowledged. */
  unmappedCount: number;
  unmappedAcknowledgedAt?: string;
  /** Destinations whose live counterpart had to be guessed — two rows, one name. */
  ambiguousDestinations: string[];
  createdBy: CorrectionActor | string | null;
  submittedAt?: string;
  reviewedBy?: CorrectionActor | string;
  reviewedAt?: string;
  reviewNote?: string;
  publishedBy?: CorrectionActor | string | null;
  publishedAt?: string;
  publishedCircular?: string;
  createdAt: string;
}

export interface FreightCircularRow {
  _id: string;
  draft: string;
  destination: string;
  ratePerMt: number;
  previousRatePerMt: number;
  insurancePerMt: number;
  previousInsurancePerMt: number;
  changed: boolean;
  isNew: boolean;
  mapped: boolean;
  state?: string;
  district?: string;
  cluster?: string;
  distanceKm?: number;
  transitDays?: number;
}

export interface FreightCircularDiff {
  draftId: string;
  changedRowCount: number;
  changes: Array<{
    destination: string;
    from: number;
    to: number;
    delta: number;
    insuranceFrom: number;
    insuranceTo: number;
  }>;
  addedCount: number;
  added: Array<{ destination: string; ratePerMt: number; mapped: boolean }>;
  removedCount: number;
  removed: string[];
  unmappedCount: number;
  unmapped: Array<{
    destination: string;
    ratePerMt: number;
    state: string | null;
    district: string | null;
    isNew: boolean;
  }>;
  unmappedAcknowledgedAt: string | null;
  /** Rows whose live counterpart was matched by name rather than exactly. */
  ambiguousCount: number;
  ambiguous: string[];
}

export interface CreateFreightCircularInput {
  producer: string;
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
  createdBy: CorrectionActor | string | null;
  submittedAt?: string;
  reviewedBy?: CorrectionActor | string;
  reviewedAt?: string;
  reviewNote?: string;
  publishedBy?: CorrectionActor | string | null;
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
