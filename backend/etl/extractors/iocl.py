"""IOCL PE price list (Circular PEPL/2026-2027/16).

Annexure I-A carries *delivered* prices ex-Panipat — freight is already inside,
unlike GAIL/HMEL/OPaL/Haldia. Annexure I-B carries ex-DOPW and ex-RSC prices,
which are depot prices the customer collects from. Annexure II is the monthly
upliftment incentive slab table.

Prices are quoted per *pricing zone*, and the circular points at "Annex - III"
for the zone-to-district mapping — but that annexure is not in the supplied PDF.
Until it is, a district can only be priced by matching its zone name.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import assign_to_columns, rows, split_header_token  # noqa: E402

# 010E52, 012DB54, 010DP45U, 065E24A, 500M24A — three digits, one or two
# letters, two digits, an optional suffix letter.
GRADE_CODE = re.compile(r"\d{3}[A-Z]{1,2}\d{2}[A-Z]?")
# XEHD, XMHD, DXB, XEHD-Al, XRLL — utility and waste grades carry no digits.
UTILITY_CODE = re.compile(r"^[A-Z]{2,5}(?:-Al)?$")

DELIVERED_PAGES = [2, 3, 4]
DEPOT_PAGES = [5, 6]

# A zone's prices can be split across two baselines. How far apart the two
# halves may sit and still be one row: the table's own pitch is 3pt, and no
# two zones are closer than that.
ORPHAN_GAP = 6.0

_SECTIONS = {
    "Delivered Price": "delivered",
    "Ex DOPW Price": "ex_dopw",
    "Ex RSC Price": "ex_rsc",
}


def _columns(row) -> list[tuple[str, float]]:
    out: list[tuple[str, float]] = []
    for w in row.words:
        if w.text == "Grades":
            continue
        text = w.text.lstrip("`")
        if GRADE_CODE.search(text):
            out.extend(
                (c.lstrip("`"), x)
                for c, x in split_header_token(
                    type(w)(text, w.x0, w.x1, w.top), GRADE_CODE
                )
            )
        elif UTILITY_CODE.match(text):
            out.append((text, w.xmid))
    return out


def prices(path: str) -> dict[str, dict[str, dict[str, float]]]:
    """{basis: {zone: {grade: price}}} for delivered, ex-DOPW and ex-RSC."""
    out: dict[str, dict[str, dict[str, float]]] = {
        "delivered": {},
        "ex_dopw": {},
        "ex_rsc": {},
    }
    columns: list[tuple[str, float]] = []
    basis = None
    pending = ""
    last_zone: str | None = None
    last_top = 0.0

    for row in rows(path, pages=DELIVERED_PAGES + DEPOT_PAGES):
        text = row.text
        if text.startswith("Grades"):
            columns = _columns(row)
            basis = "delivered" if row.page in DELIVERED_PAGES else None
            continue
        matched = next((v for k, v in _SECTIONS.items() if text.startswith(k)), None)
        if matched:
            basis = matched
            continue
        if basis is None or not columns:
            continue

        zone, values = row.label_and_values()
        if not values:
            # A zone name too long for its cell sits alone on its own line; its
            # prices arrive on the next row, so hold the name until then.
            pending = zone
            continue
        if not zone:
            zone, pending = pending, ""
        if not zone and last_zone is not None and abs(row.top - last_top) <= ORPHAN_GAP:
            # The split can also run the other way: the zone keeps its name and
            # the last of its prices, and the rest are set on the line below
            # with no name at all. Udaipur, Visak and Bareilly are all printed
            # this way, and holding a name forward cannot reach them — the name
            # has already been used. Look back instead, but only across a gap
            # small enough to be the same row, and only where the two halves do
            # not both claim a column, which would mean it is a different zone.
            claimed = out[basis].get(last_zone, {})
            proposed = assign_to_columns(values, columns)
            if not any(
                grade in claimed and claimed[grade] != price
                for grade, price in proposed.items()
            ):
                zone = last_zone
        if not zone:
            continue
        out[basis].setdefault(zone, {}).update(assign_to_columns(values, columns))
        last_zone, last_top = zone, row.top
    return {k: v for k, v in out.items() if v}


def upliftment_slabs(path: str) -> list[dict]:
    """Annexure II monthly upliftment incentive, as (from, to, rate) rows."""
    slabs: list[dict] = []
    collecting = False
    for row in rows(path, pages=[7]):
        if row.text.startswith("Quantity Uplifted"):
            collecting = True
            continue
        if not collecting:
            continue
        parts = row.text.split()
        if len(parts) == 3 and parts[0].isdigit():
            low = float(parts[0])
            high = None if parts[1] == "-" else float(parts[1])
            slabs.append({"from_mt": low, "to_mt": high, "rate_per_mt": float(parts[2])})
    return slabs
