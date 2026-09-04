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

Columns come from the geometry, not from recognising a code. HMEL runs three
families of grade code — M0252S, F517LMV, OGHDBD — and no single shape admits
all three without admitting nonsense too. A reader that matches a shape does
not merely skip the columns it fails to recognise: their prices snap to
whichever column *was* recognised nearest, so on the LLDPE prime page ten
accepted codes absorbed twenty-five columns of prices, and nine grades carried
another grade's price across all eighty locations.

So the Ex-Bathinda basic prices define the columns — one per price, bounded
halfway to its neighbours — and a column's code is read character by character
from the header band above it, whatever it spells.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import char_rows, is_number, parse_number, rows  # noqa: E402

# A basic price is five or six figures; a locational adjustment is smaller.
BASIC_MIN = 50_000
# The basic-price row, which is what defines the columns.
BASIC_ROW = re.compile(r"^(?:Price\s*\(Rs/MT\)|Ex\s*Bathinda\s*Basic)")
# Page furniture between the codes and the prices, and the stub column.
FURNITURE = re.compile(
    r"HPCL|Mittal|Ex-?\s*Bathinda|Ex-?\s*Depot|Basic|Price|Grades|Locational|Location",
    re.IGNORECASE,
)
# Two lines of a stacked code are one cell; more than that is a different row.
STACK_GAP = 8.0

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


def _bands(prices_in_row: list[tuple[float, float]]) -> list[tuple[float, float, float, float]]:
    """(price, centre, low, high) per column, split at the midpoints between prices.

    Every grade column carries exactly one Ex-Bathinda basic price, and those
    prices are clean, well separated numbers. So they define the columns:
    one per price, centred on it, bounded halfway to its neighbours.
    """
    ordered = sorted(prices_in_row, key=lambda p: p[1])
    out = []
    for i, (value, x) in enumerate(ordered):
        low = (ordered[i - 1][1] + x) / 2 if i else x - 15.0
        high = (x + ordered[i + 1][1]) / 2 if i + 1 < len(ordered) else x + 15.0
        out.append((value, x, low, high))
    return out


def _tidy(code: str) -> str:
    """Drop the polymer label the leftmost band catches from the page edge.

    The first column of a non-prime section sits under "LLDPE" or "HDPE" set at
    the margin, so its code reads "LLDPEN0120L". Strip that only where a whole
    code remains behind it.
    """
    return re.sub(r"^(?:LLDPE|HDPE|PE)(?=[A-Z]\d)", "", code.strip())


def expand_codes(code: str) -> list[str]:
    """One column, one price, but sometimes two grades.

    HMEL stacks a pair of codes in a single column — "R0150S/R0151D",
    "F815LMV/F815LMVR" — meaning the column serves either grade at that price.
    Both are real and both should be priced.
    """
    return [c for c in (part.strip() for part in code.split("/")) if c]


def _codes_for(
    page_chars: list, basic_top: float, bands: list[tuple[float, float, float, float]]
) -> list[str]:
    """The grade code sitting over each column, read character by character.

    Walks up from the basic-price row to the nearest row that is not page
    furniture — that is the code row — and takes the row above it too when
    HMEL has stacked the code over two lines. Characters are then bucketed by
    the column band they fall in, so nothing has to be recognised by shape.
    """
    above = sorted(
        (r for r in page_chars if r.top < basic_top), key=lambda r: r.top, reverse=True
    )
    code_rows: list = []
    for row in above:
        if FURNITURE.search("".join(w.text for w in row.words)):
            continue
        if not code_rows:
            code_rows.append(row)
            continue
        if code_rows[-1].top - row.top <= STACK_GAP:
            code_rows.append(row)
        break

    out = []
    for _, _, low, high in bands:
        picked = [
            (row.top, w.x0, w.text)
            for row in code_rows
            for w in row.words
            if low <= w.xmid < high
        ]
        picked.sort()
        out.append(_tidy("".join(text for _, _, text in picked)))
    return out


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

    by_page_chars: dict[int, list] = {}
    for row in char_rows(path, pages=range(3, 15)):
        by_page_chars.setdefault(row.page, []).append(row)

    for row in rows(path, pages=range(3, 15)):
        text = row.text.strip()

        found = next((v for k, v in SECTIONS.items() if text.startswith(k)), None)
        if found:
            section, in_adjustment = found, False
            continue

        # The basic-price row opens a block: it defines the columns *and*
        # carries the prices that go in them. Doing both here is what keeps the
        # two in step — the previous reader took columns from whichever header
        # words it could recognise, and the prices then had nowhere right to go.
        if BASIC_ROW.match(text):
            values = [
                (parse_number(w.text), w.xmid)
                for w in row.words
                if is_number(w.text) and parse_number(w.text) >= BASIC_MIN
            ]
            if not values:
                continue
            bands = _bands(values)
            codes = _codes_for(by_page_chars.get(row.page, []), row.top, bands)
            # Every band is kept, named or not. A band whose code could not be
            # read still claims its own values and they are then dropped, which
            # is the whole point: an unclaimed column must not push its prices
            # onto the column beside it.
            columns = [
                (code, low, high) for code, (_, _, low, high) in zip(codes, bands)
            ]
            in_adjustment = False
            for code, (price, _, _, _) in zip(codes, bands):
                for grade in expand_codes(code):
                    basic.setdefault(
                        grade,
                        {"price": price, "polymer": section[1], "quality": section[2]},
                    )
            continue
        if not columns:
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
        cells: dict[str, float] = {}
        for value, x in values:
            code = next(
                (c for c, low, high in columns if low <= x < high), ""
            )
            for grade in expand_codes(code):
                cells[grade] = value
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
