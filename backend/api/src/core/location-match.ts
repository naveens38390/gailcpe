/**
 * Groups the stored `LocationTier` strings into the three things a customer
 * actually sees, and builds the payload the app renders from — so the app
 * holds no tier logic of its own (decision 0010, §4.1/§6).
 *
 *   exact       — the producer names the town, a known spelling, or a price
 *                 the zonal workbook proves (evidence is proof by price, not
 *                 by name, but earns the same trust)
 *   territory   — HPL's own Annexure V district list, or a producer's own
 *                 whole-state zone (IOCL Kerala, HMEL Punjab, ...)
 *   inferred    — nearest published zone; own state preferred. Carries a
 *                 caveat because it is not what the producer actually said
 *                 about this town, only about a town near it
 *   none        — unresolved; no price shown
 *
 * `inferred_via_hpl` is a read-only legacy alias: the ETL never writes it
 * after the fallback table exists (`build.py` WP2a), but stored
 * `comparisonHistory` / `dealSimulations` records keep it forever (they are
 * saved as served, never migrated), so every reader has to keep understanding it.
 */

import type { LocationMatch, LocationMeta, LocationTier } from "./types";

export type TierGroup = "exact" | "territory" | "inferred" | "none";

const GROUP_OF: Record<LocationTier, TierGroup> = {
  exact: "exact",
  alias: "exact",
  evidence: "exact",
  published_map: "territory",
  state_zone: "territory",
  inferred_location: "inferred",
  inferred_via_hpl: "inferred",
  unresolved: "none",
};

/** An unrecognised tier (future data, a bad read) groups as `none` rather than guessed as a match. */
export function tierGroup(tier: LocationTier): TierGroup {
  return GROUP_OF[tier] ?? "none";
}

export const TIER_LABEL: Record<TierGroup, string> = {
  exact: "Exact Published Match",
  territory: "Territory Match",
  inferred: "Inferred Location Match",
  none: "",
};

/**
 * The payload a `Quote` carries so the app can render the right label and
 * caveat without knowing what a `LocationTier` string means. `undefined` when
 * there is no zone at all (`unresolved`) — nothing to report.
 */
export function buildLocationMatch(
  tier: LocationTier,
  zone: string | null,
  meta?: LocationMeta,
): LocationMatch | undefined {
  if (!zone) return undefined;
  const group = tierGroup(tier);
  if (group === "none") return undefined;
  const match: LocationMatch = { group, label: TIER_LABEL[group], matchedZone: zone };
  if (meta) {
    if (meta.km !== null && meta.km !== undefined) match.distanceKm = meta.km;
    if (meta.crossesState !== undefined) match.crossesState = meta.crossesState;
    if (meta.corroborated !== undefined) match.corroborated = meta.corroborated;
    if (meta.source !== undefined) match.source = meta.source;
  }
  return match;
}

/**
 * The Compare-card caveat for one inferred quote: names the producer, the
 * matched zone and the distance, and flags a state crossing — the wording
 * proposed in decision 0010 §7, e.g. "IOCL is priced at Mumbai (58 km from
 * Khopoli)." `location` is the customer's own town, as typed/canonicalised.
 */
export function inferredCaveat(
  producer: string,
  location: string,
  match: LocationMatch,
): string {
  const distance = match.distanceKm !== undefined ? ` (${match.distanceKm} km from ${location})` : "";
  const cross = match.crossesState ? "; crosses into another state" : "";
  return `${producer} is priced at ${match.matchedZone}${distance}${cross}`;
}
