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


def _split_districts(text: str) -> list[str]:
    """Split a district cell on commas that are not inside brackets.

    "Sant Ravidas Nagar (Bhadohi)" and "Prayagraj (Allahabad)" are one district
    each, printed with a second name in brackets.
    """
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    parts.append("".join(current))
    return [re.sub(r"\s+", " ", p).strip() for p in parts if p.strip()]


def territory_map(path: str) -> dict[str, list[str]]:
    """Annexure V: which districts each price point covers.

    HPL is the only producer in the pack that publishes this. IOCL's equivalent
    (its Annexure III) is referenced by its circular but absent from the file,
    so this map is the only authoritative district-to-zone data available.

    Read from the table's own cells, not from lines of text. HPL centres each
    price-point label vertically in its row, so a row's districts sit above and
    below the label. Read line by line, every line above a label was attached to
    the previous price point: a quarter of all districts landed on the wrong
    point (Gorakhpur was priced at Haryana_Panipat, Lucknow at Varanasi instead
    of Kanpur), two price points vanished, and the legal notice under the table
    was stored as two more. The cell border is the only thing that says which
    lines belong together.

    The table is found by its "Territory Division" heading rather than by page
    number, and the build stops if it is not a clean 1..N numbered list: a
    partial map would look exactly like a complete one.
    """
    import pdfplumber

    found: dict[int, tuple[str, str]] = {}
    with pdfplumber.open(path) as pdf:
        start = next(
            (i for i, page in enumerate(pdf.pages) if "Territory Division" in (page.extract_text() or "")),
            None,
        )
        if start is None:
            raise SystemExit(
                'HPL Annexure V not found: no page carries the "Territory Division" heading.\n'
                "The circular changed shape and territory_map() has not kept up."
            )
        for index in range(start, len(pdf.pages)):
            numbered = 0
            for table in pdf.pages[index].extract_tables():
                for cells in table:
                    if len(cells) < 3 or not re.fullmatch(r"\d+", (cells[0] or "").strip()):
                        continue  # header row, or the legal notice under the table
                    serial = int(cells[0].strip())
                    name = re.sub(r"\s+", " ", cells[1] or "").strip()
                    districts = re.sub(r"\s+", " ", cells[2] or "").strip()
                    if not name or not districts:
                        raise SystemExit(f"HPL Annexure V row {serial} has an empty name or district cell.")
                    if serial in found:
                        raise SystemExit(f"HPL Annexure V serial {serial} appears twice.")
                    found[serial] = (name, districts)
                    numbered += 1
            if numbered == 0 and index > start:
                break  # the table ended on the previous page

    if not found or sorted(found) != list(range(1, len(found) + 1)):
        raise SystemExit(
            "HPL Annexure V is not a clean 1..N list of price points "
            f"(serials read: {sorted(found)[:5]}..{sorted(found)[-3:]}, {len(found)} rows)."
        )
    names = [name for name, _ in found.values()]
    if len(set(names)) != len(names):
        raise SystemExit("HPL Annexure V names a price point twice.")
    return {name: _split_districts(districts) for _, (name, districts) in sorted(found.items())}


def reconcile_territory(
    territory: dict[str, list[str]], price_points
) -> tuple[dict[str, list[str]], dict[str, str]]:
    """Key Annexure V by the price book's own point names, or stop the build.

    HPL prints the same point differently in two annexures ("Orissa_Barhgarh" in
    the territory list, "Orissa_Bargarh" in the price book). A district mapped to
    a name no price row carries resolves a town to a zone with no prices, which
    the engine reports as "no price" for a town HPL does serve.

    Every Annexure V point must match exactly one price point and every price
    point must be covered. Anything else is a fact about the round for a person
    to look at, so it raises rather than guesses.
    """
    import difflib

    points = list(price_points)
    unmatched_prices = [p for p in points if p not in territory]
    renamed: dict[str, str] = {}
    for name in [n for n in territory if n not in points]:
        close = difflib.get_close_matches(name, unmatched_prices, n=1, cutoff=0.85)
        if close:
            renamed[name] = close[0]
            unmatched_prices.remove(close[0])
    orphans = [n for n in territory if n not in points and n not in renamed]
    if orphans or unmatched_prices:
        raise SystemExit(
            "HPL Annexure V and the price book do not describe the same price points.\n"
            f"  in Annexure V only: {orphans}\n"
            f"  in the price book only: {unmatched_prices}\n"
            "Either the circular changed shape or a point was renamed; confirm which."
        )
    return {renamed.get(n, n): districts for n, districts in territory.items()}, renamed


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
