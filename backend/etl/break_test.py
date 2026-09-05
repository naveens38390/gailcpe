"""Try to break the extractors the way next month's circulars will.

Every extractor here addresses part of its document by page number. That works
while the documents keep their present length, and says nothing about what
happens when one gains a page. This asks the question directly: where does each
page constant come from, does the document still satisfy it, and — the part
that matters — does the reader fail loudly or quietly when it does not.

Read-only. Runs extractors against the September circulars, and against
deliberately shifted page ranges to see the failure mode.
"""

from __future__ import annotations

import sys

sys.path.insert(0, r"D:/Gail2/gailcpe/backend/etl")

from pdfrows import rows  # noqa: E402
import extractors.haldia as haldia  # noqa: E402
import extractors.iocl as iocl  # noqa: E402

SEPT = {
    "haldia": r"C:/Users/DELL/Downloads/HPL PE PRICE LIST 01st SEPT 2026.pdf",
    "iocl": r"C:/Users/DELL/Downloads/IOC PE Price List 01 Sept 2026.pdf",
    "hmel": r"C:/Users/DELL/Downloads/PE Price Circular 01.09.2026.pdf",
}


def where(path: str, needles: list[str]) -> dict[str, list[int]]:
    """Which pages carry each marker, so the constants can be checked."""
    found: dict[str, list[int]] = {n: [] for n in needles}
    for row in rows(path):
        text = row.text.strip()
        for n in needles:
            if text.startswith(n):
                found[n].append(row.page)
    return {k: sorted(set(v)) for k, v in found.items()}


print("=" * 78)
print("PAGE-CONSTANT SENSITIVITY — September circulars")
print("=" * 78)

# ---- HPL ---------------------------------------------------------------
print("\nHPL (haldia.py)")
marks = where(SEPT["haldia"], ["Annexure - I", "Annexure - II", "Annexure - III",
                               "Annexure - IV", "Annexure - V"])
for k, v in marks.items():
    print(f"  {k:<18} on page(s) {v}")
print(f"  lldpe_prices() hard-codes pages=[6, 7]")
print(f"  territory_map() hard-codes pages=[9, 10]")

base = haldia.lldpe_prices(SEPT["haldia"])
print(f"  as written        : {len(base['ex_works'])} ex-works price points")
for shift in ([5, 6], [7, 8], [6, 7, 8]):
    src = haldia.lldpe_prices.__doc__  # keep the reader honest about what changed
    saved = None
    # Re-run the same function body against a different page window by
    # temporarily rewriting the constant it reads.
    import re as _re
    original = open("extractors/haldia.py", encoding="utf-8").read()
    patched = original.replace("pages=[6, 7]", f"pages={shift}")
    open("extractors/haldia.py", "w", encoding="utf-8").write(patched)
    import importlib
    importlib.reload(haldia)
    try:
        out = haldia.lldpe_prices(SEPT["haldia"])
        n = len(out["ex_works"])
    except Exception as exc:  # noqa: BLE001
        n = f"raised {type(exc).__name__}"
    finally:
        open("extractors/haldia.py", "w", encoding="utf-8").write(original)
        importlib.reload(haldia)
    verdict = "SILENT" if isinstance(n, int) and n != len(base["ex_works"]) else ""
    print(f"  if the table sat on {str(shift):<10}: {n} price points  {verdict}")

# ---- IOCL --------------------------------------------------------------
print("\nIOCL (iocl.py)")
marks = where(SEPT["iocl"], ["Annexure-I A", "Annexure - I A", "Annexure-I B",
                             "Annexure-II", "Grades", "Quantity Uplifted"])
for k, v in marks.items():
    if v:
        print(f"  {k:<20} on page(s) {v}")
print(f"  DELIVERED_PAGES = {iocl.DELIVERED_PAGES}   DEPOT_PAGES = {iocl.DEPOT_PAGES}")
print(f"  upliftment_slabs() hard-codes pages=[7]")
base_iocl = iocl.prices(SEPT["iocl"])["delivered"]
print(f"  as written        : {len(base_iocl)} zones, "
      f"{sum(len(v) for v in base_iocl.values())} cells")
slabs = iocl.upliftment_slabs(SEPT["iocl"])
print(f"  upliftment slabs  : {len(slabs)}")

# ---- HMEL --------------------------------------------------------------
print("\nHMEL (hmel.py)")
marks = where(SEPT["hmel"], ["Ex-Bathinda Price", "Ex-Depot Basic Price"])
for k, v in marks.items():
    print(f"  {k:<24} on page(s) {v}")
print("  prices() hard-codes pages=range(3, 15)")
total_pages = len({r.page for r in rows(SEPT["hmel"])})
print(f"  document has {total_pages} pages; the range covers 3-14")
