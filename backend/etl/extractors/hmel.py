"""HMEL Polysure PE prices (Circular HMEL/Marketing/PE/2026-27/15).

HMEL prices unlike anyone else in the pack: one Ex-Bathinda basic price per
grade, then a per-location "Locational Adjustment" that is *subtracted* from it.

    ex-works price at a location = ex-Bathinda basic - locational adjustment

Verified against the MZO workbook: B0155D basic 141,700 less Bhiwandi 3,930
gives 137,770, and less Daman 3,740 gives 137,960 — both exactly as MZO has
them. Adding the adjustment instead would overstate HMEL by twice the delta and
make it look uncompetitive everywhere.

Pages 3-10 are the plant tables (HDPE/LLDPE x prime/non-prime, two pages each);
pages 11-14 are consignment-stockist warehouse prices, which are flat lists.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import assign_to_columns, rows  # noqa: E402

# B0155D, M0252S, P0142SU, F0050D — a letter, four digits, one or two letters.
GRADE_CODE = re.compile(r"^[A-Z]\d{4}[A-Z]{1,2}$")

# Page furniture that reads as a row label: the circular's title carries a month
# and the word "Price", neither of which appears in an Indian town name.
MASTHEAD = re.compile(
    r"\b(?:January|February|March|April|May|June|July|August|September|October"
    r"|November|December)\b|\bPrice\b",
    re.IGNORECASE,
)

SECTIONS = {
    "Ex-Bathinda Price: HDPE Prime Grades": ("plant", "HDPE", "prime"),
    "Ex-Bathinda Price: HDPE Non-Prime/Off-Spec. Grades": ("plant", "HDPE", "non_prime"),
    "Ex-Bathinda Price: LLDPE Prime Grades": ("plant", "LLDPE", "prime"),
    "Ex-Bathinda Price: LLDPE Non-Prime/Off-Spec. Grades": ("plant", "LLDPE", "non_prime"),
    "Ex-Depot Basic Price: HDPE Prime Grades": ("depot", "HDPE", "prime"),
    "Ex-Depot Basic Price: HDPE Non-Prime/Off-Spec. Grades": ("depot", "HDPE", "non_prime"),
    "Ex-Depot Basic Price: LLDPE Prime Grades": ("depot", "LLDPE", "prime"),
    "Ex-Depot Basic Price: LLDPE Non-Prime/Off-Spec. Grades": ("depot", "LLDPE", "non_prime"),
}


def prices(path: str) -> dict:
    """Return basic prices, locational adjustments, and derived ex-works prices.

    {
      "basic":       {grade: {"price": float, "polymer": str, "quality": str}},
      "adjustments": {location: {grade: float}},
      "ex_works":    {location: {grade: float}},   # basic - adjustment
      "depot":       {location: {grade: float}},
    }
    """
    basic: dict[str, dict] = {}
    adjustments: dict[str, dict[str, float]] = {}
    depot: dict[str, dict[str, float]] = {}

    columns: list[tuple[str, float]] = []
    section = ("plant", "", "")
    in_adjustment = False

    for row in rows(path, pages=range(3, 15)):
        text = row.text.strip()

        found = next((v for k, v in SECTIONS.items() if text.startswith(k)), None)
        if found:
            section, in_adjustment = found, False
            continue

        codes = [(w.text, w.xmid) for w in row.words if GRADE_CODE.match(w.text)]
        if len(codes) >= 3:
            columns = codes
            in_adjustment = False
            continue
        if not columns:
            continue

        if text.startswith("Price (Rs/MT)") or text.startswith("Ex Bathinda Basic"):
            _, values = row.label_and_values()
            for grade, price in assign_to_columns(values, columns).items():
                basic[grade] = {
                    "price": price,
                    "polymer": section[1],
                    "quality": section[2],
                }
            continue
        if text.startswith("Location"):
            in_adjustment = True
            continue

        label, values = row.label_and_values()
        if not values or not label:
            continue
        # The circular's own title — "HMEL PE Price 1st August, 2026" — sits on
        # a row like any other, and the year reads as a locational adjustment.
        # It reached the dataset as a location called "HMEL PE Price 1st
        # August," priced for two grades. A town is not dated.
        if MASTHEAD.search(label):
            continue
        cells = assign_to_columns(values, columns)
        if section[0] == "depot":
            depot.setdefault(label, {}).update(cells)
        elif in_adjustment:
            adjustments.setdefault(label, {}).update(cells)

    ex_works: dict[str, dict[str, float]] = {}
    for location, cells in adjustments.items():
        for grade, adjustment in cells.items():
            if grade in basic:
                ex_works.setdefault(location, {})[grade] = (
                    basic[grade]["price"] - adjustment
                )

    return {
        "basic": basic,
        "adjustments": adjustments,
        "ex_works": ex_works,
        "depot": depot,
    }


def quantity_slabs() -> list[dict]:
    """Section B.3 quantity-discount slabs, transcribed from the circular text.

    The slab table is laid out as two side-by-side columns whose cells wrap
    across rows, so the printed order of numbers does not follow the reading
    order. Transcribing it is more honest than a parser that looks right on
    this one circular and silently mis-pairs the next.
    """
    return [
        {"from_mt": 5, "to_mt": 10, "rate_per_mt": 450},
        {"from_mt": 10, "to_mt": 25, "rate_per_mt": 550},
        {"from_mt": 25, "to_mt": 50, "rate_per_mt": 650},
        {"from_mt": 50, "to_mt": 75, "rate_per_mt": 750},
        {"from_mt": 75, "to_mt": 100, "rate_per_mt": 800},
        {"from_mt": 100, "to_mt": 200, "rate_per_mt": 850},
        {"from_mt": 200, "to_mt": 300, "rate_per_mt": 950},
        {"from_mt": 300, "to_mt": 400, "rate_per_mt": 1050},
        {"from_mt": 400, "to_mt": 500, "rate_per_mt": 1150},
        {"from_mt": 500, "to_mt": 750, "rate_per_mt": 1250},
        {"from_mt": 750, "to_mt": None, "rate_per_mt": 1500},
    ]


# Metallocene grades draw from the same combined-offtake slab but are capped.
METALLOCENE_QD_CAP = 1250
