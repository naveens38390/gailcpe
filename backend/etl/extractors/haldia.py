"""Haldia Petrochemicals (HPL) PE price list (Circular HPL/PM/26-27/82).

Ex-works and ex-stock prices for HDPE and LLDPE across four annexures. Prices
are quoted per "price point", named `State_City` (West Bengal_Howrah) or as a
bare state (Bihar, Chattisgarh) where the whole state is one point.

The grade header stacks: a primary row of column codes, then further rows of
codes sitting under the same columns. Those are alternate grade names that share
one price (HDT10/HDT10S; HDBRM1..HDBRM4), not extra columns — so they are
recorded as aliases rather than widening the table.
"""

from __future__ import annotations

import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import assign_to_columns, pair_orphans, rows  # noqa: E402

ANNEXURE = re.compile(r"^Annexure\s*-\s*([IVX]+)")
# B6401, E5201S, P5200UV, M5018L, HDT10, HDBRM1 (HDPE, letter-first) and
# 71501S, 73005TU, 72307E, LLT-12 (LLDPE, digit-first). Requiring both a letter
# and a digit is what separates a grade code from a bare price.
GRADE_CODE = re.compile(r"^(?=.*[A-Z])(?=.*\d)[A-Z0-9][A-Z0-9-]{2,9}$")
BASIS = re.compile(r"^(EX-\s*WORKS|EX-\s*STOCK)\s*:\s*(HDPE|LLDPE)", re.I)

# How far left of the first recognised code the table can still extend. One
# column pitch is 21pt here, so this reaches the neighbouring column and no
# further.
HEADER_MARGIN = 15.0

# Captions that sit inside the table's own columns without naming one: the
# "PRICE POINTS / BASIC PRICE" strip that closes every header block, and the
# per-block "Basic Price" captions in Annexure III.
HEADER_FURNITURE = re.compile(r"^(PRICE|POINTS|BASIC|Price|Points|Basic|Grades|\(Rs)", re.I)


def _columns_from(row) -> list[tuple[str, float]]:
    """Every column in a header row, not only those matching the code shape.

    HDBRE carries no digit and so failed GRADE_CODE. An unrecognised column is
    not skipped: its price snapped to HDT9C, 22.5pt away and inside the 40pt
    assignment radius, overwriting HDT9C's own price at all 71 price points.

    The codes that *do* match are still what tells us this row is a header and
    where the table begins; from there rightwards, every word is a column
    whatever it spells.
    """
    matched = [w for w in row.words if GRADE_CODE.match(w.text)]
    if len(matched) < 3:
        return []
    left = min(w.x0 for w in matched) - HEADER_MARGIN
    return [(w.text, w.xmid) for w in row.words if w.x0 >= left]


def _bands(columns: list[tuple[str, float]]) -> list[tuple[str, float, float]]:
    """(code, low, high) per column, split at the midpoints between centres."""
    ordered = sorted(columns, key=lambda c: c[1])
    out = []
    for i, (code, x) in enumerate(ordered):
        low = (ordered[i - 1][1] + x) / 2 if i else x - HEADER_MARGIN
        high = (x + ordered[i + 1][1]) / 2 if i + 1 < len(ordered) else x + HEADER_MARGIN
        out.append((code, low, high))
    return out


def _aliases_from(row, columns: list[tuple[str, float]]) -> dict[str, str]:
    """Alternate names stacked under a column, including multi-word ones.

    The off-grade columns are set as "HD OG (E)" — three tokens with a space
    and brackets, which no single-token shape can match. Grouping a row's words
    by the column band they fall in reads them without having to.

    Grouping is by band, not by code: Annexure III repeats the same eight codes
    for its ex-stock half, so keying on the code would splice the two halves of
    the page into one name.
    """
    bands = _bands(columns)
    left = bands[0][1]
    groups: dict[int, list[tuple[float, str]]] = {}
    for w in row.words:
        if w.x0 < left or HEADER_FURNITURE.match(w.text):
            continue
        for i, (_, low, high) in enumerate(bands):
            if low <= w.xmid < high:
                groups.setdefault(i, []).append((w.x0, w.text))
                break
    out: dict[str, str] = {}
    for i, words in groups.items():
        name = " ".join(t for _, t in sorted(words)).strip()
        if name and name != bands[i][0]:
            out[name] = bands[i][0]
    return out


def prices(path: str) -> dict:
    """{annexure: {"basis": str, "polymer": str, "points": {point: {grade: p}},
    "aliases": {alias: primary}}}"""
    out: dict[str, dict] = {}
    current: str | None = None
    columns: list[tuple[str, float]] = []
    buffer: list = []
    seen_data = False

    def drain():
        if current is None or not columns:
            buffer.clear()
            return
        for label, values, _ in pair_orphans(buffer):
            if len(values) < 3:
                continue
            out[current]["points"].setdefault(label, {}).update(
                assign_to_columns(values, columns)
            )
        buffer.clear()

    for row in rows(path):
        text = row.text.strip()

        found = ANNEXURE.match(text)
        if found:
            drain()
            current = found.group(1)
            if current not in ("I", "II"):
                current = None
                columns = []
                continue
            out.setdefault(
                current,
                {"basis": "", "polymer": "", "points": {}, "aliases": {}},
            )
            columns = []
            continue
        if current is None:
            continue

        basis = BASIS.match(text)
        if basis:
            out[current]["basis"] = (
                "ex_works" if "WORKS" in basis.group(1).upper() else "ex_stock"
            )
            out[current]["polymer"] = basis.group(2).upper()
            continue

        if not row.label_and_values()[1]:
            fresh = _columns_from(row)
            if fresh and (seen_data or not columns):
                drain()
                columns = fresh
                seen_data = False
                continue
            if columns and not seen_data:
                # A continuation line of the stacked header: each name is an
                # alternate grade sharing the column it sits under. Read by
                # band, so a name spanning several words arrives whole.
                found = _aliases_from(row, columns)
                if found:
                    out[current]["aliases"].update(found)
                    continue
            # Not part of the header: a price-point name too long for its cell,
            # which pair_orphans has to see to pair with the row below it.

        if row.label_and_values()[1]:
            seen_data = True
        buffer.append(row)

    drain()
    return {k: v for k, v in out.items() if v["points"]}


def _seam(columns: list[tuple[str, float]]) -> float | None:
    """Midpoint of a header whose second half repeats its first half."""
    half = len(columns) // 2
    if not half or len(columns) % 2:
        return None
    names = [c[0] for c in columns]
    if names[:half] != names[half:]:
        return None
    return (columns[half - 1][1] + columns[half][1]) / 2


def lldpe_prices(path: str) -> dict:
    """Annexure III: LLDPE ex-works and ex-stock side by side in one table.

    The header repeats the same eight grade codes twice — once under "Ex-Works
    Price", once under "Ex-Stock Point Price". Keying by grade alone would let
    the second block overwrite the first, so the two halves are kept apart.

    The split point comes from that repetition, not from the "Ex-Stock" caption:
    like every other caption in this circular the caption is centred over its
    block, so its x sits inside the second half rather than at the seam.
    """
    out = {"ex_works": {}, "ex_stock": {}, "aliases": {}}
    boundary: float | None = None
    columns: list[tuple[str, float]] = []
    buffer: list = []
    seen_data = False
    active = False

    def drain():
        if boundary is None or not columns:
            buffer.clear()
            return
        left = [c for c in columns if c[1] < boundary]
        right = [c for c in columns if c[1] >= boundary]
        for label, values, _ in pair_orphans(buffer):
            if len(values) < 4:
                continue
            lv = [v for v in values if v[1] < boundary]
            rv = [v for v in values if v[1] >= boundary]
            out["ex_works"].setdefault(label, {}).update(assign_to_columns(lv, left))
            out["ex_stock"].setdefault(label, {}).update(assign_to_columns(rv, right))
        buffer.clear()

    for row in rows(path, pages=[6, 7]):
        text = row.text.strip()
        if text.startswith("Annexure"):
            active = "III" in text
            continue
        if not active:
            continue
        if not row.label_and_values()[1]:
            fresh = _columns_from(row)
            if fresh and (seen_data or not columns):
                drain()
                columns = sorted(fresh, key=lambda c: c[1])
                boundary = _seam(columns)
                seen_data = False
                continue
            if columns and not seen_data:
                found = _aliases_from(row, columns)
                if found:
                    out["aliases"].update(found)
                    continue
        if row.label_and_values()[1]:
            seen_data = True
        buffer.append(row)

    drain()
    return out


def territory_map(path: str) -> dict[str, list[str]]:
    """Annexure V: which districts each price point covers.

    HPL is the only producer in the pack that publishes this. IOCL's equivalent
    (its Annexure III) is referenced by its circular but absent from the file,
    so this map is the only authoritative district-to-zone data available.
    """
    body = [
        r
        for r in rows(path, pages=[9, 10])
        if not r.text.strip().startswith(("Annexure", "Circular", "Effective", "Sl."))
        and "Territory Division" not in r.text
    ]

    # The "Districts" header is centred over its column, so its own x tells us
    # nothing about where district text begins. The data's left edges do: the
    # serial, name and district columns each start at one recurring x, and they
    # are by far the most common left edges on the page.
    edges = collections.Counter(round(w.x0, 1) for r in body for w in r.words)
    columns = sorted(x for x, _ in edges.most_common(3))
    if len(columns) < 3:
        return {}
    boundary = columns[-1] - 1.0

    out: dict[str, list[str]] = {}
    current: str | None = None

    for row in body:
        name_words = [w for w in row.words if w.x0 < boundary]
        district_words = [w for w in row.words if w.x0 >= boundary]
        name = " ".join(w.text for w in name_words).strip()
        name = re.sub(r"^\d+\s*", "", name)
        districts = " ".join(w.text for w in district_words).strip()

        if name:
            current = name
            out.setdefault(current, [])
        if districts and current:
            out[current].append(districts)

    return {
        point: [
            d.strip()
            for d in ", ".join(chunks).split(",")
            if d.strip()
        ]
        for point, chunks in out.items()
        if chunks
    }


def quantity_slabs() -> list[dict]:
    """Annexure IV quantity-linked incentive (QLI), combined HDPE+LLDPE."""
    edges = [5, 10, 30, 60, 100, 200, 300, 400]
    rates = [450, 550, 650, 750, 850, 950, 1050, 1150]
    return [
        {
            "from_mt": low,
            "to_mt": edges[i + 1] if i + 1 < len(edges) else None,
            "rate_per_mt": rate,
        }
        for i, (low, rate) in enumerate(zip(edges, rates))
    ]
