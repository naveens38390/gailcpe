"""Could a month-on-month drift check see what the shape gates cannot?

corruption_probe.py shows the gates are blind to a mispairing that keeps every
dimension. The question that follows is whether anything cheap could catch it.

A price list does not move much between rounds. If the genuine August-to-
September change is small and a mispairing is large, the two are separable and
a drift check is worth building. If they overlap, it is not, and the honest
answer is that this class needs a different defence.

Read-only.

    py -3 drift_probe.py
"""

from __future__ import annotations

import copy
import json
import statistics
from pathlib import Path

AUG = json.loads(Path("D:/Gail2/staged/etl-dryrun/price_index.json").read_text(encoding="utf-8"))
SEP = json.loads(Path("D:/Gail2/staged/sept/price_index.json").read_text(encoding="utf-8"))


def moves(a: dict, b: dict, producer: str) -> list[float]:
    """Percentage move of every cell present in both rounds."""
    za = a["producers"][producer]["zones"]
    zb = b["producers"][producer]["zones"]
    out = []
    for zone, cells in zb.items():
        prior = za.get(zone)
        if not prior:
            continue
        for grade, value in cells.items():
            was = prior.get(grade)
            if was:
                out.append(abs(value - was) / was * 100.0)
    return out


def rotate(index: dict, producer: str, by: int = 1) -> dict:
    out = copy.deepcopy(index)
    zones = out["producers"][producer]["zones"]
    for zone, cells in zones.items():
        grades = list(cells)
        values = [cells[g] for g in grades]
        zones[zone] = dict(zip(grades, values[by:] + values[:by]))
    return out


def describe(label: str, values: list[float]) -> None:
    if not values:
        print(f"  {label:<34} no comparable cells")
        return
    values = sorted(values)
    p50 = statistics.median(values)
    p95 = values[int(len(values) * 0.95)]
    over2 = sum(1 for v in values if v > 2.0) / len(values) * 100
    over5 = sum(1 for v in values if v > 5.0) / len(values) * 100
    print(f"  {label:<34} n={len(values):>6}  median {p50:6.2f}%  p95 {p95:6.2f}%  "
          f"over 2% {over2:5.1f}%  over 5% {over5:5.1f}%")


print("=" * 96)
print("MONTH-ON-MONTH DRIFT — is a genuine round separable from a mispaired one?")
print("=" * 96)
print("\nGenuine August -> September change:")
for producer in ("GAIL", "IOCL", "RIL", "HMEL", "HPL", "OPaL"):
    describe(producer, moves(AUG, SEP, producer))

print("\nThe same rounds, with September's columns shifted by one:")
for producer in ("GAIL", "IOCL", "HMEL", "OPaL"):
    describe(f"{producer} (mispaired)", moves(AUG, rotate(SEP, producer), producer))

print("\n" + "=" * 96)
genuine = [v for p in ("GAIL", "IOCL", "RIL", "HMEL", "HPL", "OPaL") for v in moves(AUG, SEP, p)]
worst_genuine = max(genuine)
print(f"largest genuine month-on-month move across all six producers: {worst_genuine:.2f}%")
for producer in ("GAIL", "IOCL", "HMEL", "OPaL"):
    m = moves(AUG, rotate(SEP, producer), producer)
    beyond = sum(1 for v in m if v > worst_genuine)
    print(f"  {producer} mispaired: {beyond} of {len(m)} cells move further than any genuine cell did"
          f"  ({beyond / len(m) * 100:.1f}%)")
