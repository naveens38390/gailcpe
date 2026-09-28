"""Load and apply the Ex-Works nearest-location fallback (decision 0010, docs/location-fallback).

`reference/location_equivalence.json` is a reviewed, committed table, not a computation this
module performs: the ranking of candidate zones, HPL corroboration, the retained-live rule and
the 62-row impact analysis all happened once, offline, and were approved before this table was
committed (see docs/location-fallback/06-implementation-plan.md section 4.2 and
09-release-impact-summary.md). This module's job is narrower — load it, gate it, and merge it
into `build.py`'s coverage the same way every other source file here is gated before use.
"""

from __future__ import annotations

import json
from pathlib import Path

REF = Path(__file__).resolve().parent / "reference"

# Option 3, approved 2026-09-22: 1,016 newly-approved rows + 60 retained-live rows
# (docs/location-fallback/09-release-impact-summary.md). A different count means the table
# was regenerated without carrying that approval through — stop rather than load a set nobody
# has reviewed.
EXPECTED_ROWS = 1130

SOURCE_OF_TIER = {
    "state_zone": "state_zone",
    "published_map": "annexure_v",
    "inferred_location": "nearest",
}

# The marker the reference table carries on the 60 option-3 rows (today's live mapping, kept).
RETAINED_EVIDENCE = "retained_live_hpl_hub"


def validate(
    equivalence: list[dict], review: list[dict], gail_locations: list[str],
    resolvers: dict, coverage: dict[str, dict],
) -> list[str]:
    """The build gates, as a pure function so break_test.py can probe each one against a
    synthetic table without touching the committed file. Returns problem strings; empty means
    the table passes. `resolvers` are this round's WORKS resolvers (producer -> Resolver);
    `coverage` is this round's pre-merge `{producer: r.coverage(gail_locations)}`, used only to
    check for an overwrite — nothing here mutates it."""
    if len(equivalence) != EXPECTED_ROWS:
        return [
            f"reference/location_equivalence.json has {len(equivalence)} rows, expected "
            f"{EXPECTED_ROWS} (the approved Option 3 set: 1,016 new + 60 retained-live, plus HMEL Mundra "
            "added by the client decision of 2026-09-26, plus 53 coverage-audit rows approved 2026-09-28). "
            "Stopping rather than loading a set that does not match what was reviewed."
        ]

    held_pairs = {(r["producer"], r["town"]) for r in review}
    canonical = set(gail_locations)
    problems: list[str] = []
    for r in equivalence:
        problems.extend(_row_problems(r, held_pairs, canonical, resolvers, coverage))
    return problems


def _row_problems(
    r: dict, held_pairs: set[tuple[str, str]], canonical: set[str],
    resolvers: dict, coverage: dict[str, dict],
) -> list[str]:
    """The per-row gates, split out from `validate` so break_test.py can probe each one against
    a single synthetic row without needing a 1,076-row table to satisfy the count gate first."""
    problems: list[str] = []
    # Retained-live rows (Option 3, docs/location-fallback/09-release-impact-summary.md) are a
    # separate decision from the new analysis review.json classifies — "keep this town's
    # existing live price" and "this town is a held candidate for a NEW fallback mapping" are
    # not contradictory, so retained rows are exempt from the held-pair check.
    if r["evidence"] != "retained_live_hpl_hub" and (r["producer"], r["town"]) in held_pairs:
        problems.append(f"{r['producer']} {r['town']}: also listed in location_equivalence.review.json")
    if r["town"] not in canonical:
        problems.append(f"{r['producer']} {r['town']}: not one of GAIL's canonical locations")
    if r["tier"] not in SOURCE_OF_TIER:
        problems.append(f"{r['producer']} {r['town']}: unknown tier {r['tier']!r}")
    if r.get("basis") == "ex_depot":
        problems.append(f"{r['producer']} {r['town']}: ex-depot row (fallback is Ex-Works only)")
    resolver = resolvers.get(r["producer"])
    if resolver is not None and r["zone"] not in resolver.names:
        problems.append(
            f"{r['producer']} {r['town']} -> {r['zone']}: not a zone {r['producer']} "
            "publishes this round"
        )
    cov = coverage.get(r["producer"])
    if cov is not None and r["town"] in cov["map"] and cov["map"][r["town"]] != r["zone"]:
        # Agreement is expected and harmless — HPL's own published_map rows (rule H: the town's
        # name is itself an Annexure V district) resolve to the same zone with no merge needed
        # at all (the "no-op" rows in 09-release-impact-summary.md's operation count). A
        # *different* zone is the real problem: the table disagrees with a direct match.
        problems.append(
            f"{r['producer']} {r['town']}: already resolved this round via "
            f"{cov['tier_of'][r['town']]} ({cov['map'][r['town']]!r}), which disagrees with "
            f"the approved table's {r['zone']!r} — a direct match must never be overridden"
        )
    return problems


def load(gail_locations: list[str], resolvers: dict, coverage: dict[str, dict]) -> list[dict]:
    """Read `location_equivalence.json` and fail the build if it disagrees with this round.

    `resolvers` are this round's WORKS resolvers (producer -> Resolver); `coverage` is this
    round's pre-merge `{producer: r.coverage(gail_locations)}`.
    """
    equivalence = json.loads((REF / "location_equivalence.json").read_text(encoding="utf-8"))
    review = json.loads((REF / "location_equivalence.review.json").read_text(encoding="utf-8"))

    problems = validate(equivalence, review, gail_locations, resolvers, coverage)
    if problems:
        raise SystemExit(
            "\nreference/location_equivalence.json failed its build gates:\n"
            + "\n".join(f"  {p}" for p in problems[:30])
            + (f"\n  ... and {len(problems) - 30} more\n" if len(problems) > 30 else "\n")
        )

    return equivalence


def merge(coverage: dict[str, dict], equivalence: list[dict]) -> dict:
    """Fill `coverage[producer]['map'/'tier_of']` from the approved table, only where this
    round's resolver found nothing (WP2a drops `add_cluster_hubs` from the works resolvers, so
    "nothing" means no exact/alias/evidence/published_map match — the fallback table is the
    only remaining source of an inferred mapping). Never overwrites an existing entry.

    Returns `location_meta`: {producer: {town: {km, crossesState, corroborated, source,
    supplied}}} for every row of the approved table — the approved *Competitor Presence and
    Fallback Mapping* workbook (2026-09-25) shows a distance and classification for all 1,076 (1,077 since the
    client decision of 2026-09-26 added HMEL Mundra),
    including the 97 where the table only confirms a zone the resolver already found natively.
    `supplied` separates the two: true where this merge filled a gap, false where it confirmed an
    existing match (`fix-hpl-territory.ts` relies on it to leave M1's rows alone). `source` is
    `retained` for the 60 option-3 rows, which the workbook classifies as Retained Existing
    Mapping. A direct match that is not in the table (exact/alias/evidence) gets no entry.
    """
    location_meta: dict[str, dict[str, dict]] = {}
    added = 0
    for r in equivalence:
        producer, town = r["producer"], r["town"]
        cov = coverage.get(producer)
        if cov is None:
            continue
        # validate() has already rejected a row whose zone disagrees with a direct match, so a
        # town already in the map here holds exactly this row's zone.
        supplied = town not in cov["map"]
        if supplied:
            cov["map"][town] = r["zone"]
            cov["tier_of"][town] = r["tier"]
            cov["resolved"] += 1
            cov["tiers"][r["tier"]] = cov["tiers"].get(r["tier"], 0) + 1
            if town in cov["missing"]:
                cov["missing"].remove(town)
            added += 1
        location_meta.setdefault(producer, {})[town] = {
            "km": r["distance_km"],
            "crossesState": r["crosses_state"],
            "corroborated": r["corroborated_by_hpl"],
            "source": "retained" if r["evidence"] == RETAINED_EVIDENCE else SOURCE_OF_TIER[r["tier"]],
            "supplied": supplied,
        }
    return {"added": added, "location_meta": location_meta}
