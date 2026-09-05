"""Was the IOCL caption defect latent in August, or new in September?

Replays the pre-fix algorithm — the one without the pending-clear at the header
— against both rounds, so the answer does not depend on editing the extractor.

Read-only.
"""

from __future__ import annotations

import sys

sys.path.insert(0, r"D:/Gail2/gailcpe/backend/etl")

from pdfrows import assign_to_columns, rows  # noqa: E402
from extractors.iocl import (  # noqa: E402
    DELIVERED_PAGES, DEPOT_PAGES, ORPHAN_GAP, _SECTIONS, _columns,
)

ROUNDS = {
    "August": r"D:/Gail/IOCL.pdf",
    "September": r"C:/Users/DELL/Downloads/IOC PE Price List 01 Sept 2026.pdf",
}


def prices_prefix(path: str) -> dict[str, dict[str, float]]:
    """The reader as it stood before the header cleared a held-over name."""
    out: dict[str, dict[str, float]] = {}
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
            continue                                    # <- no pending reset
        if next((v for k, v in _SECTIONS.items() if text.startswith(k)), None):
            basis = next(v for k, v in _SECTIONS.items() if text.startswith(k))
            continue                                    # <- no pending reset
        if basis is None or not columns:
            continue
        zone, values = row.label_and_values()
        if not values:
            pending = zone
            continue
        if not zone:
            zone, pending = pending, ""
        if not zone and last_zone is not None and abs(row.top - last_top) <= ORPHAN_GAP:
            zone = last_zone
        if not zone:
            continue
        if basis == "delivered":
            out.setdefault(zone, {}).update(assign_to_columns(values, columns))
        last_zone, last_top = zone, row.top
    return out


for tag, path in ROUNDS.items():
    book = prices_prefix(path)
    grades = {g for cells in book.values() for g in cells}
    phantom = [z for z in book if any(w in z for w in ("Film", "Utility", "HDPE", "Grades"))]
    short = [(z, len(c)) for z, c in book.items() if len(c) < len(grades)]
    print(f"{tag:<10} zones {len(book):>3}  grades {len(grades):>3}  "
          f"cells {sum(len(c) for c in book.values()):>5}")
    print(f"           phantom zones: {phantom or 'none'}")
    print(f"           zones short of the full set: "
          f"{[f'{z} ({n})' for z, n in short] or 'none'}")
