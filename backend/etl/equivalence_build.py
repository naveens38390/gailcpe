"""Check `reference/location_equivalence.json` against `reference/geodata.json`.

Scope note (deviation from the WP1 design in docs/location-fallback/06-implementation-plan.md
4.2, reported to the client alongside PR1): the design calls this a "builder ... so the next
round can be re-derived." What ships here is a **verifier**, not a re-derivation pipeline. The
full candidate-generation logic -- state-wide / HPL-district / nearest-zone rules (S/H/N), HPL
corroboration, the retained-live rule, ambiguity detection, the 62-row impact analysis -- lives
only in a session scratchpad (the design doc already flags that scratchpad-only state as a risk,
section 4.2). Porting that whole pipeline into the repo was out of reach for this change; doing
it properly is its own piece of work, not something to fold in silently here. What this script
gives instead: proof that the shipped table's own distance_km and crosses_state figures follow
from the shipped coordinates, so a reviewer can audit the arithmetic without trusting the
scratchpad. Re-deriving next round's *candidate set* from a new GeoNames pull still needs that
scratchpad pipeline rebuilt properly -- tracked as a follow-up, not done by this file.

Read-only. Exit code 0 if every check passes, 1 otherwise -- usable as a build gate later, but
not wired into build.py (that gate is equivalence.py's job, at load time, per WP2).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

REF = Path(__file__).resolve().parent / "reference"
DISTANCE_TOLERANCE_KM = 2  # location_equivalence.json stores round(haversine_km)


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    dphi, dlmb = p2 - p1, math.radians(lo2 - lo1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def load() -> tuple[list[dict], dict]:
    equivalence = json.loads((REF / "location_equivalence.json").read_text(encoding="utf-8"))
    geodata = json.loads((REF / "geodata.json").read_text(encoding="utf-8"))
    return equivalence, geodata


def check_distances(equivalence: list[dict], geodata: dict) -> list[str]:
    """Recompute distance_km from geodata.json's own coordinates for every row that names a
    point-scope zone, and flag anything that doesn't match within rounding."""
    problems = []
    towns, zones = geodata["towns"], geodata["zones"]
    for r in equivalence:
        if r["evidence"] == "retained_live_hpl_hub":
            continue  # not geocoded against this round's table; carried over as-is (9.3)
        town = towns.get(r["town"])
        zone = zones.get(f"{r['producer']}|{r['zone']}")
        if town is None or zone is None or zone.get("lat") is None:
            continue  # state-scope or unlocated zone: no single point to check against
        got = haversine_km((town["lat"], town["lon"]), (zone["lat"], zone["lon"]))
        if abs(got - r["distance_km"]) > DISTANCE_TOLERANCE_KM:
            problems.append(
                f"{r['producer']} {r['town']} -> {r['zone']}: table says {r['distance_km']} km, "
                f"geodata.json gives {got:.1f} km"
            )
    return problems


def check_crosses_state(equivalence: list[dict], geodata: dict) -> list[str]:
    problems = []
    towns, zones = geodata["towns"], geodata["zones"]
    for r in equivalence:
        if r["evidence"] == "retained_live_hpl_hub":
            continue
        town = towns.get(r["town"])
        zone = zones.get(f"{r['producer']}|{r['zone']}")
        if town is None or zone is None:
            continue
        zone_state = zone.get("state")
        if not isinstance(zone_state, str):
            continue  # a state-scope zone lists multiple states; not a single-state comparison
        expected = town["state"] != zone_state
        if expected != r["crosses_state"]:
            problems.append(
                f"{r['producer']} {r['town']} ({town['state']}) -> {r['zone']} ({zone_state}): "
                f"table says crosses_state={r['crosses_state']}, geodata.json implies {expected}"
            )
    return problems


def check_coverage(equivalence: list[dict], geodata: dict) -> list[str]:
    """Every town and every point-scope zone the table cites should have a geodata.json entry --
    a gap here means the round that produced the table used a coordinate that never got committed."""
    problems = []
    towns, zones = geodata["towns"], geodata["zones"]
    for r in equivalence:
        if r["town"] not in towns:
            problems.append(f"{r['town']}: no coordinate in geodata.json 'towns'")
        key = f"{r['producer']}|{r['zone']}"
        if key not in zones:
            problems.append(f"{key}: no coordinate in geodata.json 'zones'")
    return problems


def main() -> int:
    equivalence, geodata = load()
    print(f"location_equivalence.json: {len(equivalence)} rows")
    print(f"geodata.json: {len(geodata['towns'])} towns, {len(geodata['zones'])} zones")

    all_problems: list[tuple[str, list[str]]] = [
        ("coverage", check_coverage(equivalence, geodata)),
        ("distance_km", check_distances(equivalence, geodata)),
        ("crosses_state", check_crosses_state(equivalence, geodata)),
    ]
    ok = True
    for name, problems in all_problems:
        if problems:
            ok = False
            print(f"\n{name}: {len(problems)} problem(s)")
            for p in problems[:20]:
                print(f"  {p}")
            if len(problems) > 20:
                print(f"  ... and {len(problems) - 20} more")
        else:
            print(f"{name}: OK")

    print("\nPASS" if ok else "\nFAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
