/**
 * The question the product exists to answer, end to end:
 *
 *   "Customer in Pune wants 120 MT of B52A003 with 14-day credit.
 *    How does GAIL compare against RIL, OPaL, HMEL, IOCL and HPL?"
 *
 * Run:  node engine/demo.ts [grade] [location] [quantityMt] [cash|credit_ifc]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compare, useSpellings, type Dataset } from "./pricing.ts";
import type { PaymentMode } from "./types.ts";

const DATA = join(import.meta.dirname, "..", "data", "normalized");
const read = (name: string) =>
  JSON.parse(readFileSync(join(DATA, `${name}.json`), "utf8"));

const locations = read("locations");
useSpellings(locations.spellings ?? {});

const data: Dataset = {
  priceIndex: read("price_index"),
  freight: read("freight"),
  discounts: read("discounts"),
  crossref: read("crossref"),
};

const [grade = "B52A003", location = "PUNE", qty = "120", mode = "credit_ifc"] =
  process.argv.slice(2);

const result = compare(
  data,
  grade,
  location,
  Number(qty),
  mode as PaymentMode,
);

const entry = data.crossref.index[grade];
const rupees = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

console.log(
  `\n${grade}${entry ? ` · ${entry.application} · ${entry.characteristic}` : ""}`,
);
console.log(
  `${location} · ${qty} MT · ${mode === "cash" ? "cash" : "14-day credit"}` +
    ` · prices w.e.f. ${data.priceIndex.effective_date}\n`,
);

const head = [
  "producer".padEnd(9),
  "grade".padEnd(12),
  "basis".padEnd(10),
  "basic".padStart(9),
  "CD".padStart(6),
  "freight".padStart(8),
  "landed".padStart(9),
  "QD".padStart(6),
  "net".padStart(9),
  "  zone",
].join(" ");
console.log(head);
console.log("-".repeat(head.length));

const ordered = [...result.quotes].sort((a, b) => {
  if (a.invoiceLanded === null) return 1;
  if (b.invoiceLanded === null) return -1;
  return a.invoiceLanded - b.invoiceLanded;
});

for (const q of ordered) {
  const mark = q.producer === "GAIL" ? "*" : " ";
  console.log(
    [
      (mark + q.producer).padEnd(9),
      (q.grade ?? "—").padEnd(12),
      (q.basis ?? "—").padEnd(10),
      rupees(q.basic).padStart(9),
      rupees(q.cashDiscount).padStart(6),
      rupees(q.freight).padStart(8),
      rupees(q.invoiceLanded).padStart(9),
      rupees(q.quantityDiscount).padStart(6),
      rupees(q.effectiveNet).padStart(9),
      `  ${q.zone ?? "—"}${q.locationTier === "exact" ? "" : ` (${q.locationTier})`}`,
    ].join(" "),
  );
}

console.log();
if (result.gapToLeader !== null && result.leader) {
  const gap = result.gapToLeader;
  console.log(
    gap > 0
      ? `GAIL is #${result.gailRank} — ${result.leader.producer} is cheaper by Rs ${rupees(gap)}/MT` +
          `  (Rs ${rupees(gap * Number(qty))} on ${qty} MT)`
      : `GAIL is cheapest by Rs ${rupees(-gap)}/MT against ${result.leader.producer}`,
  );
  if (gap > 0) {
    console.log(
      `To match: cut Rs ${rupees(gap)}/MT.   To lead: cut Rs ${rupees(gap + 1)}/MT.`,
    );
  }
}

const gapsSeen = result.quotes.flatMap((q) => q.gaps);
if (gapsSeen.length) {
  console.log("\nnot priced:");
  for (const gap of [...new Set(gapsSeen)]) console.log(`  - ${gap}`);
}
for (const warning of result.warnings) console.log(`\n! ${warning}`);
