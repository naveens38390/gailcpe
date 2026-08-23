"""Competitor freight circulars — HMEL, HPL and OPaL, all effective 1 June 2026.

Freight matters more than basic price in most comparisons, because GAIL, HMEL,
OPaL and Haldia all sell ex-works while RIL and IOCL sell delivered. These three
books are flat destination lists, but each labels its rows differently:

    HMEL  serial | state | district | destination | rate
    HPL   serial | cluster | state | sector | district | destination | km | days | rate
    OPaL  serial | cluster | state | zone code | destination | rate | insurance

Each is read by x-position rather than by splitting text, because destination
names contain spaces and OPaL fuses its zone code onto the destination.
"""

from __future__ import annotations

import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import join_numeric_fragments, rows  # noqa: E402

SERIAL = re.compile(r"^\d+$")
# OPaL prints "1000001168Bongaigaon" — a ten-digit zone code fused onto the name.
OPAL_ZONE = re.compile(r"^(\d{10})(.*)$")


def _numbered(path: str):
    """Yield data rows, with split numbers rejoined.

    A row is data when its first word is a bare serial number.
    """
    for row in rows(path):
        if row.words and SERIAL.match(row.words[0].text):
            yield join_numeric_fragments(row.words)


def _column_edges(path: str, keep: int) -> list[float]:
    """The recurring left edges that define this circular's columns."""
    edges: collections.Counter = collections.Counter()
    for words in _numbered(path):
        for w in words:
            edges[round(w.x0, 1)] += 1
    return sorted(x for x, _ in edges.most_common(keep))


def _cells(words, edges: list[float]) -> list[str]:
    """Bucket a row's words into the columns defined by `edges`."""
    out: list[list[str]] = [[] for _ in edges]
    for w in words:
        slot = sum(1 for e in edges if w.x0 >= e - 1.5) - 1
        if slot >= 0:
            out[slot].append(w.text)
    return [" ".join(c).strip() for c in out]


def _rate(text: str) -> float | None:
    """Parse a rate, tolerating the space pdfplumber leaves in '3 ,756.00'."""
    cleaned = re.sub(r"\s+", "", text)
    try:
        return float(cleaned.replace(",", ""))
    except ValueError:
        return None


def hmel(path: str) -> list[dict]:
    """HMEL delivery assistance charges, ex-Bhatinda."""
    edges = _column_edges(path, 5)
    out = []
    for words in _numbered(path):
        state, district, destination, rate = _cells(words, edges)[1:5]
        value = _rate(rate)
        if value is not None and destination:
            out.append(
                {
                    "state": state,
                    "district": district,
                    "destination": destination,
                    "rate_per_mt": value,
                }
            )
    return out


def hpl(path: str) -> list[dict]:
    """HPL freight rates, with distance and transit time where published."""
    edges = _column_edges(path, 9)
    out = []
    for words in _numbered(path):
        cells = _cells(words, edges)
        if len(cells) < 9:
            continue
        cluster, state, sector, district, destination, km, days, rate = cells[1:9]
        value = _rate(rate)
        if value is None or not destination:
            continue
        out.append(
            {
                "cluster": cluster,
                "state": state,
                "sector": sector,
                "district": district,
                "destination": destination,
                "distance_km": _rate(km),
                "transit_days": _rate(days),
                "rate_per_mt": value,
            }
        )
    return out


def opal(path: str) -> list[dict]:
    """OPaL freight plus the separate per-MT insurance charge."""
    edges = _column_edges(path, 6)
    out = []
    for words in _numbered(path):
        cells = _cells(words, edges)
        if len(cells) < 6:
            continue
        cluster, state, destination, rate, insurance = cells[1:6]
        zone_code = ""
        fused = OPAL_ZONE.match(destination)
        if fused:
            zone_code, destination = fused.group(1), fused.group(2).strip()
        value = _rate(rate)
        if value is None or not destination:
            continue
        out.append(
            {
                "cluster": cluster,
                "state": state,
                "zone_code": zone_code,
                "destination": destination,
                "rate_per_mt": value,
                "insurance_per_mt": _rate(insurance),
            }
        )
    return out
