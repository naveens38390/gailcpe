"""RIL PE pricing policy (Circular PE/2026-27/016).

108 pages across 30 annexures. Like IOCL, the factory annexures quote
*delivered* prices — freight is already inside — so they must not have freight
added again when compared with GAIL's ex-works sheet.

Annexure families:
    I*    domestic delivered, by plant (Hazira, Jamnagar, Nagothane, Dahej)
    II*   domestic delivered, LDPE
    III*  deemed-export, HDPE/LLDPE
    IV*   deemed-export, LDPE
    V*/VI* delivered price for sale from factory
    VII*  ex-depot HDPE/LLDPE
    VIII* ex-depot LDPE
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdfrows import assign_to_columns, rows  # noqa: E402

ANNEXURE = re.compile(r"Annexure\s*-\s*([IVX]+[A-Z]?)")
HEADER = re.compile(r"^Sr\.No")
# Row labels fuse the serial number onto the zone name ("1AGARTALA", "44MUMBAI").
SERIAL_PREFIX = re.compile(r"^\d+")
# Two-letter state codes closing the label ("TR", "MH", "DN").
STATE_SUFFIX = re.compile(r"\s([A-Z]{2})$")


def _describe(page_rows: list) -> str:
    """The annexure's own caption, e.g. 'Domestic Prices for Hazira HDPE'."""
    for row in page_rows[:3]:
        text = row.text
        if "Annexure" in text:
            caption = re.sub(r"^.*?016", "", text)
            caption = ANNEXURE.sub("", caption)
            return re.sub(r"\s+", " ", caption).replace("Date :", "").strip(" .")
    return ""


def prices(path: str) -> dict[str, dict]:
    """{annexure: {"caption": str, "zones": {zone: {"state": s, "prices": {}}}}}"""
    out: dict[str, dict] = {}
    current: str | None = None
    columns: list[tuple[str, float]] = []
    page_buffer: list = []
    page_no = None

    def flush_caption():
        if current and current in out and not out[current]["caption"]:
            out[current]["caption"] = _describe(page_buffer)

    for row in rows(path):
        if row.page != page_no:
            flush_caption()
            page_buffer, page_no = [], row.page
        page_buffer.append(row)

        found = ANNEXURE.search(row.text)
        if found:
            current = found.group(1)
            out.setdefault(current, {"caption": "", "zones": {}})
            continue
        if HEADER.match(row.text):
            # Columns are every header word to the right of "State".
            state = next((w for w in row.words if w.text == "State"), None)
            cutoff = state.x1 if state else 0
            columns = [(w.text, w.xmid) for w in row.words if w.x0 > cutoff]
            continue
        if current is None or not columns:
            continue

        label, values = row.label_and_values()
        if not values or not label:
            continue
        state_code = ""
        found_state = STATE_SUFFIX.search(label)
        if found_state:
            state_code = found_state.group(1)
            label = label[: found_state.start()].strip()
        zone = SERIAL_PREFIX.sub("", label).strip()
        if not zone:
            continue
        entry = out[current]["zones"].setdefault(
            zone, {"state": state_code, "prices": {}}
        )
        entry["prices"].update(assign_to_columns(values, columns))

    flush_caption()
    return out
