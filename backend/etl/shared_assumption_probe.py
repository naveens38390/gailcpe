"""What could both readers agree on and both have wrong?

Python == TypeScript is the strongest signal in this audit, and it is worth
being precise about what it proves. The two implementations use different
libraries — pdfminer and pdfjs — so they are genuinely independent about
*decoding* a page. They are not independent about *interpreting* one: the same
person wrote both from the same mental model, and they share their constants.

The sharpest of those is row bucketing. Both put a word in row round(top / 3.0),
so any two lines closer than 3 points become one row in both readers, and they
agree on the merged result. This measures how much headroom that has on the
real documents.

Read-only.

    py -3 shared_assumption_probe.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pdfrows import ROW_TOLERANCE, merge_indian_digits, rows  # noqa: E402

# round(top / 3.0) puts two lines in one bucket when they round alike, which
# happens below about half the tolerance — not below the whole of it.
MERGE_AT = ROW_TOLERANCE / 2

DOCS = {
    "GAIL":  (r"C:/Users/DELL/Downloads/PE - Ex Works Basic Prices w.e.f. September 1, 2026.pdf", None),
    "IOCL":  (r"C:/Users/DELL/Downloads/IOC PE Price List 01 Sept 2026.pdf", [2, 3, 4]),
    "RIL":   (r"C:/Users/DELL/Downloads/PE RO PRICE CIRCULAR wef 01.09.2026.pdf", None),
    "HMEL":  (r"C:/Users/DELL/Downloads/PE Price Circular 01.09.2026.pdf", list(range(3, 15))),
    "HPL":   (r"C:/Users/DELL/Downloads/HPL PE PRICE LIST 01st SEPT 2026.pdf", None),
    "OPaL":  (r"C:/Users/DELL/Downloads/OPaL Polymers DTA price circular_PE wef 1st September 2026.pdf", None),
}

print("=" * 92)
print(f"ROW BUCKETING HEADROOM — both readers merge lines closer than {ROW_TOLERANCE} pt")
print("=" * 92)
print(f"\n{'producer':<8}{'data rows':>11}{'closest two':>14}{'headroom':>11}   tightest pair")
print("-" * 92)

for producer, (path, pages) in DOCS.items():
    data = []
    for row in rows(path, pages=pages):
        label, values = row.label_and_values()
        if not label or len(values) < 5:
            # GAIL renders lakh-grouped prices with a space after the leading
            # digit, so label_and_values sees fragments, not prices.
            merged = merge_indian_digits(row.words)
            if len(merged) >= 5:
                first = min(v.x_start for v in merged)
                label = " ".join(w.text for w in row.words if w.x0 < first).strip()
                label = label.lstrip("0123456789 ").strip()
                values = merged
        # A data row: a name of its own and a full set of prices.
        if label and len(values) >= 5:
            data.append((row.page, row.top, label))
    closest = None
    for (p1, t1, l1), (p2, t2, l2) in zip(data, data[1:]):
        if p1 != p2:
            continue
        gap = abs(t2 - t1)
        if gap > 0 and (closest is None or gap < closest[0]):
            closest = (gap, p1, l1[:22], l2[:22])
    if closest is None:
        print(f"{producer:<8}{len(data):>11}{'n/a':>14}")
        continue
    gap, page, a, b = closest
    head = gap - MERGE_AT
    print(f"{producer:<8}{len(data):>11}{gap:>13.1f}pt{head:>10.1f}pt   p{page} {a!r} / {b!r}")

print("-" * 92)
print(f"Margin is how much closer two distinct priced rows could be set before both")
print(f"readers fold them into one at ~{MERGE_AT} pt — agreeing, and both wrong.")
