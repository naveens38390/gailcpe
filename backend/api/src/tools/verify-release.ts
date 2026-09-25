/**
 * Release check for the ex-works / ex-depot price basis, run against a live API.
 *
 *   API_URL=https://gcpe-api.onrender.com/api \
 *   VERIFY_EMAIL=... VERIFY_PASSWORD=... \
 *   npm run verify-release -- [--stage pre-load|post-load|pre-fallback|post-fallback] [--with-deal]
 *
 * Stages (the release runbooks in docs/release-checklist.md and
 * docs/location-fallback/12-deployment-checklist.md say when to use each):
 *   pre-load   the new API is live and NO depot rows have been loaded yet:
 *              Ex Works is unchanged and every producer reads "Not published" on Ex Depot.
 *   post-load  (default) the depot rows are loaded and the API has been restarted:
 *              Bhiwandi Ex Depot figures, RIL dealer discount and delta, mixed-basis
 *              scenarios, Not Published towns.
 *   pre-fallback   location-fallback release (decision 0010): depot loaded, M0
 *              (fix-hpl-territory) applied, the fallback-aware API live, M1 NOT yet run.
 *              Every post-load check, plus: quotes carry locationMatch, no fallback tier is
 *              served yet, HPL Bilaspur reads unresolved.
 *   post-fallback  M1 (load-equivalence) applied and the API restarted: every post-load check,
 *              plus 12 towns (60 competitor cells, all five classifications) checked against the
 *              client-approved Competitor Presence workbook, and named checks for Bilaspur,
 *              Latur, Beawar and Ex Depot.
 *
 * It only reads, with side effects to know about: every /pricing/compare is
 * kept in comparison history (about 15 small records), and --with-deal runs
 * /deals/simulate, which stores each simulation (a few records), and also runs
 * the "History" section below. Nothing existing is deleted or edited. The
 * credentials are read from the environment and never printed.
 *
 * The History section's last check needs to insert and then delete ONE
 * synthetic record shaped exactly like a comparison saved before the
 * `pricingBasis` field existed (to prove a documented backward-compatibility
 * promise: "a record with no pricingBasis field is found by ?pricingBasis=
 * ex_works" — this cannot be tested through the HTTP API alone, because the
 * API always sets the field now). That one check runs only when MONGODB_URI
 * is set in the environment (the same variable load-depot/rollback-depot use)
 * and is skipped, not failed, otherwise. The inserted document is named
 * grade/location "VERIFY_RELEASE_PROBE" so it is unmistakable if cleanup ever
 * fails, and cleanup runs in a finally block.
 *
 * THE EXPECTED FIGURES BELONG TO ONE ROUND (EXPECTED_ROUND below; grade B52A003,
 * 1 MT, cash). The script reads the round the API is serving before anything else
 * and stops with exit code 3 if it differs, so a new round is reported as "update
 * the figures", never as a failing price. Update the tables from the client's sheet
 * and bump EXPECTED_ROUND when a new round is published.
 *
 * Section "cross-grade" needs no typed figures: it compares the API, grade by
 * grade and town by town, with the price_index.json of the checkout it is run
 * from (so run it from a clean clone of the release commit). It also fails if that
 * file is a different round from the one the API serves.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { checkLocation, readApprovedWorkbook, WORKBOOK_DEFAULT } from "./workbook-verify";

const API = (process.env.API_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
const EMAIL = process.env.VERIFY_EMAIL;
const PASSWORD = process.env.VERIFY_PASSWORD;
const args = process.argv.slice(2);
const stageArg = args.indexOf("--stage");
const STAGE = stageArg >= 0 ? args[stageArg + 1] : "post-load";
const STAGES = ["pre-load", "post-load", "pre-fallback", "post-fallback"];
/** Every stage after the depot load: the depot's own post-load checks apply to all of them. */
const DEPOT_LOADED = STAGE !== "pre-load";
const FALLBACK_STAGE = STAGE === "pre-fallback" || STAGE === "post-fallback";
const WITH_DEAL = args.includes("--with-deal");

if (!EMAIL || !PASSWORD) {
  console.error("Set VERIFY_EMAIL and VERIFY_PASSWORD (an existing account on the target API).");
  process.exit(2);
}
if (!STAGES.includes(STAGE)) {
  console.error(`--stage must be one of ${STAGES.join(", ")}, got "${STAGE}".`);
  process.exit(2);
}

// ---- the round these figures belong to; checked FIRST so a new round is never mistaken for a bug
const EXPECTED_ROUND = "2026-09-01";
const DATA_DIR = process.env.GCPE_DATA ?? join(__dirname, "..", "..", "..", "data", "normalized");

// ---- expected figures: grade B52A003 at BHIWANDI, 1 MT, cash --------------------------
const GRADE = "B52A003";
const LOCATION = "BHIWANDI";
const WORKS = { GAIL: 140761.75, IOCL: 139496, RIL: 139529, HMEL: 139540, OPaL: 140315.72 } as const;
const HPL_WORKS_AFTER_LOAD = 140605; // HPL has no Bhiwandi price until the loader fills its works zone
const DEPOT = { GAIL: 140420, IOCL: 139296, RIL: 138870, HMEL: 139290, OPaL: 139836 } as const;
const RIL_DEALER_DISCOUNT = 350;
const RIL_DELTA_DEPOT = DEPOT.GAIL - DEPOT.RIL; // 1,550
const TIE_ORDER = ["GAIL", "IOCL", "HMEL", "HPL", "OPaL", "RIL"];

type Q = {
  producer: string;
  grade?: string;
  zone?: string;
  basic?: number | null;
  invoiceLanded: number | null;
  pricingBasis?: string;
  dealerDiscount?: number;
  priceDelta?: number | null;
  basisAvailability?: { ex_depot?: boolean };
  locationTier?: string;
  locationMatch?: { group: string; label: string; matchedZone: string | null; distanceKm?: number };
};
type Cmp = { quotes: Q[]; leader: Q | null; gailRank: number | null; warnings: string[]; gapToLeader: number | null };

let token = "";
let stopped = false; // the dataset round is not the one this script was written for
let failures = 0;
let passes = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};
const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 0.005;
const inr = (n: number | null | undefined) => (n == null ? "none" : n.toLocaleString("en-IN"));

async function call(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}
const compare = async (extra: Record<string, unknown> = {}, location = LOCATION, mode = "cash") =>
  (await call("/pricing/compare", { grade: GRADE, location, quantityMt: 1, paymentMode: mode, ...extra })).json as Cmp;
const q = (c: Cmp, p: string) => c.quotes.find((x) => x.producer === p)!;

async function main() {
  console.log(`Target ${API}   stage ${STAGE}${WITH_DEAL ? "   with Deal" : ""}\n`);

  console.log("API health and login");
  const health = await call("/health");
  check(health.status === 200 && health.json?.status === "ok", "GET /health is ok", JSON.stringify(health.json));
  check(health.json?.database === "up", "database is up", JSON.stringify(health.json));
  const login = await call("/auth/login", { email: EMAIL, password: PASSWORD });
  token = login.json?.accessToken ?? "";
  check(Boolean(token), "login succeeds", `HTTP ${login.status}`);
  if (!token) return;

  console.log("\nDataset round");
  const probe = (await compare()) as Cmp & { effectiveDate?: string };
  const apiRound = probe.effectiveDate ?? "unknown";
  if (apiRound !== EXPECTED_ROUND) {
    console.log(`  STOP the API is serving the price round ${apiRound}; this script's figures are for ${EXPECTED_ROUND}.`);
    console.log("       This is not a pricing failure. Update EXPECTED_ROUND and the figure tables in src/tools/verify-release.ts");
    console.log("       from the client's sheet for the new round, then run again.");
    stopped = true;
    return;
  }
  check(true, `API serves the expected round ${EXPECTED_ROUND}`);

  console.log("\nEx Works at Bhiwandi (no basis requested — what every existing client sends)");
  const works = await compare();
  check(works.quotes?.length === 6, "six producers returned");
  check(works.quotes.every((x) => x.pricingBasis === "ex_works"), "new API is live (each quote reports pricingBasis ex_works)");
  for (const [p, v] of Object.entries(WORKS)) check(near(q(works, p).invoiceLanded, v), `${p} ${inr(v)}`, inr(q(works, p).invoiceLanded));
  check(works.leader?.producer === "IOCL", "leader is IOCL", String(works.leader?.producer));
  check((q(works, "RIL").dealerDiscount ?? 0) === 0, "RIL dealer discount is NOT on Ex Works");
  check(
    JSON.stringify(works.quotes.map((x) => x.producer)) === JSON.stringify(TIE_ORDER),
    "quotes come back in the fixed tie-break order (GAIL, IOCL, HMEL, HPL, OPaL, RIL)",
    works.quotes.map((x) => x.producer).join(","),
  );
  if (DEPOT_LOADED) check(near(q(works, "HPL").invoiceLanded, HPL_WORKS_AFTER_LOAD), `HPL now priced at Bhiwandi ${inr(HPL_WORKS_AFTER_LOAD)}`, inr(q(works, "HPL").invoiceLanded));
  else check(q(works, "HPL").invoiceLanded === null, "HPL still unpriced at Bhiwandi (loader not run yet)", inr(q(works, "HPL").invoiceLanded));

  console.log("\nEx Depot at Bhiwandi");
  const depot = await compare({ pricingBasis: "ex_depot" });
  if (STAGE === "pre-load") {
    check(depot.quotes.every((x) => x.invoiceLanded === null), "no producer is priced (no depot rows loaded)");
    const unpublished = /Not published ex depot: ([^.]*)\./.exec(depot.warnings.join(" "))?.[1] ?? "";
    check(TIE_ORDER.every((p) => unpublished.includes(p)), 'warning reads "Not published ex depot: …" for all six', depot.warnings.join(" | "));
  } else {
    for (const [p, v] of Object.entries(DEPOT)) check(near(q(depot, p).invoiceLanded, v), `${p} ${inr(v)}`, inr(q(depot, p).invoiceLanded));
    check(depot.leader?.producer === "RIL", "leader is RIL", String(depot.leader?.producer));
    check(q(depot, "RIL").dealerDiscount === RIL_DEALER_DISCOUNT, `RIL dealer discount ${RIL_DEALER_DISCOUNT}`, String(q(depot, "RIL").dealerDiscount));
    check(near(q(depot, "RIL").priceDelta, RIL_DELTA_DEPOT), `RIL Price Delta ${inr(RIL_DELTA_DEPOT)} (GAIL − RIL, final prices)`, String(q(depot, "RIL").priceDelta));
    const credit = await compare({ pricingBasis: "ex_depot" }, LOCATION, "credit_ifc");
    check(q(credit, "RIL").dealerDiscount === RIL_DEALER_DISCOUNT, "RIL dealer discount also applies on credit");
  }
  const bad = await call("/pricing/compare", { grade: GRADE, location: LOCATION, quantityMt: 1, paymentMode: "cash", pricingBasis: "bogus" });
  check(bad.status === 400, "an unknown basis is rejected with 400", `HTTP ${bad.status}`);

  if (DEPOT_LOADED) {
    console.log("\nMixed basis (global selector plus per-card overrides)");
    const m1 = await compare({ basisOverrides: { HMEL: "ex_depot", RIL: "ex_depot" } });
    check(near(q(m1, "RIL").invoiceLanded, DEPOT.RIL) && near(q(m1, "HMEL").invoiceLanded, DEPOT.HMEL), "HMEL and RIL on depot prices");
    check(near(q(m1, "IOCL").invoiceLanded, WORKS.IOCL) && near(q(m1, "GAIL").invoiceLanded, WORKS.GAIL), "GAIL and IOCL stay on Ex Works");
    check(near(q(m1, "RIL").priceDelta, WORKS.GAIL - DEPOT.RIL), "RIL delta uses GAIL's displayed (Ex Works) price", String(q(m1, "RIL").priceDelta));
    const m2 = await compare({ basisOverrides: { GAIL: "ex_depot", HMEL: "ex_depot", RIL: "ex_depot" } });
    check(near(q(m2, "GAIL").invoiceLanded, DEPOT.GAIL), "GAIL override: GAIL on its depot price");
    check(near(q(m2, "IOCL").priceDelta, DEPOT.GAIL - WORKS.IOCL), `IOCL delta ${inr(DEPOT.GAIL - WORKS.IOCL)} = GAIL depot − IOCL works`, String(q(m2, "IOCL").priceDelta));
    check(m2.leader?.producer === "RIL", "leader follows the displayed prices (RIL)", String(m2.leader?.producer));
    const m3 = await compare({});
    check(JSON.stringify(m3.quotes) === JSON.stringify(works.quotes), "no overrides returns exactly the Ex Works answer");
    const m4 = await compare({ pricingBasis: "ex_depot", basisOverrides: { HMEL: "ex_works" } });
    check(near(q(m4, "HMEL").invoiceLanded, WORKS.HMEL) && near(q(m4, "IOCL").invoiceLanded, DEPOT.IOCL), "global Ex Depot with HMEL on Ex Works");

    console.log("\nNot Published (Agra, Ex Depot)");
    const agra = await compare({ pricingBasis: "ex_depot" }, "AGRA");
    const np = agra.quotes.filter((x) => x.invoiceLanded === null && x.basisAvailability?.ex_depot === false).map((x) => x.producer);
    check(["IOCL", "HMEL", "OPaL", "RIL"].every((p) => np.includes(p)), "IOCL, HMEL, OPaL, RIL read Not Published", `not published: ${np.join(",")}`);
    check(near(q(agra, "GAIL").invoiceLanded, 140990), "GAIL still priced at Agra 1,40,990", inr(q(agra, "GAIL").invoiceLanded));
    check(/Not published ex depot/.test(agra.warnings.join(" ")), "comparison warning names them");
  }

  await crossGrade(apiRound);
  if (FALLBACK_STAGE) await locationFallback();

  if (WITH_DEAL) {
    console.log("\nDeal (stores 3 simulations)");
    const sim = async (extra: Record<string, unknown>, location = LOCATION) =>
      (await call("/deals/simulate", { grade: GRADE, location, quantityMt: 250, paymentMode: "cash", ...extra })).json;
    const dw = await sim({});
    check(dw.pricingBasis === "ex_works" && dw.comparison?.leader?.producer === "IOCL", "Deal Ex Works: leader IOCL", String(dw.comparison?.leader?.producer));
    if (DEPOT_LOADED) {
      const dd = await sim({ pricingBasis: "ex_depot" });
      check(dd.pricingBasis === "ex_depot" && dd.comparison?.leader?.producer === "RIL", "Deal Ex Depot: leader RIL", String(dd.comparison?.leader?.producer));
      check(near(dd.comparison?.gapToLeader, RIL_DELTA_DEPOT), `Deal Ex Depot gap ${inr(RIL_DELTA_DEPOT)}`, String(dd.comparison?.gapToLeader));
      const np = await sim({ pricingBasis: "ex_depot" }, "ABU ROAD");
      check(np.outcome === "not_priced", "Deal with no GAIL depot price: outcome not_priced", String(np.outcome));
      check(
        (np.narrative ?? []).includes("No published Ex Depot pricing is available from GAIL for this grade and location."),
        "…with the plain Not Published sentence",
        JSON.stringify(np.narrative),
      );
    } else {
      const dd = await sim({ pricingBasis: "ex_depot" });
      check(dd.outcome === "not_priced", "Deal Ex Depot before the load: not_priced (no error)", String(dd.outcome));
    }

    await checkHistory();
  }
}

/**
 * Compare/Deal history: the basis is stored where a report or an admin screen
 * could read it without parsing quotes, and the documented backward-compatibility
 * promise for records saved before the field existed actually holds.
 */
async function checkHistory() {
  console.log("\nHistory");
  await compare({}); // a plain Ex Works comparison, to check its history record below
  if (DEPOT_LOADED) {
    await compare({ pricingBasis: "ex_depot" });
    await compare({ basisOverrides: { HMEL: "ex_depot" } });
  }
  await call("/deals/simulate", { grade: GRADE, location: LOCATION, quantityMt: 250, paymentMode: "cash" });

  const hist = (await call(`/pricing/history?limit=50`)).json as any[];
  const byGrade = (id: string) => hist?.find((h) => String(h._id) === id);
  check(Array.isArray(hist) && hist.length > 0, "GET /pricing/history returns records");
  const wRec = hist?.find((h) => h.location === LOCATION && h.pricingBasis === "ex_works" && !h.basisOverrides);
  check(!!wRec, "a plain Ex Works comparison is stored with pricingBasis: ex_works");
  if (DEPOT_LOADED) {
    const dRec = hist?.find((h) => h.location === LOCATION && h.pricingBasis === "ex_depot");
    check(!!dRec, "an Ex Depot comparison is stored with pricingBasis: ex_depot");
    const mRec = hist?.find((h) => h.basisOverrides?.HMEL === "ex_depot");
    check(!!mRec && mRec.pricingBasis === "ex_works", "a mixed-basis comparison stores basisOverrides AND its global pricingBasis");
    check(
      Array.isArray(mRec?.result?.quotes) &&
        mRec.result.quotes.find((q: any) => q.producer === "HMEL")?.pricingBasis === "ex_depot" &&
        mRec.result.quotes.find((q: any) => q.producer === "IOCL")?.pricingBasis === "ex_works",
      "…and the embedded quotes carry each producer's own basis, matching basisOverrides",
    );
    const worksFiltered = (await call(`/pricing/history?limit=50&pricingBasis=ex_works`)).json as any[];
    const depotFiltered = (await call(`/pricing/history?limit=50&pricingBasis=ex_depot`)).json as any[];
    check(
      worksFiltered.every((h) => h.pricingBasis === "ex_works") && depotFiltered.every((h) => h.pricingBasis === "ex_depot"),
      "?pricingBasis= filters return only matching records",
    );
  }

  const dealHist = (await call(`/deals/history?limit=50`)).json as any[];
  const dwRec = dealHist?.find((h) => h.location === LOCATION && h.pricingBasis === "ex_works");
  check(!!dwRec, "Deal history stores pricingBasis on a plain Ex Works simulation");

  // The one check that needs direct DB access: a record saved before pricingBasis
  // existed has the field entirely absent (not "ex_works" written in) — the API
  // cannot produce that shape any more, so this is inserted and removed here.
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log("  skip  MONGODB_URI not set — cannot test that a pre-existing record (no pricingBasis field at all) is matched by ?pricingBasis=ex_works");
    return;
  }
  const mongoose = await import("mongoose");
  const conn = await mongoose.createConnection(uri).asPromise();
  const probeId = new mongoose.Types.ObjectId();
  const me = (await call("/auth/me")).json as { id?: string };
  try {
    // `user` is stored as the plain string id the app itself writes (confirmed
    // by inspection — Mongoose does not cast it here despite the schema saying
    // ObjectId), and history is scoped to the requesting user, so the probe
    // must carry that same id or the account-scoping alone would hide it.
    await conn.db!.collection("comparisonHistory").insertOne({
      _id: probeId,
      user: me.id,
      grade: "VERIFY_RELEASE_PROBE",
      location: "VERIFY_RELEASE_PROBE",
      quantityMt: 1,
      paymentMode: "cash",
      effectiveDate: new Date(EXPECTED_ROUND),
      result: { quotes: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
      // deliberately no pricingBasis field
    });
    const withFilter = (await call(`/pricing/history?limit=200&pricingBasis=ex_works`)).json as any[];
    check(
      withFilter.some((h) => h._id === String(probeId)),
      "a record saved before pricingBasis existed (field entirely absent) IS matched by ?pricingBasis=ex_works",
      "the schema comment promises this; a plain equality filter would not do it (found and fixed 2026-09-22)",
    );
  } finally {
    await conn.db!.collection("comparisonHistory").deleteOne({ _id: probeId });
    await conn.close();
  }
}

// ---- cross-grade: the API against the release's own data files, no typed figures --------
const GRADES = ["B52A003", "E36A060", "F18A020U", "B55HM0003"];
const TOWNS = ["BHIWANDI", "AGRA", "DELHI", "ABU ROAD"];

async function crossGrade(apiRound: string) {
  console.log("\nCross-grade (API vs this checkout's price_index.json)");
  const file = join(DATA_DIR, "price_index.json");
  if (!existsSync(file)) {
    console.log(`  skip ${file} not found - run from a checkout of the release commit`);
    return;
  }
  const idx = JSON.parse(readFileSync(file, "utf8"));
  check(idx.effective_date === apiRound, `data files are round ${idx.effective_date}, API serves ${apiRound}`, "wrong release commit, or the API has not loaded this round");
  if (idx.effective_date !== apiRound) return;

  const lookup = (basis: "ex_works" | "ex_depot", producer: string, town: string) => {
    const zoneMap = (basis === "ex_depot" ? idx.depot_location_map : idx.location_map)?.[producer];
    const zone: string | undefined = zoneMap?.[town] ?? (producer === "GAIL" && basis === "ex_works" ? town : undefined);
    const book = (basis === "ex_depot" ? idx.depot?.[producer] : idx.producers?.[producer])?.zones;
    return { zone, book: zone ? book?.[zone] : undefined };
  };
  type QQ = Q & { grade?: string; zone?: string; basic?: number | null };
  let cells = 0, priced = 0, unpublished = 0, preM1Skipped = 0;
  const bad: string[] = [];
  for (const grade of GRADES) {
    for (const town of TOWNS) {
      for (const basis of ["ex_works", "ex_depot"] as const) {
        const c = (await call("/pricing/compare", { grade, location: town, quantityMt: 1, paymentMode: "cash", ...(basis === "ex_depot" ? { pricingBasis: basis } : {}) })).json as Cmp & { quotes: QQ[] };
        for (const x of c.quotes) {
          cells++;
          const { zone, book } = lookup(basis, x.producer, town);
          if (x.invoiceLanded === null) {
            if (basis === "ex_depot" && !zone) {
              unpublished++;
              if (x.basisAvailability?.ex_depot !== false) bad.push(`${grade} ${town} ${x.producer}: no depot in the data but the API does not say Not Published`);
            }
            continue;
          }
          if (STAGE === "pre-fallback" && x.locationMatch?.group !== "exact") {
            preM1Skipped++; // M1 not run: Territory/Inferred zones still differ from this checkout's data by design
            continue;
          }
          priced++;
          if (x.zone !== zone) bad.push(`${grade} ${town} ${x.producer} ${basis}: API zone ${x.zone}, data says ${zone}`);
          else if (!book || x.grade === undefined || book[x.grade] === undefined) bad.push(`${grade} ${town} ${x.producer} ${basis}: grade ${x.grade} not in the data's zone ${zone}`);
          else if (x.basic !== book[x.grade]) bad.push(`${grade} ${town} ${x.producer} ${basis}: basic ${x.basic}, data ${book[x.grade]}`);
        }
      }
    }
  }
  check(bad.length === 0, `${cells} producer quotes (${GRADES.length} grades x ${TOWNS.length} towns x 2 bases): every priced basic and zone equals the data file`, bad.slice(0, 3).join(" | "));
  check(priced > 0 && unpublished > 0, `both outcomes were exercised (${priced} priced, ${unpublished} Not Published ex depot)`);
  if (preM1Skipped) console.log(`  note  ${preM1Skipped} Territory/Inferred quotes not compared with the data file (pre-fallback: M1 not run yet)`);

  // A producer's own grade code (HPL E5201, the equivalent of B52A003) on both
  // price lists — skipped at pre-load, where HPL genuinely has no price at
  // Bhiwandi yet on either basis (its works zone is filled in only by
  // load-depot, and no ex_depot data exists before it runs), while the data
  // file always shows the post-load target state. (Found running this section
  // at --stage pre-load with --with-deal, a combination the documented runbook
  // does not use, but now that --with-deal also runs History checks it can.)
  if (STAGE === "pre-load") {
    console.log("  skip  HPL E5201 override check (Bhiwandi has no HPL price on either basis before load-depot)");
  } else {
    for (const basis of ["ex_works", "ex_depot"] as const) {
      const c = (await call("/pricing/compare", { grade: GRADE, location: LOCATION, quantityMt: 1, paymentMode: "cash", gradeOverrides: { HPL: "E5201" }, ...(basis === "ex_depot" ? { pricingBasis: basis } : {}) })).json as Cmp & { quotes: QQ[] };
      const h = c.quotes.find((x) => x.producer === "HPL")!;
      const { book } = lookup(basis, "HPL", LOCATION);
      check(
        h.grade === "E5201" && book !== undefined && h.basic === book["E5201"],
        `HPL E5201 override on ${basis}: quoted grade and basic equal the data file`,
        `${h.grade} basic ${h.basic}, data ${book?.["E5201"]}`,
      );
    }
  }
}

// ---- location fallback (decision 0010): pre-fallback and post-fallback stages ----------------
/** Covers all five workbook classifications: 27 inferred, 15 territory, 8 retained, 8 exact, 2 none (Latur). */
const FALLBACK_TOWNS = [
  "ABU ROAD", "AHMEDNAGAR", "ALAPPUZHA", "BIDAR", "BHIWANDI", "BILASPUR",
  "LATUR", "BEAWAR", "DURG", "GAYA", "HALDIA", "DURGAPUR",
];
const FALLBACK_TIERS = ["state_zone", "inferred_location"];

async function locationFallback() {
  console.log(`
Location fallback (${STAGE}; stores ${FALLBACK_TOWNS.length + 2} comparison records)`);
  const works: Record<string, Cmp> = {};
  for (const town of FALLBACK_TOWNS) works[town] = await compare({}, town);
  const all = Object.values(works).flatMap((c) => c.quotes);

  check(
    all.filter((x) => x.zone).every((x) => x.locationMatch?.group),
    "fallback-aware API is live: every quote with a zone carries locationMatch",
  );

  if (STAGE === "pre-fallback") {
    const early = all.filter((x) => FALLBACK_TIERS.includes(x.locationTier ?? ""));
    check(early.length === 0, "no fallback tier is served yet (M1 not run)", early.slice(0, 3).map((x) => `${x.producer} ${x.zone}`).join(", "));
    const hpl = q(works["BILASPUR"], "HPL");
    check(hpl.zone == null, "M0 applied: HPL Bilaspur reads unresolved (the wrong Himachal Pradesh price is gone)", String(hpl.zone));
    return;
  }

  // post-fallback: the client-approved workbook is the oracle.
  if (!existsSync(WORKBOOK_DEFAULT)) {
    check(false, "approved workbook present in this checkout", `${WORKBOOK_DEFAULT} not found - run from a clean clone of the release commit`);
    return;
  }
  const wb = await readApprovedWorkbook(WORKBOOK_DEFAULT);
  const problems = FALLBACK_TOWNS.flatMap((town) => checkLocation(town, works[town].quotes as any, wb));
  check(
    problems.length === 0,
    `${FALLBACK_TOWNS.length} towns x 5 competitors match the approved Competitor Presence workbook (classification, mapped location, distance)`,
    problems.slice(0, 3).join(" | "),
  );
  if (q(works["ABU ROAD"], "IOCL").zone == null) {
    console.log("  hint  IOCL has no zone at Abu Road: is LOCATION_FALLBACK=false (kill-switch) set on the API, or M1 not applied?");
  }

  const bil = q(works["BILASPUR"], "HPL");
  check(bil.locationMatch?.label === "Territory Match" && bil.zone === "Chattisgarh", "HPL Bilaspur: Territory Match, Chattisgarh", `${bil.locationMatch?.label} ${bil.zone}`);
  const latur = works["LATUR"];
  check(q(latur, "IOCL").zone == null && q(latur, "HMEL").zone == null, "Latur: IOCL and HMEL removed (no price)", `${q(latur, "IOCL").zone} / ${q(latur, "HMEL").zone}`);
  const beawar = works["BEAWAR"];
  check(
    ["IOCL", "RIL", "OPaL"].every((p) => q(beawar, p).locationMatch?.label === "Retained Existing Mapping"),
    "Beawar: IOCL, RIL, OPaL only as Retained Existing Mapping (candidates not approved)",
    ["IOCL", "RIL", "OPaL"].map((p) => q(beawar, p).locationMatch?.label).join(", "),
  );
  check(
    /Inferred Location Match: .* km from ABU ROAD/.test(works["ABU ROAD"].warnings.join(" ")),
    "the comparison warning names the inferred zones and distances",
  );

  for (const town of ["ABU ROAD", "BIDAR"]) {
    const depot = await compare({ pricingBasis: "ex_depot" }, town);
    const leaked = depot.quotes.filter((x) => FALLBACK_TIERS.includes(x.locationTier ?? "") || x.locationMatch?.group === "inferred");
    check(leaked.length === 0, `Ex Depot at ${town}: no fallback or inferred match`, leaked.map((x) => x.producer).join(","));
  }
}

main()
  .then(() => {
    // exitCode, not exit(): exiting while fetch sockets are still closing trips a libuv assertion on Windows.
    if (stopped) {
      console.log("\nRELEASE CHECK NOT RUN: wrong dataset round (exit code 3). Nothing was checked against the wrong round.");
      process.exitCode = 3;
      return;
    }
    console.log(`\n${failures ? "RELEASE CHECK FAILED" : "RELEASE CHECK PASSED"}: ${passes} ok, ${failures} failed`);
    process.exitCode = failures ? 1 : 0;
  })
  .catch((e) => {
    console.error("\nRELEASE CHECK ERROR:", (e as Error).message.replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>"));
    process.exitCode = 2;
  });
