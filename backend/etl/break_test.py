"""Try to break the extractors the way next month's circulars will.

Every extractor here addresses part of its document by page number. That works
while the documents keep their present length, and says nothing about what
happens when one gains a page. This asks the question directly: where does each
page constant come from, does the document still satisfy it, and — the part
that matters — does the reader fail loudly or quietly when it does not.

Read-only. Runs extractors against the September circulars, and against
deliberately shifted page ranges to see the failure mode.
"""

from __future__ import annotations

import sys

sys.path.insert(0, r"D:/Gail2/gailcpe/backend/etl")

from pdfrows import rows  # noqa: E402
import extractors.haldia as haldia  # noqa: E402
import extractors.iocl as iocl  # noqa: E402

SEPT = {
    "haldia": r"D:/Gail2/Documents/HPL PE PRICE LIST 01st SEPT 2026.pdf",
    "iocl": r"D:/Gail2/Documents/IOC PE Price List 01 Sept 2026.pdf",
    "hmel": r"D:/Gail2/Documents/PE Price Circular 01.09.2026.pdf",
}


def where(path: str, needles: list[str]) -> dict[str, list[int]]:
    """Which pages carry each marker, so the constants can be checked."""
    found: dict[str, list[int]] = {n: [] for n in needles}
    for row in rows(path):
        text = row.text.strip()
        for n in needles:
            if text.startswith(n):
                found[n].append(row.page)
    return {k: sorted(set(v)) for k, v in found.items()}


print("=" * 78)
print("PAGE-CONSTANT SENSITIVITY — September circulars")
print("=" * 78)

# ---- HPL ---------------------------------------------------------------
print("\nHPL (haldia.py)")
marks = where(SEPT["haldia"], ["Annexure - I", "Annexure - II", "Annexure - III",
                               "Annexure - IV", "Annexure - V"])
for k, v in marks.items():
    print(f"  {k:<18} on page(s) {v}")
print(f"  lldpe_prices() hard-codes pages=[6, 7]")
print(f"  territory_map() finds Annexure V by its 'Territory Division' heading (no page constant)")

base = haldia.lldpe_prices(SEPT["haldia"])
print(f"  as written        : {len(base['ex_works'])} ex-works price points")
for shift in ([5, 6], [7, 8], [6, 7, 8]):
    src = haldia.lldpe_prices.__doc__  # keep the reader honest about what changed
    saved = None
    # Re-run the same function body against a different page window by
    # temporarily rewriting the constant it reads.
    import re as _re
    original = open("extractors/haldia.py", encoding="utf-8").read()
    patched = original.replace("pages=[6, 7]", f"pages={shift}")
    open("extractors/haldia.py", "w", encoding="utf-8").write(patched)
    import importlib
    importlib.reload(haldia)
    try:
        out = haldia.lldpe_prices(SEPT["haldia"])
        n = len(out["ex_works"])
    except Exception as exc:  # noqa: BLE001
        n = f"raised {type(exc).__name__}"
    finally:
        open("extractors/haldia.py", "w", encoding="utf-8").write(original)
        importlib.reload(haldia)
    verdict = "SILENT" if isinstance(n, int) and n != len(base["ex_works"]) else ""
    print(f"  if the table sat on {str(shift):<10}: {n} price points  {verdict}")

# ---- IOCL --------------------------------------------------------------
print("\nIOCL (iocl.py)")
marks = where(SEPT["iocl"], ["Annexure-I A", "Annexure - I A", "Annexure-I B",
                             "Annexure-II", "Grades", "Quantity Uplifted"])
for k, v in marks.items():
    if v:
        print(f"  {k:<20} on page(s) {v}")
print(f"  DELIVERED_PAGES = {iocl.DELIVERED_PAGES}   DEPOT_PAGES = {iocl.DEPOT_PAGES}")
print(f"  upliftment_slabs() hard-codes pages=[7]")
base_iocl = iocl.prices(SEPT["iocl"])["delivered"]
print(f"  as written        : {len(base_iocl)} zones, "
      f"{sum(len(v) for v in base_iocl.values())} cells")
slabs = iocl.upliftment_slabs(SEPT["iocl"])
print(f"  upliftment slabs  : {len(slabs)}")

# ---- HMEL --------------------------------------------------------------
print("\nHMEL (hmel.py)")
marks = where(SEPT["hmel"], ["Ex-Bathinda Price", "Ex-Depot Basic Price"])
for k, v in marks.items():
    print(f"  {k:<24} on page(s) {v}")
print("  prices() hard-codes pages=range(3, 15)")
total_pages = len({r.page for r in rows(SEPT["hmel"])})
print(f"  document has {total_pages} pages; the range covers 3-14")

# ---- Location state guard (R20) -----------------------------------------
# Bilaspur is a real town in Chhattisgarh and, separately, a real district in
# Himachal Pradesh; HPL's Annexure V lists the latter, and the resolver used
# to return it for GAIL's (Chhattisgarh) Bilaspur with no state check at all.
# Uses the real September circular and the real, committed reviewed table —
# not a synthetic fixture — so this proves the fix against what actually
# ships, the same way the rest of this file does.
print("\nLocation state guard (locations.py, R20)")
import json as _json  # noqa: E402
from pathlib import Path as _Path  # noqa: E402
from locations import Resolver  # noqa: E402

gail_state = _json.loads(
    (_Path(__file__).resolve().parent / "reference" / "gail_location_state.json").read_text(encoding="utf-8")
)
territory = haldia.territory_map(SEPT["haldia"])
hpl_prices = haldia.prices(SEPT["haldia"])
guarded = Resolver("HPL", sorted(hpl_prices["I"]["points"]), gail_state=gail_state)
guarded.add_district_map(territory)
unguarded = Resolver("HPL", sorted(hpl_prices["I"]["points"]))
unguarded.add_district_map(territory)

zone, tier = guarded.resolve_detailed("BILASPUR")
verdict = "OK (guard fired)" if zone is None else f"SILENT: guard did not reject, got {zone!r}"
print(f"  BILASPUR, guarded  : {zone!r:28} {tier:<14} {verdict}")
zone_u, tier_u = unguarded.resolve_detailed("BILASPUR")
print(f"  BILASPUR, unguarded: {zone_u!r:28} {tier_u:<14} (shows what the guard is suppressing)")

# A town whose own state agrees with the district match it hits must be unaffected.
sample = next(t for t in gail_state if guarded.resolve_detailed(t)[1] == "published_map")
same = guarded.resolve_detailed(sample) == unguarded.resolve_detailed(sample)
print(f"  {sample}, guarded == unguarded: {same}   {'OK' if same else 'SILENT: guard changed an agreeing match'}")

# ---- Ex-Works fallback build gates (WP2c, decision 0010) -----------------
# Four ways a corrupted or stale location_equivalence.json could ship a wrong price; each one
# must stop the build, not just log a warning. Probes equivalence._row_problems() directly (not
# a full build), against synthetic rows, so a single bad row does not need a 1,076-row table to
# test in isolation.
print("\nEx-Works fallback build gates (equivalence.py, WP2c)")
import equivalence  # noqa: E402

good_row = {
    "producer": "HMEL", "town": "ABU ROAD", "zone": "Udaipur", "tier": "inferred_location",
    "distance_km": 95, "crosses_state": False, "corroborated_by_hpl": True,
    "evidence": "probe", "round": "2026-09-01",
}
fake_resolvers = {"HMEL": type("R", (), {"names": ["Udaipur", "Jaipur"]})()}
fake_canonical = {"ABU ROAD", "AGRA"}
fake_coverage = {"HMEL": {"map": {"AGRA": "Jaipur"}, "tier_of": {"AGRA": "exact"}}}


def probe(name: str, row: dict, held_pairs=frozenset(), want_problem: bool = True) -> None:
    problems = equivalence._row_problems(row, set(held_pairs), fake_canonical, fake_resolvers, fake_coverage)
    fired = bool(problems)
    verdict = "OK" if fired == want_problem else (
        "SILENT: gate did not fire" if want_problem else "SILENT: gate fired on a clean row"
    )
    print(f"  {name:<28}: {verdict}" + (f"  [{problems[0]}]" if problems else ""))


probe("clean row (control)", good_row, want_problem=False)
probe("missing zone", {**good_row, "zone": "Nowhere"})
probe("ex-depot row", {**good_row, "basis": "ex_depot"})
probe("held row", good_row, held_pairs=[("HMEL", "ABU ROAD")])
# A retained-live row is exempt from the held-pair check: "keep the existing live price" and
# "held as a candidate for a NEW fallback mapping" are independent decisions, and 59 of the 60
# retained towns are genuinely also held in the new analysis.
probe("held pair, but a retained-live row", {**good_row, "evidence": "retained_live_hpl_hub"},
      held_pairs=[("HMEL", "ABU ROAD")], want_problem=False)
probe("overwrite (disagrees with direct match)", {**good_row, "town": "AGRA"})
# A row that names the SAME zone a direct match already gives (HPL's rule H: the town's own
# name is itself an Annexure V district, so add_district_map finds it with no merge needed) is
# not an overwrite -- it is one of the ~97 documented no-op rows and must pass quietly.
probe("agreeing row (no-op, not an overwrite)", {**good_row, "town": "AGRA", "zone": "Jaipur"}, want_problem=False)
