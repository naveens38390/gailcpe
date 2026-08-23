"""OPaL (ONGC Petro additions) PE price circulars.

Two circulars, same table shape:
    DTA — ex-Dahej plant prices by pricing zone (OPaL/Polymer Pricing/26-27/DTA-PE-18)
    CSA — ex-consignment-stockist warehouse prices  (.../26-27/CS-PE-18)

Each row is `Zone | Pricing Zone | State | <grade prices...>`. The three label
columns sit at fixed left edges, so the label is split by x rather than by token
position — a long state name wraps over extra lines and would otherwise be read
as extra tokens of the pricing-zone name.

Those left edges are measured per annexure, not per document: the HDPE and LLDPE
tables place their label columns at different x, and one shared measurement
silently drops every row of whichever annexure it does not fit.

Grade headers stack: F2001A sits under F2001S, F2002A/F2003A under F2002S. Those
are alternate grades sharing one price, recorded as aliases.
"""

from __future__ import annotations

import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import assign_to_columns, rows  # noqa: E402

# F2001S, D2001S, E2507, T3804U, M2525, ULLE, B48H02U, M6112, P5002, B55H02.
GRADE_CODE = re.compile(r"^(?=.*\d)[A-Z][A-Z0-9]{2,8}$|^U[A-Z]{3,4}$")
HEADER = re.compile(r"^Zone\s+Pricing Zone\s+State")
ANNEXURE = re.compile(r"Annexure\s+(DTA-(?:HDPE|LLDPE)|CS\d?-PE)", re.I)
MIN_VALUES = 5  # captions and footers carry stray digits; a data row does not
HAS_DIGIT = re.compile(r"\d")


def _blocks(body: list) -> list[tuple[str, list]]:
    """Split the document into (annexure, rows) blocks, one per price table."""
    out: list[tuple[str, list]] = []
    sheet = "UNKNOWN"
    current: list | None = None
    for row in body:
        found = ANNEXURE.search(row.text)
        if found:
            sheet = found.group(1).upper()
        if HEADER.match(row.text):
            current = [row]
            out.append((sheet, current))
            continue
        if current is not None:
            current.append(row)
    return out


def _label_edges(block: list) -> list[float]:
    """The three recurring left edges of the label columns in this block."""
    edges: collections.Counter = collections.Counter()
    for row in block:
        boundary = row.numeric_boundary()
        if boundary is None or len(row.label_and_values()[1]) < MIN_VALUES:
            continue
        for w in row.words:
            if w.x0 < boundary:
                edges[round(w.x0, 1)] += 1
    return sorted(x for x, _ in edges.most_common(3))


def prices(path: str) -> dict:
    """{"sheets": {annexure: {pricing_zone: {"zone", "state", "prices"}}},
    "aliases": {alias: primary}}"""
    body = list(rows(path))
    sheets: dict[str, dict[str, dict]] = {}
    aliases: dict[str, str] = {}

    for sheet, block in _blocks(body):
        edges = _label_edges(block)
        columns = [
            (w.text, w.xmid)
            for w in block[0].words
            if GRADE_CODE.match(w.text) and w.text not in ("Zone", "State")
        ]
        if len(edges) < 3 or not columns:
            continue
        zones = sheets.setdefault(sheet, {})

        seen_data = False
        last_zone: str | None = None

        for row in block[1:]:
            label, values = row.label_and_values()
            codes = [(w.text, w.xmid) for w in row.words if GRADE_CODE.match(w.text)]

            if not values and codes and not seen_data:
                for code, x in codes:
                    primary, cx = min(columns, key=lambda c: abs(c[1] - x))
                    if abs(cx - x) < 40:
                        aliases[code] = primary
                continue

            if len(values) < MIN_VALUES:
                # A state name too long for its cell continues on its own line.
                # Drop any token carrying a digit: on the crowded rows that
                # continuation overlaps the price column and the two arrive
                # fused into a single word ("Da1m27a8n").
                if label and last_zone in zones and not label.startswith("OPaL"):
                    tail = " ".join(
                        t for t in label.split() if not HAS_DIGIT.search(t)
                    )
                    if tail:
                        zones[last_zone]["state"] = (
                            zones[last_zone]["state"] + " " + tail
                        ).strip()
                continue

            seen_data = True
            boundary = row.numeric_boundary()
            parts: list[list[str]] = [[], [], []]
            for w in row.words:
                if w.x0 >= boundary:
                    continue
                slot = sum(1 for e in edges if w.x0 >= e - 1.0) - 1
                parts[max(0, min(2, slot))].append(w.text)
            # On crowded rows the wrapped state text runs into the price
            # column and the two fuse into one token; drop those.
            parts[2] = [t for t in parts[2] if not HAS_DIGIT.search(t)]
            zone, pricing_zone, state = (" ".join(p).strip() for p in parts)
            if not pricing_zone:
                continue
            entry = zones.setdefault(
                pricing_zone, {"zone": zone, "state": state, "prices": {}}
            )
            entry["prices"].update(assign_to_columns(values, columns))
            last_zone = pricing_zone

    return {"sheets": sheets, "aliases": aliases}


def quantity_slabs() -> list[dict]:
    """Section VI.3 quantity discount, combined HDPE+LLDPE monthly lifting."""
    edges = [5, 10, 25, 50, 100, 200, 300, 400]
    rates = [450, 550, 650, 750, 850, 950, 1050, 1150]
    return [
        {
            "from_mt": low,
            "to_mt": edges[i + 1] if i + 1 < len(edges) else None,
            "rate_per_mt": rate,
        }
        for i, (low, rate) in enumerate(zip(edges, rates))
    ]
