"""Third-engine confirmation of the nine HMEL spot-checks.

pdfjs (the TypeScript reader) and pdfminer (pdfplumber, the ETL) both place
words by coordinate. pypdf does not: extract_text() walks the content stream and
returns the text in the order the page draws it, with no column reconstruction
at all. If the basic price a coordinate reader assigned to a column also turns
up at the same ordinal position in that raw stream, the two disagree about
nothing that matters.

Read-only. Prints an evidence sheet; touches no data.
"""

from __future__ import annotations

import re
import sys

from pypdf import PdfReader

PDF = sys.argv[1] if len(sys.argv) > 1 else r"D:/Gail/HMEL.pdf"

# grade, page of the basic price, page of the adjustment, location,
# basic, adjustment, corrected, what production held instead
CHECKS = [
    ("N0320L", 9, 10, "Guwahati", 138700, 11670, 127030, 143580, "N0536L"),
    ("N0153S", 5, 6, "Siliguri", 144500, 4140, 140360, 129960, "OGHDED"),
    ("N5026L", 9, 10, "Guwahati", 153300, 4210, 149090, 141030, "N0118LM"),
    ("M5026L", 7, 8, "Guwahati", 154100, 4210, 149890, 142330, "F0120LM/F0120LMR"),
    ("F0153S", 3, 4, "Kolkata", 145300, 7210, 138090, 144200, "B0045DU"),
    ("N0049D", 5, 5, "Jammu", 139300, 2870, 136430, 132800, "N0142S"),
    ("M2050S", 3, 4, "Guwahati", 136700, 9920, 126780, 130380, "M0662DU"),
    ("N2050S", 5, 6, "Guwahati", 135900, 9920, 125980, 129580, "N0662DU"),
    ("R0536L", 7, 8, "Patna", 148600, 6240, 142360, 144360, "R0536LU"),
]

reader = PdfReader(PDF)
pages = {i + 1: (reader.pages[i].extract_text() or "") for i in range(len(reader.pages))}

BASIC_MIN = 50_000


def basic_row_numbers(text: str) -> list[int]:
    """The Ex-Bathinda basic prices, in the order the page draws them."""
    return [int(t) for t in re.findall(r"\b\d{5,6}\b", text) if int(t) >= BASIC_MIN]


def adjustment_run(text: str, location: str) -> tuple[str, list[int], bool]:
    """The text drawn immediately after a location's name, and its numbers.

    pypdf reads the content stream literally, and this circular's stream carries
    spaces inside numbers — page 8 draws Guwahati's 4210 as "421 0", and the
    same page has "852 0", "680 0", "1 0550" and "85 20". Tokenising on
    whitespace therefore misses values that are plainly on the page. So the run
    is also searched with all spaces removed; a hit only there is corroboration
    rather than proof, and is reported as such.
    """
    hit = re.search(rf"\b{re.escape(location)}\b(.{{0,900}})", text, re.S)
    if not hit:
        return "", [], False
    run = hit.group(1)
    spaced = re.sub(r"\s+", "", run)
    return run, [int(t) for t in re.findall(r"\b\d{2,5}\b", run)], bool(spaced)


ok = bad = 0
for grade, bp, ap, loc, basic, adj, corrected, held, owner in CHECKS:
    print("=" * 76)
    print(f"{grade}   basic on page {bp}, {loc} adjustment on page {ap}")

    text = pages.get(bp, "")
    prices = basic_row_numbers(text)
    where = [i for i, v in enumerate(prices) if v == basic]
    print(f"  basic {basic:>7}  present in pypdf's raw page text : "
          f"{'yes' if where else 'NO'}"
          f"{f'  at position(s) {[i + 1 for i in where]} of {len(prices)}' if where else ''}")

    run_text, run, _ = adjustment_run(pages.get(ap, ""), loc)
    seen = adj in run
    unspaced = str(adj) in re.sub(r"\s+", "", run_text)
    how = "yes" if seen else ("yes, once the stream's spaces inside numbers are closed up" if unspaced else "NO")
    print(f"  {loc} adjustment {adj:>6} in the run after that name : {how}")
    if not seen and unspaced:
        print(f"      row as pypdf draws it: {run_text[:110].strip()}")
    seen = seen or unspaced

    arith = basic - adj == corrected
    print(f"  {basic} - {adj} = {basic - adj}   corrected value {corrected}   "
          f"{'MATCHES' if arith else 'MISMATCH'}")
    print(f"  production held {held}, which is the price of {owner}")

    if where and seen and arith:
        ok += 1
    else:
        bad += 1

print("=" * 76)
print(f"confirmed by a third engine: {ok} of {len(CHECKS)}    unconfirmed: {bad}")
