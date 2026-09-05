"""Third-engine spot checks on the September round.

pypdf reconstructs no columns: extract_text() walks the content stream and
returns text in the order the page draws it. So it is independent of both
coordinate readers, and the right tool for asking whether a value the pipeline
stored is actually printed where it says.

Covers the two producers the positional sampler cannot reach — HMEL, whose
prices are derived rather than printed, and RIL, whose book is thirty annexures
— plus the specific grades named in the sign-off brief.

Read-only.
"""

from __future__ import annotations

import json
import random
import re
import sys

from pypdf import PdfReader

INDEX = json.load(open("D:/Gail2/staged/sept/price_index.json", encoding="utf-8"))
HMEL_PDF = r"C:/Users/DELL/Downloads/PE Price Circular 01.09.2026.pdf"
RIL_PDF = r"C:/Users/DELL/Downloads/PE RO PRICE CIRCULAR wef 01.09.2026.pdf"
RAW = json.load(open("D:/Gail2/staged/sept/prices.json", encoding="utf-8"))

ok = bad = 0


def result(passed: bool) -> str:
    global ok, bad
    if passed:
        ok += 1
        return "PASS"
    bad += 1
    return "FAIL"


def page_text(path: str) -> dict[int, str]:
    return {i + 1: (p.extract_text() or "") for i, p in enumerate(PdfReader(path).pages)}


# ---- HMEL: the nine named grades ---------------------------------------
print("=" * 78)
print("HMEL — the grades named in the brief, checked against the page")
print("=" * 78)

hmel_pages = page_text(HMEL_PDF)
basic = RAW["hmel"]["basic"]
adjustments = RAW["hmel"]["adjustments"]
zones = INDEX["producers"]["HMEL"]["zones"]

NAMED = ["F0118LM", "F0120LM", "M2050S", "N2050S", "N0320L",
         "M5026L", "R0536L", "F517LMV", "OGHDBD"]

for grade in NAMED:
    entry = basic.get(grade)
    if entry is None:
        print(f"  {result(False)}  {grade:<10} absent from the extractor's basic-price table")
        continue
    price = entry["price"]
    # The basic price must be drawn somewhere in the document. The stream puts
    # spaces inside numbers on some pages ("421 0" for 4210), so the search is
    # made against the text with whitespace closed up; a boundary assertion
    # cannot be used there, because every digit then abuts its neighbour.
    on_page = [p for p, t in hmel_pages.items() if str(int(price)) in re.sub(r"\s+", "", t)]
    # And the stored ex-works must be basic minus that location's adjustment.
    loc = next((z for z in zones if grade in zones[z]), None)
    adj = adjustments.get(loc, {}).get(grade) if loc else None
    stored = zones[loc][grade] if loc else None
    arith = adj is not None and abs(price - adj - stored) < 1e-9
    print(f"  {result(bool(on_page) and arith)}  {grade:<10} basic {price:>7,.0f} on page(s) {on_page[:3]}"
          f"   {loc}: {price:,.0f} - {adj:,.0f} = {stored:,.0f}" if on_page and arith
          else f"  {result(bool(on_page) and arith)}  {grade:<10} basic {price:>7,.0f} pages={on_page[:3]} arith={arith}")

# ---- RIL: sampled cells ------------------------------------------------
print()
print("=" * 78)
print("RIL — sampled cells, checked against the annexure page")
print("=" * 78)

ril_pages = page_text(RIL_PDF)
ril = INDEX["producers"]["RIL"]["zones"]
rng = random.Random(20260901)
zone_names = sorted(ril)

checked = 0
while checked < 12:
    zone = rng.choice(zone_names)
    grade = rng.choice(sorted(ril[zone]))
    stored = ril[zone][grade]
    # The row is the zone's line on a page whose header carries the grade.
    hit = None
    for page, text in ril_pages.items():
        if not re.search(rf"(?<![A-Za-z0-9]){re.escape(grade)}(?![A-Za-z0-9])", text):
            continue
        for line in text.split("\n"):
            if not re.search(rf"(?<![A-Za-z]){re.escape(zone)}(?![A-Za-z])", line):
                continue
            bare = line.replace(",", "").replace(" ", "")
            if re.search(rf"(?<![\d]){int(stored)}(?![\d])", line.replace(",", "")) or str(int(stored)) in bare:
                hit = (page, line.strip()[:88])
                break
        if hit:
            break
    checked += 1
    print(f"  {result(hit is not None)}  {zone[:18]:<18} {grade:<12} {stored:>10,.0f}"
          f"   {'p' + str(hit[0]) if hit else 'not found on any page carrying that grade'}")

print()
print("=" * 78)
print(f"third-engine spot checks: {ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
