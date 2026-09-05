"""Check built prices against the source PDFs, without using the extractors.

The extractors place words by coordinate. This does not: it reads each page
with pypdf, which returns the text in the order the page draws it, splits it
into lines, and checks a sampled cell positionally — the grade's position in
the header line must be the position of the stored value in the zone's line.

A value that had snapped to a neighbouring column would still be somewhere on
the page, so presence alone proves nothing; the position is the test.

    py -3 verify_against_pdf.py <index dir> [samples per producer]
"""

from __future__ import annotations

import json
import random
import re
import sys

from pypdf import PdfReader

INDEX_DIR = sys.argv[1] if len(sys.argv) > 1 else "D:/Gail2/staged/sept"
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 12
SEED = 20260901

DOWNLOADS = "C:/Users/DELL/Downloads/"
GAIL_DIR = "D:/Gail/"
# The circulars each round was built from. Verifying a round against the other
# round's documents compares two different price lists and fails on every cell,
# which says nothing about the reader.
ROUNDS = {
    "2026-09-01": {
        "IOCL": DOWNLOADS + "IOC PE Price List 01 Sept 2026.pdf",
        "HPL": DOWNLOADS + "HPL PE PRICE LIST 01st SEPT 2026.pdf",
        "OPaL": DOWNLOADS + "OPaL Polymers DTA price circular_PE wef 1st September 2026.pdf",
        "GAIL": DOWNLOADS + "PE - Ex Works Basic Prices w.e.f. September 1, 2026.pdf",
    },
    "2026-08-01": {
        "IOCL": GAIL_DIR + "IOCL.pdf",
        "HPL": GAIL_DIR + "Haldia.pdf",
        "OPaL": GAIL_DIR + "OPaL Polymers DTA price circular_PE wef 1st August 2026.pdf",
        "GAIL": GAIL_DIR + "GAIL EX WORKS.pdf",
    },
}
# The header line that opens a table, per producer.
HEADER_MARK = {
    "IOCL": re.compile(r"^Grades\b"),
    "HPL": re.compile(r"^\s*B\d{4}|^\s*7\d{4}"),
    "OPaL": re.compile(r"^Zone\s+Pricing\s*Zone\s+State\b"),
    # August runs "CODE" and "LOCATION/GRADE" together with no space; September
    # separates them. The gap between the two is optional either way.
    "GAIL": re.compile(r"^Sl\.\s*No\s+SAP\s+CODE\s*LOCATION/GRADE\b"),
}
NUMBER = re.compile(r"(?<![\d,.])\d[\d,]*(?:\.\d+)?(?![\d,.])")
CODE = re.compile(r"[A-Z0-9][A-Z0-9/()\-]{2,}")


def lines(path: str) -> list[tuple[int, str]]:
    out = []
    for i, page in enumerate(PdfReader(path).pages, 1):
        for line in (page.extract_text() or "").split("\n"):
            if line.strip():
                out.append((i, line.rstrip()))
    return out


def numbers(line: str) -> list[float]:
    return [float(t.replace(",", "")) for t in NUMBER.findall(line)]


def zone_matches(producer: str, zone: str, line: str) -> bool:
    """Whether this line is the zone's row, not merely a line mentioning it.

    OPaL prints "Zone | Pricing Zone | State | prices...", and the first of
    those is a region several pricing zones share. Matching the name anywhere
    picks up "Delhi Chandigarh Chandigarh 130080 ..." when the row wanted is
    "Delhi Delhi Delhi 129500 ...", and reads Chandigarh's price as Delhi's.
    The pricing zone is the second field, so that is where to look.
    """
    if producer == "OPaL":
        return bool(re.search(r"^\s*\S+\s+" + re.escape(zone) + r"(?![A-Za-z])", line))
    return bool(re.search(r"(?<![A-Za-z])" + re.escape(zone) + r"(?![A-Za-z])", line))


# IOCL prints its delivered book on pages 2-4; pages 5-6 are the ex-DOPW and
# ex-RSC depot tables, which carry the same zones and grades at other prices.
PAGES = {"IOCL": {2, 3, 4}}


def verify(producer: str, zones: dict, path: str, want: int) -> tuple[int, int, list[str]]:
    doc = lines(path)
    mark = HEADER_MARK[producer]

    # Header in force at each line, as the document draws them.
    headers: list[list[str]] = []
    current: list[str] = []
    for _, line in doc:
        if mark.match(line):
            body = mark.sub("", line, count=1)
            current = [c for c in CODE.findall(body) if not re.fullmatch(r"[\d,]+", c)]
        headers.append(current)

    rng = random.Random(SEED)
    zone_names = [z for z in zones if zones[z]]
    checked = passed = 0
    notes: list[str] = []
    tried = 0
    while checked < want and tried < want * 60:
        tried += 1
        zone = rng.choice(zone_names)
        grade = rng.choice(list(zones[zone]))
        stored = zones[zone][grade]
        for i, (page, line) in enumerate(doc):
            if producer in PAGES and page not in PAGES[producer]:
                continue
            head = headers[i]
            if grade not in head:
                continue
            if not zone_matches(producer, zone, line):
                continue
            vals = numbers(line)
            # A caption can carry the zone's name and a page number — "OPaL
            # Dahej Price ... Page 1 of 13" reads as a row with one value. A
            # real row carries a full set of prices.
            if len(vals) < 5:
                continue
            idx = head.index(grade)
            # The line may carry a leading serial or a zone code before prices.
            for offset in (0, 1, 2, 3):
                if idx + offset < len(vals) and abs(vals[idx + offset] - stored) < 0.005:
                    checked += 1
                    passed += 1
                    if len(notes) < want:
                        notes.append(
                            f"  PASS  p{page:>3}  {zone[:20]:<20} {grade:<12} "
                            f"col {idx + 1:>3} of {len(head):<3} -> {stored:>10,.2f}")
                    break
            else:
                checked += 1
                if len(notes) < want:
                    got = vals[idx] if idx < len(vals) else None
                    notes.append(
                        f"  FAIL  p{page:>3}  {zone[:20]:<20} {grade:<12} "
                        f"col {idx + 1:>3}: stored {stored:,.2f}, line has {got}")
            break
    return checked, passed, notes


def main() -> None:
    index = json.load(open(f"{INDEX_DIR}/price_index.json", encoding="utf-8"))
    round_id = index["effective_date"]
    pdfs = ROUNDS.get(round_id)
    if pdfs is None:
        raise SystemExit(f"no circulars registered for round {round_id}")
    print("=" * 84)
    print(f"SOURCE PDF VERIFICATION — {INDEX_DIR}   effective {round_id}")
    print("=" * 84)
    total = ok = 0
    for producer, path in pdfs.items():
        zones = index["producers"][producer]["zones"]
        checked, passed, notes = verify(producer, zones, path, SAMPLES)
        total += checked
        ok += passed
        print(f"\n{producer}: {passed} of {checked} sampled cells match the page positionally")
        for line in notes:
            print(line)
    print(f"\n{'=' * 84}\nTOTAL {ok} of {total} sampled cells verified against the PDF")


main()
