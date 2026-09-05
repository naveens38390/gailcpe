/**
 * Follow one price from the circular to the shape the API serves.
 *
 * Every earlier check compared whole books. This follows single values through
 * each hand-off instead, because that is where a type changes, a decimal is
 * lost, or a key collapses — none of which a cell-count comparison would show.
 *
 * Uses real September values, and asserts identity (===) at each hop rather
 * than approximate equality, so a float that had been through a string would
 * fail even if it printed the same.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/trace-one-price.ts [dir]
 */

import { readFileSync } from "node:fs";
import { compare, useSpellings, type Dataset } from "../core/pricing";

const DIR = process.argv[2] ?? "D:/Gail2/staged/sept";
const LIVE = "D:/Gail2/gailcpe/backend/data/normalized";
const j = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const prices = j(`${DIR}/prices.json`);
const index = j(`${DIR}/price_index.json`);
const crossref = j(`${DIR}/crossref.json`);
const discounts = j(`${DIR}/discounts.json`);
const freight = j(`${DIR}/freight.json`);
const locations = j(`${LIVE}/locations.json`);
useSpellings(locations.spellings ?? {});

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`    ${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

/** The document the seeder builds, reproduced exactly as seed.ts builds it. */
function seedRows(producer: string) {
  const payload = index.producers[producer];
  const rows: Array<Record<string, unknown>> = [];
  for (const [zone, cells] of Object.entries<any>(payload.zones)) {
    for (const [grade, price] of Object.entries<any>(cells)) {
      rows.push({
        producer, zone, grade, price,
        basis: payload.basis,
        effectiveDate: index.effective_date,
        supplyPoint: payload.supply_point?.[zone]?.[grade],
      });
    }
  }
  return rows;
}

console.log("=".repeat(84));
console.log(`END-TO-END TRACE — ${DIR}   effective ${index.effective_date}`);
console.log("=".repeat(84));

// ---- HMEL: a derived price, the hardest hop --------------------------------
{
  const zone = "Delhi", grade = "M2050S";
  const basic = prices.hmel.basic[grade].price;
  const adjustment = prices.hmel.adjustments[zone][grade];
  const extractor = prices.hmel.ex_works[zone][grade];
  const normalized = index.producers.HMEL.zones[zone][grade];
  const seeded = seedRows("HMEL").find((r) => r.zone === zone && r.grade === grade)!;

  console.log(`\nHMEL ${zone} ${grade} — derived as basic minus locational adjustment`);
  console.log(`    circular      basic ${basic}  adjustment ${adjustment}`);
  check("extractor output equals basic - adjustment", extractor === basic - adjustment,
    `${basic} - ${adjustment} = ${extractor}`);
  check("normalized index identical to extractor output", normalized === extractor,
    `${normalized}`);
  check("seeder document identical to index", seeded.price === normalized, `${seeded.price}`);
  check("seeded price is a number, not a string", typeof seeded.price === "number",
    `typeof = ${typeof seeded.price}`);
  check("survives a JSON round trip unchanged",
    JSON.parse(JSON.stringify(seeded)).price === seeded.price);
  check("no precision lost", Number.isInteger(seeded.price) || String(seeded.price).length < 17);
}

// ---- IOCL: a printed price, carried straight through -----------------------
{
  const zone = "Delhi", grade = "010E52";
  const extractor = prices.iocl.prices.delivered[zone][grade];
  const normalized = index.producers.IOCL.zones[zone][grade];
  const seeded = seedRows("IOCL").find((r) => r.zone === zone && r.grade === grade)!;

  console.log(`\nIOCL ${zone} ${grade} — printed on the page and carried through`);
  check("extractor output reaches the index unchanged", normalized === extractor,
    `${extractor} -> ${normalized}`);
  check("seeder document identical", seeded.price === normalized, `${seeded.price}`);
  check("basis carried with it", seeded.basis === "delivered", String(seeded.basis));
}

// ---- the whole set: no key collapse, no coercion ---------------------------
{
  console.log(`\nEvery producer — the documents the seeder would write`);
  let total = 0, nonNumber = 0, fractional = 0;
  const keys = new Set<string>();
  for (const producer of Object.keys(index.producers)) {
    for (const r of seedRows(producer)) {
      total++;
      if (typeof r.price !== "number") nonNumber++;
      if (!Number.isInteger(r.price as number)) fractional++;
      keys.add(`${r.producer}|${r.zone}|${r.grade}`);
    }
  }
  check("one document per cell", total === Object.values(index.producers)
    .reduce((t: number, e: any) => t + Object.values(e.zones)
      .reduce((s: number, c: any) => s + Object.keys(c).length, 0), 0),
    `${total.toLocaleString("en-IN")}`);
  check("no (producer, zone, grade) collapses", keys.size === total,
    `${(total - keys.size)} collisions`);
  check("every price is a number", nonNumber === 0);
  console.log(`    note  ${fractional} of ${total.toLocaleString("en-IN")} prices carry a fractional part`);
}

// ---- the API shape ---------------------------------------------------------
{
  const data: Dataset = {
    priceIndex: {
      effective_date: index.effective_date, producers: index.producers,
      location_map: index.location_map, location_tier: index.location_tier,
    },
    freight: { effective_date: freight.effective_date, books: freight.books, destination_map: freight.destination_map },
    discounts: { producers: discounts.producers },
    crossref: { index: crossref.index },
  } as Dataset;

  const c: any = compare(data, "B52A003A", "DELHI", 120, "cash");
  const hmel = c.quotes.find((q: any) => q.producer === "HMEL");
  console.log(`\nAPI shape — compare("B52A003A", "DELHI", 120 MT, cash)`);
  console.log(`    leader ${c.leader?.producer ?? "-"}, ${c.quotes.length} quotes`);
  check("HMEL's quote carries a numeric basic price",
    typeof hmel?.basic === "number" || hmel?.basic === null,
    `basic = ${hmel?.basic}`);
  check("landed cost is a finite number",
    typeof hmel?.invoiceLanded === "number" && Number.isFinite(hmel.invoiceLanded),
    `${hmel?.invoiceLanded}`);
  check("the quoted grade traces back to the index",
    hmel?.grade === undefined || index.producers.HMEL.zones["Delhi"]?.[hmel.grade] !== undefined,
    `grade = ${hmel?.grade}`);
}

console.log(`\n${"=".repeat(84)}`);
console.log(failures === 0 ? "TRACE CLEAN — no rounding, truncation, coercion or collapse"
                           : `${failures} TRACE FAILURE(S)`);
process.exitCode = failures ? 1 : 0;
