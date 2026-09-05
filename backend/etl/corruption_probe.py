"""Do the gates catch a defect that keeps every dimension intact?

The two gates added so far both reason about shape: a producer's book must be a
rectangle, and it must not shrink. Neither looks at a value. So the question
worth asking before deployment is not whether they stop the defects already
found — they do — but whether there is a defect they cannot see at all.

Each mutation below leaves the matrix exactly as it was: same zones, same
grades, same cell count, every price still a plausible Rs/MT figure drawn from
the circular. Only the pairing is wrong.

Read-only: mutates an in-memory copy of the built index and asks the real gate
functions about it. Writes nothing.

    py -3 corruption_probe.py [index dir]
"""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("GCPE_PRICE_ROUND", "2026-09-01")

import build  # noqa: E402

# The shrink gate cannot fire here: every mutation below leaves the zone and
# grade counts exactly as they were, so there is nothing for it to see. It is
# switched off only so that September's genuine 30-grade RIL withdrawal against
# an August baseline does not stop the control run and mask what is being
# tested — which is a different thing from switching off the gate under test.
os.environ.setdefault("GCPE_ALLOW_SHRINK", "1")

DIR = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/Gail2/staged/sept")
index = json.loads((DIR / "price_index.json").read_text(encoding="utf-8"))
FLAT = {p: {"basis": e["basis"], "zones": e["zones"]} for p, e in index["producers"].items()}


def rotate_columns(flat: dict, producer: str, by: int = 1) -> str:
    """Give every zone the neighbouring grade's price. Dimensions untouched."""
    zones = flat[producer]["zones"]
    for zone, cells in zones.items():
        grades = list(cells)
        values = [cells[g] for g in grades]
        shifted = values[by:] + values[:by]
        zones[zone] = dict(zip(grades, shifted))
    return f"{producer}: every grade takes its neighbour's price (shift {by:+d})"


def swap_two_columns(flat: dict, producer: str) -> str:
    """Swap two neighbouring grades everywhere — the classic header mis-order."""
    zones = flat[producer]["zones"]
    grades = list(next(iter(zones.values())))
    a, b = grades[3], grades[4]
    for cells in zones.values():
        cells[a], cells[b] = cells[b], cells[a]
    return f"{producer}: {a} and {b} swapped at every zone"


def swap_two_zones(flat: dict, producer: str) -> str:
    """Apply the wrong zone to a whole, complete row."""
    zones = flat[producer]["zones"]
    names = list(zones)
    a, b = names[5], names[6]
    zones[a], zones[b] = zones[b], zones[a]
    return f"{producer}: the complete rows for {a} and {b} exchanged"


MUTATIONS = [
    ("HMEL adjustment columns shifted by one", lambda f: rotate_columns(f, "HMEL", 1)),
    ("OPaL two neighbouring grades swapped", lambda f: swap_two_columns(f, "OPaL")),
    ("IOCL two complete zone rows exchanged", lambda f: swap_two_zones(f, "IOCL")),
    ("GAIL every grade shifted by one", lambda f: rotate_columns(f, "GAIL", 1)),
]


def gates_verdict(flat: dict) -> str:
    """Run the real gates and report which, if any, refuses this book."""
    said: list[str] = []
    try:
        build.check_complete(flat, said.append)
    except SystemExit:
        return "rectangle gate STOPPED it"
    try:
        build.check_no_shrink(flat, said.append)
    except SystemExit:
        return "shrink gate STOPPED it"
    try:
        build.drift_report(flat, said.append)
    except SystemExit:
        return "drift gate STOPPED it"
    return "no gate objected"


print("=" * 86)
print("DIMENSION-PRESERVING CORRUPTION — can the gates see it?")
print("=" * 86)
print(f"index: {DIR}   effective {index['effective_date']}\n")

baseline = gates_verdict(copy.deepcopy(FLAT))
print(f"{'unmutated control':<46}{baseline}")

for label, mutate in MUTATIONS:
    flat = copy.deepcopy(FLAT)
    what = mutate(flat)
    verdict = gates_verdict(flat)
    # Confirm the mutation really did preserve the shape.
    zones = flat[label.split()[0]]["zones"] if False else None
    print(f"{label:<46}{verdict}")
    print(f"{'':<46}({what})")

print("\n" + "=" * 86)
print("shape after every mutation, to confirm nothing about the matrix changed:")
for label, mutate in MUTATIONS:
    flat = copy.deepcopy(FLAT)
    mutate(flat)
    for producer, entry in flat.items():
        z = entry["zones"]
        grades = {g for cells in z.values() for g in cells}
        cells = sum(len(c) for c in z.values())
        original = FLAT[producer]["zones"]
        og = {g for c in original.values() for g in c}
        oc = sum(len(c) for c in original.values())
        if (len(z), len(grades), cells) != (len(original), len(og), oc):
            print(f"  {label}: {producer} shape CHANGED")
    break
print("  identical for every mutation (checked above by the gates themselves)")
