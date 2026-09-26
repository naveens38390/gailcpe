/**
 * READ-ONLY production verification for price round 2026-09-16. Run it under
 * readonly-guard.js (the npm script does).
 *
 *   MONGODB_URI=... VERIFY_OUT=<dir> VERIFY_SNAPSHOT=<snapshot dir> npm run verify-production -- --pre
 *   MONGODB_URI=... VERIFY_OUT=<dir> npm run verify-production -- --post
 *   MONGODB_URI=... VERIFY_OUT=<dir> npm run verify-production -- --rollback
 *
 *   --pre      before the window. Production must still equal the snapshot the
 *              deployment simulation ran on; saves VERIFY_OUT/baseline-pre.json.
 *   --post     after the window. Live state against the simulation's expected
 *              state and the baseline.
 *   --rollback after a rollback. What the app serves must equal the baseline:
 *              the same active circulars, locations, discounts, grade mappings
 *              and engine output, and no 2026-09-16 ex-depot entries. Inert
 *              records the rollback leaves on purpose (the round's circulars,
 *              now superseded, their ex-works entries, drafts, documents,
 *              audit entries, notifications) are reported, not failed.
 *
 * Prints PASS / FAIL / WARN per check; exit code 1 on any FAIL. The expected
 * values are specific to this round and come from the deployment simulation.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";

loadEnv();

import { EJSON, canonical } from "../../database/release-lib";
import { LocationSchema, GradeMappingSchema, ProducerSchema } from "../../database/schemas/catalog.schema";
import {
  DiscountSchemeSchema,
  FreightEntrySchema,
  PriceCircularSchema,
  PriceEntrySchema,
} from "../../database/schemas/circular.schema";
import { PriceCorrectionSchema } from "../../database/schemas/correction.schema";
import { DiscountTermsSchema } from "../../database/schemas/discount-terms.schema";
import { DatasetService } from "../../modules/dataset/dataset.service";
import { compare } from "../../core/pricing";

const MODE = process.argv.includes("--post") ? "post" : process.argv.includes("--rollback") ? "rollback" : "pre";
const OUT = process.env.VERIFY_OUT;
const SNAP = process.env.VERIFY_SNAPSHOT;
const P = ["IOCL", "RIL", "HMEL", "HPL", "OPaL"];
const ROUND_OLD = "2026-09-01", ROUND_NEW = "2026-09-16";

const EXPECT = {
  activeCirculars: { GAIL: "ex_works", IOCL: "delivered", RIL: "delivered", HMEL: "ex_works", HPL: "ex_works", OPaL: "ex_works" },
  newEntries: { "GAIL/ex_works": 16589, "IOCL/delivered": 2760, "RIL/delivered": 19200, "HMEL/ex_works": 8778, "HPL/ex_works": 4260, "OPaL/ex_works": 3510,
                "GAIL/ex_depot": 3127, "IOCL/ex_depot": 2477, "RIL/ex_depot": 7819, "HMEL/ex_depot": 8094, "HPL/ex_depot": 4260, "OPaL/ex_depot": 1683 } as Record<string, number>,
  locations: {
    LONAWALA: { "producerZone.HMEL": "Pune", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 54 },
    KHOPOLI: { "producerZone.HMEL": "Mumbai", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 58 },
    RAIGAD: { "producerZone.HMEL": "Mumbai", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 62 },
    ROHA: { "producerZone.HMEL": "Mumbai", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 75 },
    MUNDRA: { "producerZone.HMEL": "Gandhidham", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 50 },
    BURHANPUR: { "producerZone.HMEL": "Indore", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 162 },
    KHANDWA: { "producerZone.HMEL": "Indore", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 113 },
    KHARGONE: { "producerZone.HMEL": "Indore", "producerZoneTier.HMEL": "inferred_location", "producerZoneMeta.HMEL.km": 102 },
    ROURKELA: { "producerZone.HPL": "Orissa_Barhgarh", "producerZoneTier.HPL": "published_map" },
    SAMBALPUR: { "producerZone.HPL": "Orissa_Barhgarh", "producerZoneTier.HPL": "published_map", "producerDepotZone.HPL": "Orissa_Barhgarh" },
  } as Record<string, Record<string, unknown>>,
  notifications: 6,
};

const results: [string, string, string][] = [];
const check = (name: string, ok: boolean | "warn", detail: string) => results.push([ok === "warn" ? "WARN" : ok ? "PASS" : "FAIL", name, detail]);
const canon = (d: any) => { const c = JSON.parse(EJSON.stringify(d, { relaxed: false })); delete c.updatedAt; delete c.__v; return c; };
// Full canonical hash (recursively sorted keys). Not JSON.stringify(x, keyArray): an array replacer is an
// allowlist applied at EVERY depth, so it silently drops nested fields such as producerZone.HMEL.
const hash = (d: any) => createHash("sha256").update(canonical(canon(d))).digest("hex");
const deepHash = (d: any) => createHash("sha256").update(EJSON.stringify(canon(d), { relaxed: false })).digest("hex");
const get = (o: any, p: string) => p.split(".").reduce((x, k) => x?.[k], o);
const dayOf = (d: any) => new Date(d).toISOString().slice(0, 10);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  if (!OUT) throw new Error("VERIFY_OUT (directory for baseline-pre.json and results) is required");
  if (MODE === "pre" && !SNAP) throw new Error("VERIFY_SNAPSHOT (the simulation's snapshot directory) is required for --pre");
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const model = (n: string, s: any): any => mongoose.models[n] ?? mongoose.model(n, s);
  const locations = await db.collection("locations").find({}).toArray();
  const discounts = await db.collection("discountSchemes").find({}).toArray();
  const gradeMappings = await db.collection("gradeMappings").find({}).toArray();
  const circulars = await db.collection("priceCirculars").find({}).toArray();
  const entryCounts: Record<string, number> = {};
  for (const r of await db.collection("priceEntries").aggregate([{ $group: { _id: { p: "$producer", b: "$basis", d: { $dateToString: { date: "$effectiveDate", format: "%Y-%m-%d" } } }, n: { $sum: 1 } } }]).toArray())
    entryCounts[`${r._id.p}/${r._id.b}/${r._id.d}`] = r.n;
  const auditCount = await db.collection("auditLogs").countDocuments({});
  const notifCount = await db.collection("notifications").countDocuments({});
  const lastAudit = (await db.collection("auditLogs").find({}).sort({ createdAt: -1 }).limit(1).toArray())[0]?.createdAt ?? null;
  const lastNotif = (await db.collection("notifications").find({}).sort({ createdAt: -1 }).limit(1).toArray())[0]?.createdAt ?? null;

  // engine: what the API serves after a restart
  const service = new DatasetService(
    model("PriceCircular", PriceCircularSchema), model("PriceEntry", PriceEntrySchema),
    model("FreightEntry", FreightEntrySchema), model("DiscountScheme", DiscountSchemeSchema),
    model("Location", LocationSchema), model("GradeMapping", GradeMappingSchema),
    model("PriceCorrection", PriceCorrectionSchema), model("DiscountTerms", DiscountTermsSchema),
    model("Producer", ProducerSchema));
  const data: any = await service.load();
  await mongoose.disconnect();
  const towns = Object.keys(data.priceIndex.producers.GAIL.zones);
  const grades = [...new Set(Object.values<any>(data.priceIndex.producers.GAIL.zones).flatMap((z: any) => Object.keys(z)))];
  const engine: any = { priced: {}, landed: {}, townCompetitors: {} };
  const zoneAt: Record<string, string | null> = {};
  for (const basis of ["ex_works", "ex_depot"]) for (const t of towns) {
    const comps = new Set<string>();
    for (const g of grades) for (const q of compare(data, g, t, 1, "cash", undefined, undefined, basis as any).quotes as any[]) {
      const k = `${q.producer}/${basis}`;
      if (q.basic != null) { engine.priced[k] = (engine.priced[k] ?? 0) + 1; if (P.includes(q.producer)) comps.add(q.producer); if (basis === "ex_works" && q.zone) zoneAt[`${q.producer}|${t}`] = q.zone; }
      if (q.invoiceLanded != null) engine.landed[k] = (engine.landed[k] ?? 0) + 1;
    }
    engine.townCompetitors[`${basis}|${t}`] = [...comps].sort();
  }

  if (MODE === "pre") {
    // production must still equal the snapshot the deployment simulation ran on
    const snap = (n: string): any[] => EJSON.parse(readFileSync(`${SNAP}/${n}.ejson`, "utf8"), { relaxed: false }) as any[];
    const same = (live: any[], snapDocs: any[]) => { const a = new Map(live.map((d) => [String(d._id), deepHash(d)])); return snapDocs.length === live.length && snapDocs.every((d: any) => a.get(String(d._id)) === deepHash(d)); };
    check("locations unchanged since the simulation snapshot", same(locations, snap("locations")), `${locations.length} documents`);
    check("discount schemes unchanged since the snapshot", same(discounts, snap("discountSchemes")), `${discounts.length} documents`);
    check("grade mappings unchanged since the snapshot", same(gradeMappings, snap("gradeMappings")), `${gradeMappings.length} documents`);
    check("price circulars unchanged since the snapshot", same(circulars, snap("priceCirculars")), `${circulars.length} documents`);
    const snapEntries: Record<string, number> = {};
    for (const d of snap("priceEntries")) { const k = `${d.producer}/${d.basis}/${dayOf(d.effectiveDate)}`; snapEntries[k] = (snapEntries[k] ?? 0) + 1; }
    check("price entries unchanged since the snapshot (counts per producer/basis/date)", sameJson(Object.entries(snapEntries).sort(), Object.entries(entryCounts).sort()), `${Object.values(entryCounts).reduce((a, b) => a + b, 0)} entries`);
    check(`no ${ROUND_NEW} entries or circulars yet`, !Object.keys(entryCounts).some((k) => k.endsWith(ROUND_NEW)) && !circulars.some((c: any) => dayOf(c.effectiveDate) === ROUND_NEW), "clean starting point");
    const baseline = { takenAt: new Date().toISOString(), locationHashes: Object.fromEntries(locations.map((d: any) => [d.name, hash(d)])),
      discountHashes: discounts.map(hash).sort(), gradeMappingHashes: gradeMappings.map(hash).sort(), entryCounts, auditCount, notifCount, lastAudit, lastNotif,
      activeCircularIds: circulars.filter((c: any) => c.status === "active").map((c: any) => String(c._id)), engine };
    writeFileSync(`${OUT}/baseline-pre.json`, JSON.stringify(baseline, null, 1));
    check("baseline saved for --post", true, `${OUT}/baseline-pre.json`);
  } else {
    const base = JSON.parse(readFileSync(`${OUT}/baseline-pre.json`, "utf8"));
    const active = circulars.filter((c: any) => c.status === "active");
    const unexpectedLocations = (except: string[]) =>
      locations.filter((d: any) => !except.includes(d.name) && base.locationHashes[d.name] !== hash(d)).map((d: any) => d.name);
    const engineChecks = () => {
      for (const k of Object.keys(base.engine.priced)) check(`engine priced quotes ${k}`, engine.priced[k] === base.engine.priced[k], `${base.engine.priced[k]} -> ${engine.priced[k] ?? 0}`);
      for (const k of Object.keys(base.engine.landed)) check(`engine landed quotes ${k}`, engine.landed[k] === base.engine.landed[k], `${base.engine.landed[k]} -> ${engine.landed[k] ?? 0}`);
      const lostTowns = Object.entries<any>(base.engine.townCompetitors).filter(([k, v]) => v.some((p: string) => !engine.townCompetitors[k]?.includes(p))).map(([k]) => k);
      check("no town lost a competitor (both bases)", lostTowns.length === 0, lostTowns.join(", ") || "all 313 towns x 2 bases");
    };
    const oldSame = Object.entries(base.entryCounts).every(([k, n]) => entryCounts[k] === n);

    if (MODE === "post") {
      check("exactly 6 active circulars, all dated 2026-09-16", active.length === 6 && active.every((c: any) => dayOf(c.effectiveDate) === ROUND_NEW), active.map((c: any) => `${c.producer} ${dayOf(c.effectiveDate)} ${c.basis}`).join(", "));
      check("active circular bases", Object.entries(EXPECT.activeCirculars).every(([p, b]) => active.some((c: any) => c.producer === p && c.basis === b)), JSON.stringify(EXPECT.activeCirculars));
      check("previously active circulars now superseded", base.activeCircularIds.every((id: string) => circulars.find((c: any) => String(c._id) === id)?.status === "superseded"), `${base.activeCircularIds.length} circulars`);
      for (const [k, n] of Object.entries(EXPECT.newEntries)) check(`2026-09-16 entries ${k}`, entryCounts[`${k}/${ROUND_NEW}`] === n, `expected ${n}, found ${entryCounts[`${k}/${ROUND_NEW}`] ?? 0}`);
      check("all pre-window entries still present (rollback point)", oldSame, "1 Sep and earlier entries untouched");
      for (const [town, fields] of Object.entries(EXPECT.locations)) {
        const d = locations.find((x: any) => x.name === town);
        const bad = Object.entries(fields).filter(([f, v]) => get(d, f) !== v).map(([f, v]) => `${f}: ${get(d, f)} (expected ${v})`);
        check(`location ${town}`, bad.length === 0, bad.join("; ") || Object.entries(fields).map(([f, v]) => `${f}=${v}`).join(", "));
      }
      const unexpected = unexpectedLocations(Object.keys(EXPECT.locations));
      check("no other location changed", unexpected.length === 0, unexpected.length ? unexpected.join(", ") : `${locations.length - 10} documents identical to the baseline`);
      check("discount schemes unchanged", sameJson(discounts.map(hash).sort(), base.discountHashes), `${discounts.length} documents`);
      check("grade mappings unchanged (27 corrections intact)", sameJson(gradeMappings.map(hash).sort(), base.gradeMappingHashes), `${gradeMappings.length} documents`);
      check("audit entries added", auditCount - base.auditCount >= 25 ? (auditCount - base.auditCount === 25 ? true : "warn") : false, `${auditCount - base.auditCount} (expected 25: 6 extract, 6 submit, 6 review, 6 publish, 1 migration.m1)`);
      check("notifications added", notifCount - base.notifCount === EXPECT.notifications ? true : "warn", `${notifCount - base.notifCount} (expected 6)`);
      engineChecks();
      const zeroTowns = Object.entries<any>(engine.townCompetitors).filter(([, v]) => v.length === 0).map(([k]) => k);
      check("zero-competitor towns unchanged", zeroTowns.every((k) => base.engine.townCompetitors[k]?.length === 0), zeroTowns.join(", ") || "none");
      const zones = Object.entries(EXPECT.locations).map(([t, f]) => [t, (f as any)["producerZone.HMEL"] ? "HMEL" : "HPL", (f as any)["producerZone.HMEL"] ?? (f as any)["producerZone.HPL"]] as [string, string, string]);
      const zoneBad = zones.filter(([t, p, z]) => zoneAt[`${p}|${t}`] !== z).map(([t, p, z]) => `${p} ${t}: ${zoneAt[`${p}|${t}`]} (expected ${z})`);
      check("engine quotes the approved zones at the 10 decision towns", zoneBad.length === 0, zoneBad.join("; ") || "all 10");
      check("engine serves the 2026-09-16 round", String(data.priceIndex.effective_date).startsWith(ROUND_NEW), String(data.priceIndex.effective_date));
    } else {
      // --rollback: the served state must be the baseline's; inert leftovers are reported only.
      const activeIds = active.map((c: any) => String(c._id)).sort();
      check("active circulars are exactly the baseline's", sameJson(activeIds, [...base.activeCircularIds].sort()), `${activeIds.length} active (baseline ${base.activeCircularIds.length})`);
      check(`no active ${ROUND_NEW} circular`, !active.some((c: any) => dayOf(c.effectiveDate) === ROUND_NEW), active.map((c: any) => `${c.producer} ${dayOf(c.effectiveDate)}`).join(", "));
      const depotLeft = Object.entries(entryCounts).filter(([k]) => k.includes("/ex_depot/") && k.endsWith(ROUND_NEW));
      check(`no ${ROUND_NEW} ex-depot entries`, depotLeft.length === 0, depotLeft.map(([k, n]) => `${k}: ${n}`).join(", ") || "0");
      check("all pre-window entries still present", oldSame, `${Object.keys(base.entryCounts).length} producer/basis/date groups identical`);
      const unexpected = unexpectedLocations([]);
      check("every location identical to the baseline", unexpected.length === 0, unexpected.join(", ") || `${locations.length} documents`);
      check("discount schemes unchanged", sameJson(discounts.map(hash).sort(), base.discountHashes), `${discounts.length} documents`);
      check("grade mappings unchanged", sameJson(gradeMappings.map(hash).sort(), base.gradeMappingHashes), `${gradeMappings.length} documents`);
      engineChecks();
      const zeroNow = Object.entries<any>(engine.townCompetitors).filter(([, v]) => v.length === 0).map(([k]) => k).sort();
      const zeroBase = Object.entries<any>(base.engine.townCompetitors).filter(([, v]) => v.length === 0).map(([k]) => k).sort();
      check("zero-competitor towns identical to the baseline", sameJson(zeroNow, zeroBase), `${zeroNow.length} (baseline ${zeroBase.length})`);
      check(`engine serves the ${ROUND_OLD} round`, String(data.priceIndex.effective_date).startsWith(ROUND_OLD), String(data.priceIndex.effective_date));
      // Inert leftovers: not read by the live app.
      const inertEntries = Object.entries(entryCounts).filter(([k]) => k.endsWith(ROUND_NEW)).reduce((n, [, v]) => n + v, 0);
      const inertCirculars = circulars.filter((c: any) => dayOf(c.effectiveDate) === ROUND_NEW).map((c: any) => c.status);
      check(`inert ${ROUND_NEW} records left (not served)`, "warn",
        `${inertEntries} ex-works entries, ${inertCirculars.length} circulars (${inertCirculars.filter((s: string) => s === "superseded").length} superseded, ${inertCirculars.filter((s: string) => s === "draft").length} filed documents), ` +
        `+${auditCount - base.auditCount} audit entries, +${notifCount - base.notifCount} notifications`);
    }
  }
  const width = Math.max(...results.map((r) => r[1].length));
  for (const [s, n, d] of results) console.log(`${s.padEnd(4)}  ${n.padEnd(width)}  ${d}`);
  const fails = results.filter((r) => r[0] === "FAIL").length, warns = results.filter((r) => r[0] === "WARN").length;
  console.log(`\n${MODE.toUpperCase()}: ${results.length - fails - warns} PASS, ${warns} WARN, ${fails} FAIL`);
  writeFileSync(`${OUT}/verification-${MODE}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ mode: MODE, results, engine }, null, 1));
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("VERIFY ERROR:", String(e?.stack ?? e).replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>")); process.exit(1); });
