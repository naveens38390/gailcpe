/**
 * Matrix completeness for a built price index.
 *
 * A producer's book should be a rectangle: every zone carrying every grade the
 * circular prints. Where it is not, the gaps are what matter — a grade that is
 * priced at 79 of 80 locations is the shape the HMEL and IOCL defects both
 * had, and it is invisible in a total.
 *
 * Read-only.
 *
 *   npx ts-node -r tsconfig-paths/register src/tools/completeness.ts <dir> [dir2]
 */

import { readFileSync } from "node:fs";

type Zones = Record<string, Record<string, number>>;

function report(dir: string) {
  const index = JSON.parse(readFileSync(`${dir}/price_index.json`, "utf8"));
  const n = (v: number) => v.toLocaleString("en-IN");

  console.log("=".repeat(94));
  console.log(`${dir}    effective ${index.effective_date}`);
  console.log("=".repeat(94));
  console.log(
    `${"producer".padEnd(8)}${"zones".padStart(7)}${"grades".padStart(8)}${"expected".padStart(10)}` +
      `${"actual".padStart(9)}${"missing".padStart(9)}${"dupes".padStart(7)}   status`,
  );

  for (const [producer, entry] of Object.entries(index.producers) as Array<[string, any]>) {
    const zones = entry.zones as Zones;
    const zoneNames = Object.keys(zones);
    const grades = new Set<string>();
    for (const cells of Object.values(zones)) for (const g of Object.keys(cells)) grades.add(g);

    const expected = zoneNames.length * grades.size;
    let actual = 0;
    for (const cells of Object.values(zones)) actual += Object.keys(cells).length;

    // A duplicate assignment cannot survive into a JSON object, so what is
    // detectable here is the shape it leaves: a zone short of the full set.
    const shortZones: Array<[string, number]> = [];
    for (const [z, cells] of Object.entries(zones)) {
      const missing = grades.size - Object.keys(cells).length;
      if (missing) shortZones.push([z, missing]);
    }
    const gradeGaps = new Map<string, number>();
    for (const g of grades) {
      let absent = 0;
      for (const cells of Object.values(zones)) if (cells[g] === undefined) absent++;
      if (absent) gradeGaps.set(g, absent);
    }

    const status = expected === actual ? "complete" : "RAGGED";
    console.log(
      `${producer.padEnd(8)}${String(zoneNames.length).padStart(7)}${String(grades.size).padStart(8)}` +
        `${n(expected).padStart(10)}${n(actual).padStart(9)}${n(expected - actual).padStart(9)}` +
        `${"0".padStart(7)}   ${status}`,
    );
    if (shortZones.length) {
      const shown = shortZones.slice(0, 6).map(([z, m]) => `${z} (-${m})`).join(", ");
      console.log(`         zones short of the full set: ${shortZones.length} — ${shown}${shortZones.length > 6 ? " ..." : ""}`);
    }
    if (gradeGaps.size) {
      const shown = [...gradeGaps].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([g, c]) => `${g} (absent at ${c})`).join(", ");
      console.log(`         grades not priced everywhere: ${gradeGaps.size} — ${shown}${gradeGaps.size > 8 ? " ..." : ""}`);
    }
  }
  console.log();
}

for (const dir of process.argv.slice(2)) report(dir);
