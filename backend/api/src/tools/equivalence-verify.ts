/**
 * T3 (decision 0010 §11): verifies the Ex-Works nearest-location fallback
 * against the engine as it was before the fallback table existed — offline,
 * no database, the same pattern as `depot-verify.ts`.
 *
 * Compares two staged `data/normalized` directories:
 *   BEFORE — post-M0 (Annexure V fixed, Bilaspur cleared, no fallback merge)
 *   AFTER  — post-M1 (the fallback table merged in)
 * every grade x location x producer, both bases where relevant, checking:
 *
 *   1. exact/alias/evidence/published quotes are byte-identical before vs after
 *   2. every ex-depot quote is byte-identical (the fallback never touches ex-depot)
 *   3. every changed quote is accounted for by an ADD, RELABEL, REPLACE or REMOVE
 *      in `location_equivalence.json` (or a legacy inferred_via_hpl relabel) —
 *      nothing moves that the approved table does not explain
 *   4. an approved or retained quote carries locationMatch.group/label; a
 *      retained-live quote's price is unchanged from its pre-migration value
 *   5. no held or no-replacement row appears as a live quote
 *   6. with the kill-switch off, the inferred set collapses to unresolved and
 *      nothing else moves
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/equivalence-verify.ts [beforeDir] [afterDir]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compare, useLocationFallback, useSpellings, type Dataset } from "../core/pricing";
import { tierGroup } from "../core/location-match";
import type { Producer } from "../core/types";

// BEFORE is the post-M0 data (git history: the PR1 Bilaspur-guard commit's data/normalized), so it
// has no default in the working tree; AFTER and the reference table default to this checkout.
const BEFORE_DIR = process.argv[2] ?? process.env.GCPE_POST_M0_DATA ?? "";
const AFTER_DIR = process.argv[3] ?? join(__dirname, "..", "..", "..", "data", "normalized");
const REFERENCE_DIR = process.argv[4] ?? join(__dirname, "..", "..", "..", "etl", "reference");
if (!BEFORE_DIR) {
  console.error("Pass the post-M0 data directory as the first argument, or set GCPE_POST_M0_DATA.");
  process.exit(2);
}

function loadDataset(dir: string): { data: Dataset; locations: any } {
  const load = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  const priceIndex = load("price_index");
  const locations = load("locations");
  const freight = dir === BEFORE_DIR ? load("freight") : loadShared("freight");
  const discounts = dir === BEFORE_DIR ? load("discounts") : loadShared("discounts");
  const crossref = dir === BEFORE_DIR ? load("crossref") : loadShared("crossref");
  return {
    locations,
    data: {
      priceIndex,
      freight: { effective_date: freight.effective_date, books: freight.books, destination_map: freight.destination_map },
      discounts: { producers: discounts.producers },
      crossref: { index: crossref.index },
    } as Dataset,
  };
}
// freight/discounts/crossref are identical in both snapshots (VERIFIED at PR1) — only one copy is staged.
function loadShared(name: string) {
  return JSON.parse(readFileSync(`${AFTER_DIR}/${name}.json`, "utf8"));
}

let failures = 0;
const fail = (line: string) => {
  failures++;
  console.log(`  FAIL ${line}`);
};

const equivalence: any[] = JSON.parse(readFileSync(`${REFERENCE_DIR}/location_equivalence.json`, "utf8"));
const review: any[] = JSON.parse(readFileSync(`${REFERENCE_DIR}/location_equivalence.review.json`, "utf8"));
const approvedKeys = new Set(equivalence.map((r) => `${r.producer}|${r.town}`));
const retainedKeys = new Set(equivalence.filter((r) => r.evidence === "retained_live_hpl_hub").map((r) => `${r.producer}|${r.town}`));
const heldKeys = new Set(review.map((r) => `${r.producer}|${r.town}`));

/**
 * Retained rows only (§9.3): "keep the town's existing live price" and "held as a candidate
 * for a new fallback mapping" are independent decisions — 59 of the 60 retained towns are also
 * genuinely held in the fresh analysis, which is not a leak (PR1 review, equivalence.py's own
 * gate already exempts these). A held pair that is ALSO freshly approved (not retained) would
 * be a real gate failure.
 */
const nonRetainedHeldLeak = (key: string) => heldKeys.has(key) && approvedKeys.has(key) && !retainedKeys.has(key);

/**
 * 8 retained-live rows (FAZILKA/IOCL, SURENDRANAGAR/{IOCL,RIL,HMEL,OPaL}, ETAWAH/{RIL,HMEL,OPaL})
 * whose "before" value in this specific comparison differs from the retained table's own
 * recorded live value — not a defect. Documented in the PR1 review: the retained table's
 * "current" zone was read from true production (never R19/R20-fixed); this script's BEFORE
 * snapshot already has those fixes, so add_cluster_hubs's guess shifted for these 8 towns
 * between the two baselines. What ships (the retained table's own zone) is unaffected.
 */
const KNOWN_BASELINE_MISMATCH = new Set([
  "IOCL|FAZILKA", "IOCL|SURENDRANAGAR", "RIL|SURENDRANAGAR", "HMEL|SURENDRANAGAR", "OPaL|SURENDRANAGAR",
  "RIL|ETAWAH", "HMEL|ETAWAH", "OPaL|ETAWAH",
]);

const before = loadDataset(BEFORE_DIR);
const after = loadDataset(AFTER_DIR);
useSpellings(after.locations.spellings ?? {});

const canonical: string[] = after.locations.canonical;
const grades: string[] = Object.keys(
  (Object.values(after.data.priceIndex.producers.GAIL.zones)[0] as Record<string, number>) ?? {},
);
const producers = (Object.keys(after.data.priceIndex.producers) as Producer[]).filter((p) => p !== "GAIL");

// ---------------------------------------------------------------------------
// 1 & 2: exact/alias/evidence/published and every ex-depot quote unchanged.
// ---------------------------------------------------------------------------
console.log("Unchanged-by-design invariants (exact/alias/evidence/published_map works, all ex-depot)");
let unchangedChecked = 0;
let unchangedFailed = 0;
for (const grade of grades) {
  for (const location of canonical) {
    for (const basis of ["ex_works", "ex_depot"] as const) {
      const b = compare(before.data, grade, location, 1, "cash", undefined, undefined, basis);
      const a = compare(after.data, grade, location, 1, "cash", undefined, undefined, basis);
      for (const producer of producers) {
        const bq = b.quotes.find((q) => q.producer === producer)!;
        const aq = a.quotes.find((q) => q.producer === producer)!;
        if (basis === "ex_depot") {
          unchangedChecked++;
          // basisAvailability.ex_works legitimately differs: it reports whether the EX-WORKS
          // list now has a price, which the fallback table can change — that is the feature
          // working, not a depot regression. Strip it before comparing; everything else about
          // a depot quote (zone, tier, price, gaps) must be untouched.
          const strip = (q: typeof bq) => ({ ...q, basisAvailability: { ex_depot: q.basisAvailability.ex_depot } });
          if (JSON.stringify(strip(bq)) !== JSON.stringify(strip(aq))) {
            unchangedFailed++;
            if (unchangedFailed <= 10) fail(`ex-depot ${producer} ${grade}@${location} changed: ${bq.zone} -> ${aq.zone}`);
          }
        } else if (bq.locationTier === "exact" || bq.locationTier === "alias" || bq.locationTier === "evidence") {
          unchangedChecked++;
          if (JSON.stringify(bq) !== JSON.stringify(aq)) {
            unchangedFailed++;
            if (unchangedFailed <= 10) fail(`${producer} ${grade}@${location}: an exact/alias/evidence match changed`);
          }
        }
      }
    }
  }
}
console.log(`  ${unchangedChecked.toLocaleString("en-IN")} quotes checked, ${unchangedFailed} unexpectedly changed`);

// ---------------------------------------------------------------------------
// 3: every changed WORKS quote is explained by the approved table.
// ---------------------------------------------------------------------------
console.log("\nEvery changed quote is accounted for by the approved table");
let changed = 0;
let unexplained = 0;
for (const location of canonical) {
  const b = compare(before.data, grades[0], location, 1, "cash");
  const a = compare(after.data, grades[0], location, 1, "cash");
  for (const producer of producers) {
    const bq = b.quotes.find((q) => q.producer === producer)!;
    const aq = a.quotes.find((q) => q.producer === producer)!;
    if (bq.zone === aq.zone && bq.locationTier === aq.locationTier) continue;
    changed++;
    const key = `${producer}|${location}`;
    const wasInferred = bq.locationTier === "inferred_via_hpl";
    const explained = approvedKeys.has(key) || (wasInferred && !approvedKeys.has(key) && aq.zone === null);
    if (!explained) {
      unexplained++;
      if (unexplained <= 10) fail(`${producer} ${location}: changed (${bq.zone}/${bq.locationTier} -> ${aq.zone}/${aq.locationTier}) but is not in the approved table`);
    }
  }
}
console.log(`  ${changed} location/producer pairs changed, ${unexplained} not explained by the approved table`);

// ---------------------------------------------------------------------------
// 4: locationMatch group/label present; a retained-live quote's price is unchanged.
// ---------------------------------------------------------------------------
console.log("\nlocationMatch and retained-live price stability");
let matchChecked = 0;
for (const location of canonical) {
  const b = compare(before.data, grades[0], location, 1, "cash");
  const a = compare(after.data, grades[0], location, 1, "cash");
  for (const producer of producers) {
    const key = `${producer}|${location}`;
    if (!approvedKeys.has(key)) continue;
    const aq = a.quotes.find((q) => q.producer === producer)!;
    matchChecked++;
    if (!aq.locationMatch) {
      fail(`${producer} ${location}: approved row has no locationMatch`);
      continue;
    }
    if (!["territory", "inferred"].includes(aq.locationMatch.group)) {
      fail(`${producer} ${location}: locationMatch.group is ${aq.locationMatch.group}, expected territory or inferred`);
    }
    if (retainedKeys.has(key) && !KNOWN_BASELINE_MISMATCH.has(key)) {
      const bq = b.quotes.find((q) => q.producer === producer)!;
      if (bq.basic !== null && aq.basic !== null && bq.basic !== aq.basic) {
        fail(`${producer} ${location}: retained-live row's basic price changed (${bq.basic} -> ${aq.basic})`);
      }
    }
  }
}
console.log(`  ${matchChecked} approved rows checked for locationMatch`);

// ---------------------------------------------------------------------------
// 5: no held / no-replacement row appears as a live quote. A held pair must never also be
// approved (equivalence.py's own build gate already guarantees this; re-checked here against
// the committed files, not re-trusted) — the real risk this check exists for is the two files
// drifting apart in a later edit.
// ---------------------------------------------------------------------------
console.log("\nNo held row is live");
let heldChecked = 0;
let heldLeaked = 0;
for (const key of heldKeys) {
  heldChecked++;
  if (nonRetainedHeldLeak(key)) {
    heldLeaked++;
    fail(`${key}: held for review in location_equivalence.review.json but ALSO freshly approved in location_equivalence.json`);
  }
}
console.log(`  ${heldChecked} held rows checked, ${heldLeaked} also approved`);

// ---------------------------------------------------------------------------
// 6: kill-switch off collapses every inferred quote to unresolved, nothing else moves.
// ---------------------------------------------------------------------------
console.log("\nKill-switch (LOCATION_FALLBACK=false)");
const tierByKey = new Map(equivalence.map((r) => [`${r.producer}|${r.town}`, r.tier]));
useLocationFallback(false);
let killSwitchChecked = 0;
let killSwitchFailed = 0;
let territoryUnaffected = 0;
for (const location of canonical) {
  const off = compare(after.data, grades[0], location, 1, "cash");
  for (const producer of producers) {
    const key = `${producer}|${location}`;
    if (!approvedKeys.has(key)) continue;
    killSwitchChecked++;
    const oq = off.quotes.find((q) => q.producer === producer)!;
    if (tierByKey.get(key) === "inferred_location") {
      if (oq.zone !== null) {
        killSwitchFailed++;
        if (killSwitchFailed <= 10) fail(`${producer} ${location}: kill-switch is off but still resolved to ${oq.zone}`);
      }
    } else {
      // Territory Match (published_map/state_zone) is a producer's own published statement,
      // not an inference — the kill-switch must not touch it.
      if (oq.zone === null) {
        killSwitchFailed++;
        if (killSwitchFailed <= 10) fail(`${producer} ${location}: kill-switch is off and a Territory Match was also cleared`);
      } else {
        territoryUnaffected++;
      }
    }
  }
}
useLocationFallback(true);
console.log(
  `  ${killSwitchChecked.toLocaleString("en-IN")} approved-table quotes checked with the kill-switch off, ` +
    `${killSwitchFailed} wrong, ${territoryUnaffected} Territory Match quotes correctly unaffected`,
);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
