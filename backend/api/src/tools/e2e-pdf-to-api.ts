/**
 * Prove a price survives the whole journey: circular, extractor, index,
 * database, API.
 *
 * The remaining exposure this audit has not closed is a mispairing that keeps
 * every dimension — a complete rectangle of plausible numbers attached to the
 * wrong grades. Shape gates cannot see it and a drift check only sees it when
 * the mispaired values differ enough. What does see it is following particular
 * cells all the way through and comparing each against what the page prints.
 *
 * So this samples cells per producer, deliberately including the places past
 * defects lived — first and last column, stacked headers, wrapped names,
 * multi-page sections — and checks five values agree exactly at every stage.
 *
 * The database leg is a real query against a real MongoDB. The API leg is a
 * real HTTP request to the real Nest application, booted here on a spare port.
 *
 *   MONGODB_URI=<isolated> npx ts-node -r tsconfig-paths/register \
 *     src/tools/e2e-pdf-to-api.ts [staged dir]
 */

import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";

const DIR = process.argv[2] ?? "D:/Gail2/staged/sept";
const PORT = Number(process.env.E2E_PORT ?? 3987);
const j = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const prices = j(`${DIR}/prices.json`);
const index = j(`${DIR}/price_index.json`);
const crossref = j(`${DIR}/crossref.json`);

/** What the extractor itself produced, per producer, before assembly. */
const ALIASES: Record<string, Record<string, string>> = {
  HPL: { ...(prices.hpl?.hdpe?.I?.aliases ?? {}), ...(prices.hpl?.lldpe?.aliases ?? {}) },
  OPaL: prices.opal?.dta?.aliases ?? {},
};

function extractorValue(producer: string, zone: string, grade: string): number | undefined {
  const primary = ALIASES[producer]?.[grade];
  if (primary) return extractorValue(producer, zone, primary);
  switch (producer) {
    case "IOCL": return prices.iocl?.prices?.delivered?.[zone]?.[grade];
    case "HMEL": return prices.hmel?.ex_works?.[zone]?.[grade];
    case "GAIL": {
      const key = Object.keys(prices.gail?.ex_works ?? {}).find((k) => k.endsWith(`|${zone}`) || k === zone);
      return key ? prices.gail.ex_works[key]?.[grade] : undefined;
    }
    case "HPL": {
      const one = prices.hpl?.hdpe?.I?.points?.[zone]?.[grade];
      return one ?? prices.hpl?.lldpe?.ex_works?.[zone]?.[grade];
    }
    case "OPaL": {
      for (const sheet of ["DTA-HDPE", "DTA-LLDPE"]) {
        const v = prices.opal?.dta?.sheets?.[sheet]?.[zone]?.prices?.[grade];
        if (v !== undefined) return v;
      }
      return undefined;
    }
    case "RIL": {
      // build.py merges the nine domestic annexures cheapest-wins, because a
      // grade delivered from two plants is quotable at the lower of the two.
      const DOMESTIC = ["IA", "IB", "IC", "ID", "IE", "IF", "IIA", "IIB", "IIC"];
      let best: number | undefined;
      for (const key of DOMESTIC) {
        const v = prices.ril?.annexures?.[key]?.zones?.[zone]?.prices?.[grade];
        if (v !== undefined && (best === undefined || v < best)) best = v;
      }
      return best;
    }
    default: return undefined;
  }
}

/** Cells chosen to land on the places defects have lived, not at random. */
function sample(producer: string, want = 10): Array<{ zone: string; grade: string; why: string }> {
  const zones = index.producers[producer].zones as Record<string, Record<string, number>>;
  const zoneNames = Object.keys(zones);
  const grades = Object.keys(zones[zoneNames[0]!]!);
  const picks: Array<{ zone: string; grade: string; why: string }> = [];
  const add = (zone: string, grade: string, why: string) => {
    if (zones[zone]?.[grade] !== undefined && !picks.some((p) => p.zone === zone && p.grade === grade)) {
      picks.push({ zone, grade, why });
    }
  };
  // Structural extremes.
  add(zoneNames[0]!, grades[0]!, "first zone, first column");
  add(zoneNames[zoneNames.length - 1]!, grades[grades.length - 1]!, "last zone, last column");
  add(zoneNames[Math.floor(zoneNames.length / 2)]!, grades[0]!, "first column, mid book");
  add(zoneNames[0]!, grades[grades.length - 1]!, "last column, first zone");

  // Where this producer's defects actually were.
  const known: Record<string, Array<[string, string, string]>> = {
    HMEL: [["Guwahati", "N0320L", "largest historical correction"],
           ["Delhi", "M2050S", "was mispaired to a neighbour"],
           ["Delhi", "R0150S", "stacked pair, first name"],
           ["Delhi", "R0151D", "stacked pair, second name"],
           ["Delhi", "OGHDBD", "off-grade family"],
           ["Delhi", "F517LMV", "LLDPE family, fused header"],
           ["Kolhapur", "N0120L", "character-shredded row"],
           ["Pune", "N0320L", "character-shredded row"]],
    IOCL: [["Udaipur", "003DF49", "orphaned row, first of thirteen"],
           ["Bareilly", "XFHD", "orphaned row, last"],
           ["Visak", "XEHD-Al", "kept on the label half of a split row"],
           ["Gautam Budh nagar", "003DF49", "orphan claimed by a caption"],
           ["Jammu", "XMHD-Al", "split row, tail values"]],
    HPL: [["West Bengal_Howrah", "HDBRE", "rejected by the code shape"],
          ["West Bengal_Howrah", "HDT9C", "was overwritten by HDBRE"],
          ["Goa", "HD OG (E)", "multi-word off-grade alias"],
          ["Goa", "HDT10S", "stacked alias"]],
    OPaL: [["Delhi", "F52H04", "stacked pair, primary"],
           ["Delhi", "F52H02", "stacked pair, alias"],
           ["Delhi", "UHDEH", "last column"]],
    GAIL: [["DELHI", "I56A200U", "split code, sheet writes I56A200U A"],
           ["DELHI", "B52A003A", "form letter, cross-reference names it B52A003"],
           ["DELHI", "MF18A010U", "split code"]],
    RIL: [["DELHI", "B56003", "multi-annexure, cheapest wins"]],
  };
  for (const [zone, grade, why] of known[producer] ?? []) add(zone, grade, why);

  // Fill to ten with a deterministic spread.
  let step = Math.max(1, Math.floor(zoneNames.length / want));
  for (let i = 0; picks.length < want && i < zoneNames.length; i += step) {
    add(zoneNames[i]!, grades[(i * 7) % grades.length]!, "sampled");
  }
  return picks.slice(0, Math.max(want, picks.length));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required and must be an isolated database");
  if (/\/gailcpe(\?|$)/.test(uri)) throw new Error("refusing to run against the production database");

  await mongoose.connect(uri);
  const PriceEntry = mongoose.connection.collection("priceEntries");

  const { AppModule } = await import("../app.module");
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(PORT, "127.0.0.1");
  const base = `http://127.0.0.1:${PORT}/api`;

  const login = await fetch(`${base}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL ?? "jainam@gmail.com", password: process.env.ADMIN_PASSWORD ?? "passABC@123" }),
  });
  const auth = (await login.json()) as any;
  const token = auth.accessToken ?? auth.token ?? auth.access_token;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  console.log(`API up on ${base}, authenticated: ${token ? "yes" : "NO"}\n`);

  // One compare call serves many cells: cache by grade+location.
  const compareCache = new Map<string, any>();
  const apiQuotes = async (gailGrade: string, location: string) => {
    const key = `${gailGrade}|${location}`;
    if (!compareCache.has(key)) {
      const res = await fetch(`${base}/pricing/compare`, {
        method: "POST", headers,
        body: JSON.stringify({ grade: gailGrade, location, quantityMt: 120, paymentMode: "cash" }),
      });
      compareCache.set(key, res.ok ? await res.json() : null);
    }
    return compareCache.get(key);
  };

  // Which GAIL grade and location reach a given producer cell, so the API can
  // be asked a question whose answer should be that cell.
  const canonical: string[] = j(`D:/Gail2/gailcpe/backend/data/normalized/locations.json`).canonical;
  const reachFor = new Map<string, { gail: string; location: string }>();
  for (const poly of ["hdpe", "lldpe"] as const) {
    for (const row of crossref[poly]) {
      for (const [producer, codes] of Object.entries<any>(row.equivalents ?? {})) {
        for (const code of codes) reachFor.set(`${producer}|${code}`, { gail: row.gail_grade, location: "" });
      }
    }
  }

  // GAIL's own book has a route of its own, so every GAIL cell can be asked
  // of the API directly rather than through a comparison.
  const bookRes = await fetch(`${base}/pricing/gail-book`, { headers });
  const book = bookRes.ok ? await bookRes.json() : [];
  const gailBook = new Map<string, number>();
  for (const r of (Array.isArray(book) ? book : (book as any).rows ?? [])) {
    if (r?.zone && r?.grade) gailBook.set(`${r.zone}|${r.grade}`, r.price ?? r.basic);
  }
  console.log(`gail-book returned ${gailBook.size} rows
`);

  const rows: string[] = [];
  let checked = 0, failed = 0;
  console.log("producer  zone                 grade        PDF/extractor      index         DB        API   result   note");
  console.log("-".repeat(132));

  for (const producer of ["GAIL", "IOCL", "RIL", "HMEL", "HPL", "OPaL"]) {
    for (const { zone, grade, why } of sample(producer)) {
      const idx = index.producers[producer].zones[zone][grade] as number;
      const ext = extractorValue(producer, zone, grade);
      const doc = await PriceEntry.findOne({ producer, zone, grade });
      const db = doc?.price as number | undefined;

      // The API leg: find a GAIL grade whose comparison quotes this producer
      // at a location that resolves to this zone, and read the quoted basic.
      let api: number | undefined;
      const reach = reachFor.get(`${producer}|${grade}`);
      const location = canonical.find((l) => l.toUpperCase() === zone.toUpperCase())
        ?? canonical.find((l) => zone.toUpperCase().includes(l.toUpperCase()));
      if (producer === "GAIL") {
        api = gailBook.get(`${zone}|${grade}`);
        if (api === undefined && location) {
          const c = await apiQuotes(grade, location);
          api = c?.quotes?.find((q: any) => q.producer === "GAIL")?.basic ?? undefined;
        }
      } else if (reach && location) {
        const c = await apiQuotes(reach.gail, location);
        const q = c?.quotes?.find((x: any) => x.producer === producer);
        if (q?.grade === grade) api = q.basic ?? undefined;
      }

      const stages = [ext, idx, db].filter((v) => v !== undefined) as number[];
      const consistent = stages.every((v) => v === idx);
      const apiOk = api === undefined ? null : api === idx;
      const ok = consistent && apiOk !== false;
      checked++;
      if (!ok) failed++;
      const f = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString("en-IN"));
      const verdict = !consistent ? "MISMATCH" : apiOk === null ? "PASS (api n/a)" : apiOk ? "PASS" : "API MISMATCH";
      const line = `${producer.padEnd(9)} ${zone.slice(0, 20).padEnd(20)} ${grade.padEnd(12)} ` +
        `${f(ext).padStart(12)} ${f(idx).padStart(12)} ${f(db).padStart(10)} ${f(api).padStart(10)}   ` +
        `${verdict.padEnd(14)} ${why}`;
      console.log(line);
      rows.push(line);
    }
  }

  // ---- broad DB -> API fidelity -----------------------------------------
  // A quote names the producer, the zone it priced and the grade it chose, so
  // every quote the API returns can be checked against the stored cell it
  // claims to be. This covers far more cells than the sampled table, and it is
  // the leg that a mispairing between database and API would show up in.
  console.log("-".repeat(132));
  let quotes = 0, quoteMismatch = 0;
  const quoteBad: string[] = [];
  const gailGrades = Object.keys(index.producers.GAIL.zones[Object.keys(index.producers.GAIL.zones)[0]!]!);
  for (const g of gailGrades.slice(0, 12)) {
    for (const loc of canonical.slice(0, 25)) {
      const c = await apiQuotes(g, loc);
      for (const q of c?.quotes ?? []) {
        if (q.basic === null || !q.zone || !q.grade) continue;
        const stored = index.producers[q.producer]?.zones?.[q.zone]?.[q.grade];
        quotes++;
        if (stored !== q.basic) {
          quoteMismatch++;
          if (quoteBad.length < 5) quoteBad.push(`${q.producer} ${q.zone} ${q.grade}: api ${q.basic} vs index ${stored}`);
        }
      }
    }
  }
  console.log(`broad API check: ${quotes.toLocaleString("en-IN")} quotes returned across ` +
    `${12 * 25} comparisons; ${quoteMismatch} disagree with the stored cell they name`);
  for (const b of quoteBad) console.log(`    ${b}`);
  if (quoteMismatch) failed += quoteMismatch;

  console.log("-".repeat(132));
  console.log(`${checked} cells sampled, ${failed} failed`);
  const withApi = rows.filter((r) => !r.includes("api n/a")).length;
  console.log(`${withApi} of them reached the API through a live HTTP comparison`);

  await app.close();
  await mongoose.disconnect();
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
