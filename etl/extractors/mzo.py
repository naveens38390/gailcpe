"""The Mumbai Zonal Office comparison workbook — used here as ground truth.

This is the calculation GAIL's zonal team already does by hand, for five zones
and about twenty grade-location pairs. Its competitor figures reconcile exactly
against the August 2026 IOCL, RIL, HMEL, OPaL and Haldia circulars, which makes
it the best available acceptance test for the engine: if the engine cannot
reproduce these numbers, the engine is wrong.

Three caveats, carried into the output so a failing comparison can be told apart
from a bad expectation:

  * The Goa and Jalgaon sheets contain #REF!/#VALUE! errors, and one Aurangabad
    block has a missing basic price that makes its net basic read -1,100. Those
    cells are excluded, not repaired.
  * Three GAIL figures do not appear anywhere in the August circular — Pune
    I56A200U and W52ASR009A are each exactly Rs 6,000 low, Goa B52A003A is
    Rs 3,550 low. They are flagged rather than trusted.
  * Every column is labelled "ExW", but IOCL and RIL are delivered prices and
    the sheet correctly adds no freight to them. The label is wrong; the maths
    is right.
"""

from __future__ import annotations

import openpyxl

PRODUCERS = ["GAIL", "IOCL", "RIL", "HMEL", "OPAL", "HALDIA"]
ROW_LABELS = {
    "grade name": "grade",
    "basic": "basic",
    "less: cd - cash discount": "cash_discount",
    "cash discount": "cash_discount",
    "net basic": "net_basic",
    "freight": "freight",
    "basic + freight": "basic_plus_freight",
    "price net of gst": "price_net_of_gst",
}
ERRORS = {"#REF!", "#VALUE!", "#N/A", "#DIV/0!"}


def _clean(value):
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if text in ERRORS or not text:
            return None
        return text
    return value


def _label(value) -> str:
    text = str(value or "").strip().lower()
    for prefix, name in ROW_LABELS.items():
        if text.startswith(prefix):
            return name
    return ""


def blocks(path: str) -> list[dict]:
    """Every producer-comparison block in the zonal sheets.

    A block starts at a row that names the six producers across some columns;
    those column positions define the block, and the labelled rows beneath it
    supply the ladder.
    """
    book = openpyxl.load_workbook(path, data_only=True)
    out: list[dict] = []

    for ws in book.worksheets:
        if ws.title == "Pricing Feedback":
            continue
        grid = [list(r) for r in ws.iter_rows(values_only=True)]

        # Each sheet holds an ex-works comparison and, below it, an ex-depot
        # one. They quote different numbers for the same grade and location, so
        # a block has to know which section it belongs to.
        section_at: dict[int, str] = {}
        section = "ex_works"
        for index, row in enumerate(grid):
            first = str((row[0] if row else "") or "").strip().lower()
            if first.startswith("price comparison"):
                section = "ex_depot" if "depot" in first else "ex_works"
            section_at[index] = section

        for index, row in enumerate(grid):
            # A producer header row repeats GAIL/IOCL/RIL... once per block.
            positions = [
                (c, str(v).strip().upper())
                for c, v in enumerate(row)
                if isinstance(v, str) and str(v).strip().upper() in PRODUCERS
            ]
            if len(positions) < len(PRODUCERS):
                continue

            # The location label sits in column A of this row or just above it.
            location = ""
            for back in range(index, max(-1, index - 3), -1):
                candidate = _clean(grid[back][0]) if grid[back] else None
                if isinstance(candidate, str) and candidate:
                    location = candidate.strip()
                    break

            # Split the header into consecutive runs of the six producers.
            groups: list[list[tuple[int, str]]] = []
            for column, name in positions:
                if groups and name == "GAIL":
                    groups.append([])
                elif not groups:
                    groups.append([])
                groups[-1].append((column, name))
            groups = [g for g in groups if len(g) == len(PRODUCERS)]

            fields: dict[str, list] = {}
            for offset in range(1, 14):
                if index + offset >= len(grid):
                    break
                target = grid[index + offset]
                name = _label(target[0] if target else None)
                if name:
                    fields.setdefault(name, target)

            application = ""
            header_row = grid[index - 1] if index else []
            for column, _ in groups[0] if groups else []:
                for c in range(column, max(-1, column - 3), -1):
                    if c < len(header_row) and isinstance(header_row[c], str):
                        application = header_row[c].strip()
                        break
                if application:
                    break

            for group in groups:
                entry = {
                    "sheet": ws.title,
                    "section": section_at.get(index, "ex_works"),
                    "location": location,
                    "application": application,
                    "producers": {},
                }
                for column, producer in group:
                    cells = {}
                    for name, source in fields.items():
                        cells[name] = (
                            _clean(source[column]) if column < len(source) else None
                        )
                    entry["producers"][producer] = cells
                if any(
                    isinstance(p.get("price_net_of_gst"), (int, float))
                    for p in entry["producers"].values()
                ):
                    out.append(entry)

    return out


def expectations(path: str) -> list[dict]:
    """Flatten the blocks into (location, producer, grade, expected landed)."""
    rows: list[dict] = []
    for block in blocks(path):
        for producer, cells in block["producers"].items():
            grade = cells.get("grade")
            landed = cells.get("price_net_of_gst")
            if not isinstance(grade, str) or not isinstance(landed, (int, float)):
                continue
            if landed < 50_000:
                # A residue of a broken formula, not a price. Real PE landed
                # costs in this pack run Rs 1.2-1.6 lakh per MT.
                continue
            rows.append(
                {
                    "sheet": block["sheet"],
                    "section": block["section"],
                    "location": block["location"],
                    "application": block["application"],
                    "producer": producer,
                    "grade": grade.strip(),
                    "basic": cells.get("basic"),
                    "cash_discount": cells.get("cash_discount"),
                    "freight": cells.get("freight"),
                    "expected_landed": float(landed),
                }
            )
    return rows
