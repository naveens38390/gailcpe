/**
 * Deal Simulator — the screen a sales officer actually opens.
 *
 * `compare()` says where GAIL stands. This says what to do about it, and what
 * that costs. Both come from the same netback ladder, so the recommendation can
 * never disagree with the comparison shown above it.
 *
 * The options are deliberately priced against the *cheapest competitor that can
 * actually be quoted*, not against an average. A customer negotiates with the
 * best offer they have in hand.
 */

import type {
  Comparison,
  DealOption,
  DealOutcome,
  DealSimulation,
  PaymentMode,
  Quote,
} from "./types";
import { compare, type Dataset } from "./pricing";

/** Rupees per MT by which GAIL must undercut to be unambiguously cheapest. */
const LEAD_MARGIN = 50;

function outcomeOf(gap: number | null): DealOutcome {
  if (gap === null) return "not_priced";
  if (gap <= -LEAD_MARGIN) return "leading";
  if (gap <= 0) return "matched";
  return "behind";
}

function buildOptions(
  gail: Quote,
  gap: number,
  quantityMt: number,
): DealOption[] {
  const landed = gail.invoiceLanded!;
  const options: DealOption[] = [];

  const add = (label: string, correction: number, recommended = false) => {
    const after = landed - correction;
    const gapAfter = Math.round((gap - correction) * 100) / 100;
    options.push({
      label,
      correctionPerMt: Math.round(correction * 100) / 100,
      gailLanded: Math.round(after * 100) / 100,
      gapAfter,
      outcome: outcomeOf(gapAfter),
      totalCost: Math.round(correction * quantityMt * 100) / 100,
      recommended,
    });
  };

  add("Hold price", 0);
  // A partial concession is worth showing precisely because it loses: an
  // officer who offers half the gap has spent margin and still lost the order.
  if (gap > 2 * LEAD_MARGIN) {
    add("Partial concession (half the gap)", Math.round(gap / 2));
  }
  add("Match the leader", gap);
  add("Undercut the leader", gap + LEAD_MARGIN, true);

  return options;
}

export function simulate(
  data: Dataset,
  grade: string,
  location: string,
  quantityMt: number,
  paymentMode: PaymentMode,
  customer: string | null = null,
): DealSimulation {
  const comparison: Comparison = compare(
    data,
    grade,
    location,
    quantityMt,
    paymentMode,
  );

  const gail = comparison.gail;
  const leader = comparison.leader;
  const gap = comparison.gapToLeader;

  const narrative: string[] = [];
  const caveats: string[] = [...comparison.warnings];
  let options: DealOption[] = [];

  if (!gail || gail.invoiceLanded === null) {
    narrative.push(
      `GAIL cannot be priced for ${grade} at ${location} from the current circular.`,
    );
    for (const gapText of gail?.gaps ?? []) narrative.push(gapText);
  } else if (!leader || gap === null) {
    narrative.push(
      `No competitor can be priced for ${grade} at ${location}, so there is no gap to close.`,
    );
    narrative.push(
      "Treat this as an open field rather than a win — the competition is unpriced, not absent.",
    );
  } else {
    options = buildOptions(gail, gap, quantityMt);
    const rupees = (n: number) =>
      `Rs ${Math.round(n).toLocaleString("en-IN")}`;

    if (gap > 0) {
      narrative.push(
        `${leader.producer} lands at ${rupees(leader.invoiceLanded!)}/MT against GAIL's ${rupees(gail.invoiceLanded)}/MT — a gap of ${rupees(gap)}/MT.`,
      );
      narrative.push(
        `Closing it on ${quantityMt} MT costs ${rupees(gap * quantityMt)}; undercutting costs ${rupees((gap + LEAD_MARGIN) * quantityMt)}.`,
      );
      // Where the gap comes from decides whether price is even the right lever.
      if (
        gail.basis === "ex_works" &&
        leader.basis === "delivered" &&
        gail.freight !== null &&
        gail.freight > gap
      ) {
        narrative.push(
          `The gap is smaller than GAIL's ${rupees(gail.freight)}/MT freight to this location — a depot or a freight review may close it more cheaply than a price cut.`,
        );
      } else if (gail.basic !== null && leader.basic !== null && gail.basic < leader.basic) {
        narrative.push(
          `GAIL's basic price is already the lower of the two; the gap is created after the basic price, not by it.`,
        );
      }
    } else {
      narrative.push(
        `GAIL is cheapest at ${rupees(gail.invoiceLanded)}/MT, ${rupees(-gap)}/MT under ${leader.producer}.`,
      );
      narrative.push("No correction needed. Defend the position rather than discount into it.");
    }

    if (gail.quantityDiscount === 0 && leader.quantityDiscount > 0) {
      narrative.push(
        `Note: ${leader.producer} also pays ${rupees(leader.quantityDiscount)}/MT as a post-sale quantity credit at ${quantityMt} MT. GAIL's own slab is not in the supplied circulars, so the effective gap may be wider than shown.`,
      );
    }
  }

  // Confidence is about the inputs, not the odds of winning. Saying "80% win
  // probability" from a price list would be invention; saying "this zone was
  // inferred" is a fact the officer can act on.
  const unpriced = comparison.quotes.filter((q) => q.invoiceLanded === null);
  if (unpriced.length) {
    caveats.push(
      `${unpriced.map((q) => q.producer).join(", ")} could not be priced here.`,
    );
  }
  if (gail && gail.quantityDiscount === 0) {
    const status = data.discounts.producers.GAIL?.quantity_slabs_status;
    if (status) caveats.push(`GAIL quantity discount ${status}.`);
  }

  const inferred = comparison.quotes.some(
    (q) => q.locationTier === "inferred_via_hpl",
  );
  const lowConfidenceMapping = comparison.quotes.some(
    (q) => q.mappingConfidence && q.mappingConfidence !== "H",
  );
  const dataConfidence =
    unpriced.length >= 3 || lowConfidenceMapping
      ? "low"
      : inferred || unpriced.length > 0
        ? "medium"
        : "high";

  return {
    customer,
    grade,
    location,
    quantityMt,
    paymentMode,
    comparison,
    outcome: outcomeOf(gap),
    options,
    narrative,
    dataConfidence,
    dataCaveats: [...new Set(caveats)],
  };
}
