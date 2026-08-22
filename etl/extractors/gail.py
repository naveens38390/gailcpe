"""GAIL ex-works and stock-point price sheets, and the GAIL freight book.

Both price sheets are one wide matrix split across page groups: five column
blocks of grades, each repeated over every location. Column headers carry the
grade code, so a page's header row defines the columns and every following row
is one location.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import xlrd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import assign_to_columns, merge_indian_digits, rows  # noqa: E402

# Grade codes are an uppercase letter followed by digits and letters, at least
# five characters (B52A003A, MF18S010U). Shorter uppercase tokens in the header
# row are labels ("HDPE", "LOCATION/GRADE"), not grades.
GRADE_CODE = re.compile(r"^[A-Z]{1,2}\d[0-9A-Z]{3,}$")

HEADER_EXWORKS = "Sl. No SAP CODE LOCATION/GRADE"
HEADER_STOCKPOINT = "Sl. No. SAP Code STOCKPOINT LOCATION"


def _grade_columns(row) -> list[tuple[str, float]]:
    return [(w.text, w.xmid) for w in row.words if GRADE_CODE.match(w.text)]


def _is_sap_code(token: str) -> bool:
    """Ex-works SAP codes are two characters ("01", "H2"); stock point are four
    digits ("5102"). Anything else on a label line is part of the location."""
    return (len(token) <= 2 and token.isalnum()) or (
        len(token) == 4 and token.isdigit()
    )


def _split_label(words) -> tuple[str, str]:
    """Return (sap_code, location) from the leading non-numeric tokens.

    Row labels read "<serial> <sap code> <LOCATION>", but the SAP code sometimes
    wraps onto its own line, leaving "<serial> <LOCATION>". Treating the first
    token after the serial as the SAP code unconditionally would eat the
    location and drop the row, so the code is recognised by shape instead.
    """
    tokens = [w.text for w in words]
    if tokens and tokens[0].isdigit() and not _is_sap_code(tokens[0]):
        tokens = tokens[1:]
    elif len(tokens) > 1 and tokens[0].isdigit():
        # Ambiguous: a short serial that also looks like a SAP code. It is the
        # serial when a SAP-shaped token follows it.
        tokens = tokens[1:]
    if not tokens:
        return "", ""
    if _is_sap_code(tokens[0]) and len(tokens) > 1:
        return tokens[0], " ".join(tokens[1:]).strip()
    return "", " ".join(tokens).strip()


def _extract(path: str, header_prefix: str) -> tuple[dict, list[str]]:
    """Return {(sap, location): {grade: price}} and grade order."""
    table: dict[tuple[str, str], dict[str, float]] = {}
    grades: list[str] = []
    columns: list[tuple[str, float]] = []
    header_top = None

    for row in rows(path):
        if row.text.startswith(header_prefix):
            columns = _grade_columns(row)
            for name, _ in columns:
                if name not in grades:
                    grades.append(name)
            header_top = row.top
            continue
        if header_top is None or row.top <= header_top:
            continue

        values = merge_indian_digits(row.words)
        if not values:
            continue
        # Label tokens are the words starting left of the first merged price.
        first_price_x = min(v.x_start for v in values)
        label_words = [w for w in row.words if w.x0 < first_price_x]
        sap, location = _split_label(label_words)
        if not location:
            continue
        table.setdefault((sap, location), {}).update(
            assign_to_columns(values, columns)
        )
    return table, grades


def ex_works(path: str):
    return _extract(path, HEADER_EXWORKS)


def stock_point(path: str):
    return _extract(path, HEADER_STOCKPOINT)


def freight(path: str) -> dict[str, dict]:
    """GAIL destination freight: current rates, prior rates, and pricing points.

    The workbook carries the revised table, the superseded 26.05.2026 list, a
    pricing-point/SAP-code lookup, and a scenario tab. Destination names differ
    between tabs (the prior list truncates at ten characters), so each is
    returned under its own key and reconciled later by the alias resolver.
    """
    book = xlrd.open_workbook(path)

    def column(sheet: str, key_col: int, value_col: int, start: int) -> dict[str, float]:
        ws = book.sheet_by_name(sheet)
        out: dict[str, float] = {}
        for r in range(start, ws.nrows):
            key = str(ws.cell_value(r, key_col)).strip().upper()
            raw = ws.cell_value(r, value_col)
            if isinstance(raw, float):
                value = raw
            else:
                try:
                    value = float(str(raw).replace(",", "").strip())
                except ValueError:
                    continue
            if key:
                out[key] = value
        return out

    ws = book.sheet_by_name("Picing Point list")
    pricing_points = {
        str(ws.cell_value(r, 0)).strip().upper(): str(ws.cell_value(r, 1)).strip()
        for r in range(1, ws.nrows)
        if str(ws.cell_value(r, 0)).strip()
    }

    return {
        "current": column("Revised freight table", 0, 1, 2),
        "previous": column("Freight list dated 26.05.2026", 0, 2, 1),
        "pricing_points": pricing_points,
    }
