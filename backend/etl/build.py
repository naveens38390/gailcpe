"""Build the normalized dataset from the 14 source files.

Run:  py -3 etl/build.py

Emits data/normalized/*.json — one price round, stamped with its effective date
so later circulars accumulate rather than overwrite. Every producer's prices are
tagged with their *basis*, because that decides whether freight gets added:

    delivered  RIL, IOCL          freight already inside the published price
    ex_works   GAIL, HMEL, OPaL, HPL   freight added from that producer's book
    ex_depot   all                 customer collects and arranges their own

Getting that wrong is the single easiest way to make a comparison look decisive
and be wrong by the freight amount, twice over.
"""

from __future__ import annotations

import os
import re
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "extractors"))

import crossref  # noqa: E402
import freight as freight_x  # noqa: E402
import gail as gail_x  # noqa: E402
import haldia as haldia_x  # noqa: E402
import hmel as hmel_x  # noqa: E402
import iocl as iocl_x  # noqa: E402
import mzo  # noqa: E402
import opal as opal_x  # noqa: E402
import ril as ril_x  # noqa: E402
from locations import (  # noqa: E402
    SPELLINGS,
    Resolver,
    derive_aliases,
    derive_freight_aliases,
)

SOURCE = Path(os.environ.get("GCPE_SOURCE", "D:/Gail"))

# Producers name their files differently every month — September's pack shares
# not one filename with August's — so the names below are only a default. Point
# GCPE_SOURCES at a JSON manifest mapping the keys in FILES to paths, absolute
# or relative to SOURCE, and a round can be built without renaming anything.
# Keys the manifest omits fall back to the defaults, which is what lets a price
# round be rebuilt against an unchanged freight book.
SOURCES_MANIFEST = os.environ.get("GCPE_SOURCES", "")
OUT = Path(__file__).resolve().parent.parent / "data" / "normalized"

# The round these circulars are for. Not a default: it used to be the literal
# string "2026-08-01", so a run against September's documents produced correct
# prices stamped with August's effective date, silently and with everything
# else passing. Supply it, and check_round() then requires every circular to
# say the same thing.
PRICE_ROUND = os.environ.get("GCPE_PRICE_ROUND", "")
FREIGHT_ROUND = "2026-06-01"

_MONTHS = {m: i for i, m in enumerate(
    "january february march april may june july august september october "
    "november december".split(), 1)}
# 01.09.2026 / 01-09-2026 / 1/9/26
_NUMERIC_DATE = re.compile(r"\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b")
# "September 1, 2026" and "1 st September, 2026" — HMEL sets the ordinal apart.
_MONTH_FIRST = re.compile(
    r"\b(" + "|".join(_MONTHS) + r")\s+(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b", re.I)
_DAY_FIRST = re.compile(
    r"\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+(" + "|".join(_MONTHS) + r")\s*,?\s*(\d{4})\b", re.I)


def _dates_in(text: str) -> set[str]:
    """Every date the text states, as ISO strings."""
    found: set[str] = set()
    for d, m, y in _NUMERIC_DATE.findall(text):
        year = int(y) + 2000 if len(y) == 2 else int(y)
        if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            found.add(f"{year:04d}-{int(m):02d}-{int(d):02d}")
    for month, d, y in _MONTH_FIRST.findall(text):
        found.add(f"{int(y):04d}-{_MONTHS[month.lower()]:02d}-{int(d):02d}")
    for d, month, y in _DAY_FIRST.findall(text):
        found.add(f"{int(y):04d}-{_MONTHS[month.lower()]:02d}-{int(d):02d}")
    return found


def check_round(src: dict, note) -> None:
    """Require every price circular to agree with the round being built.

    Each of the six states its effective date on its first pages, in six
    different formats. RIL prints its issue date beside it — "August 31, 2026"
    next to "September 01, 2026" — so the test is that the declared round is
    *among* the dates a circular states, not that it is the first one found.
    """
    if not PRICE_ROUND:
        raise SystemExit(
            "\nNo price round given. Set GCPE_PRICE_ROUND to the effective date of "
            "these circulars, e.g.\n    GCPE_PRICE_ROUND=2026-09-01 py -3 build.py\n"
            "\nIt used to be hard-coded, which meant a run against a new month's "
            "documents\nproduced correct prices stamped with the previous month's date."
        )

    from pdfrows import rows as _rows  # local: keeps the import graph flat

    disagree: list[str] = []
    for key in ("gail_ex_works", "iocl", "ril", "hmel", "haldia", "opal_dta"):
        text = " ".join(r.text for r in _rows(src[key], pages=[1, 2]))
        stated = _dates_in(text)
        if PRICE_ROUND in stated:
            continue
        near = sorted(d for d in stated if d >= "2020-01-01")
        disagree.append(f"  {key:<16} states {near[:6] or 'no date this reader could find'}")

    if disagree and not os.environ.get("GCPE_ALLOW_ROUND_MISMATCH"):
        raise SystemExit(
            f"\nBuild stopped: {len(disagree)} circular(s) do not state {PRICE_ROUND}.\n"
            + "\n".join(disagree)
            + "\n\nEither the wrong round was given, or the wrong documents are in "
            f"{SOURCE}.\nSet GCPE_ALLOW_ROUND_MISMATCH=1 only if you have checked both."
        )
    note(f"round {PRICE_ROUND} confirmed against all six circulars")

FILES = {
    "gail_ex_works": "GAIL EX WORKS.pdf",
    "gail_stock_point": "GAIL STOCK POINT.pdf",
    "gail_freight": "GAIL Freight rate WEF 01.06.2026.xls",
    "crossref": "GAIL_PE_CrossReference_Master.xlsx",
    "iocl": "IOCL.pdf",
    "ril": "RIL.pdf",
    "hmel": "HMEL.pdf",
    "haldia": "Haldia.pdf",
    "opal_dta": "OPaL Polymers DTA price circular_PE wef 1st August 2026.pdf",
    "opal_csa": "OPaL Polymers CSA price circular_PE wef 1st August 2026.pdf",
    "hmel_freight": "HMEL Freight Circular w.e.f. 01.06.2026.pdf",
    "hpl_freight": "HPL Freight Circular w.e.f. 1st June 2026.pdf",
    "opal_freight": "OPaL Freight Circular June 2026.pdf",
    "mzo": "20260801 - Price comparision - MZO.xlsx",
}

# Discount terms, transcribed from each circular's own policy section. GAIL's
# are the exception: no GAIL policy circular is in the source pack, so its terms
# come from the MZO workbook and from what the client has since confirmed
# directly. They are recorded here rather than edited into data/normalized,
# because anything only in the output is undone the next time this runs — which
# is exactly what happened to the quantity schedule below.
DISCOUNTS = {
    "GAIL": {
        "cash_discount": 1000,
        "cash_discount_source": (
            'MZO workbook, row "Less: CD - Cash Discount" (no GAIL circular '
            "supplied). Client confirmed 29 Aug 2026: available on cash payment only."
        ),
        # Supplied by the client after the first build, so it was never in a
        # source file this script reads.
        "quantity_slabs": [
            {"from_mt": 5, "to_mt": 10, "rate_per_mt": 450},
            {"from_mt": 10, "to_mt": 30, "rate_per_mt": 550},
            {"from_mt": 30, "to_mt": 50, "rate_per_mt": 650},
            {"from_mt": 50, "to_mt": 100, "rate_per_mt": 750},
            {"from_mt": 100, "to_mt": 200, "rate_per_mt": 850},
            {"from_mt": 200, "to_mt": 300, "rate_per_mt": 950},
            {"from_mt": 300, "to_mt": 400, "rate_per_mt": 1050},
            {"from_mt": 400, "to_mt": None, "rate_per_mt": 1150},
        ],
        "quantity_slabs_source": (
            "GAIL quantity discount schedule supplied by the client, 26 Aug 2026"
        ),
        "quantity_slabs_note": (
            "Circular states A, B and OG grades only. Confirmed with the client on "
            "26 Aug 2026 that no grade in this catalogue is excluded, so the schedule "
            "applies to all 53 GAIL grades. No quality classification is needed."
        ),
        "early_payment_per_day": None,
        "interest_free_credit_days": 14,
        "interest_free_credit_source": (
            "Client, confirmed 29 Aug 2026: GAIL offers a 14-day interest-free credit "
            "period, as the other producers do. The Rs 1,000/MT is NOT available on "
            "credit terms — a credit buyer gets the 14 days and no discount. "
            "Implemented that way: the cash discount applies in cash mode only, and "
            "this period is reported rather than applied, matching every competitor."
        ),
    },
    "RIL": {
        "cash_discount": 1100,
        "cash_discount_ldpe": 1500,
        "early_payment_per_day": 80,
        "early_payment_max_days": 9,
        "interest_free_credit_days": 10,
        "quantity_slabs": [
            {"from_mt": 5, "to_mt": 10, "rate_per_mt": 450},
            {"from_mt": 10, "to_mt": 30, "rate_per_mt": 550},
            {"from_mt": 30, "to_mt": 60, "rate_per_mt": 650},
            {"from_mt": 60, "to_mt": 100, "rate_per_mt": 750},
            {"from_mt": 100, "to_mt": 200, "rate_per_mt": 850},
            {"from_mt": 200, "to_mt": 300, "rate_per_mt": 950},
            {"from_mt": 300, "to_mt": 400, "rate_per_mt": 1050},
            {"from_mt": 400, "to_mt": None, "rate_per_mt": 1150},
        ],
        "dealer_discount": 350,
    },
    "IOCL": {
        "cash_discount": 1100,
        "early_payment_per_day": 78.6,
        "interest_free_credit_days": 14,
        "quantity_slabs": None,  # filled from Annexure II at build time
    },
    "HMEL": {
        "cash_discount": 1100,
        "early_payment_per_day": 80,
        "early_payment_max_days": 13,
        "interest_free_credit_days": 14,
        "quantity_slabs": None,
        "metallocene_qd_cap": hmel_x.METALLOCENE_QD_CAP,
    },
    "OPaL": {
        "cash_discount": 1100,
        "cash_discount_note": "not available on ex-CSA warehouse sales",
        "early_payment_per_day": 75,
        "interest_free_credit_days": 14,
        "quantity_slabs": None,
    },
    "HPL": {
        "cash_discount": 1100,
        "early_payment_per_day": 75,
        "interest_free_credit_days": 10,
        "quantity_slabs": None,
    },
}


def check_complete(flat: dict, note) -> None:
    """Stop the build if a producer's book is not a rectangle.

    Every defect this pipeline has shipped produced a *successful* build: 720
    mispaired HMEL prices, 90 OPaL, 71 HPL, 39 dropped IOCL rows, 5,040 HMEL
    prices that never arrived. None of them raised anything, because nothing
    here ever checked the shape of what was built — each was found weeks later
    by reading the circular again.

    They share one symptom. A producer's book stops being a rectangle: a grade
    the circular prices everywhere is suddenly priced at all but one location,
    or a caption becomes a zone carrying a third of a row. That is cheap to
    check and catches the whole family, including the next one, which will not
    look like any of these.

    A circular that genuinely does not price a grade everywhere trips this too,
    and that is the point — it is a fact about the round for a person to
    confirm, not something to find in an audit six weeks later. Set
    GCPE_ALLOW_RAGGED=1 to record it and continue.

    Runs before anything is written, so a build that fails leaves no output to
    be seeded by mistake.
    """
    ragged: list[str] = []
    note("")
    for producer, entry in flat.items():
        zones = entry["zones"]
        grades = {g for cells in zones.values() for g in cells}
        expected = len(zones) * len(grades)
        actual = sum(len(cells) for cells in zones.values())
        shape = f"{len(zones)}x{len(grades)}"
        if actual == expected:
            note(f"complete {producer:<6} {shape:>9}  {actual:>6} cells")
            continue
        short = sorted(
            ((z, len(grades) - len(cells)) for z, cells in zones.items() if len(cells) < len(grades)),
            key=lambda pair: -pair[1],
        )
        detail = ", ".join(f"{z} (-{n})" for z, n in short[:5])
        line = (f"RAGGED   {producer:<6} {shape:>9}  {actual} of {expected} cells, "
                f"{len(short)} zone(s) short: {detail}")
        note(line)
        ragged.append(line)

    if ragged and not os.environ.get("GCPE_ALLOW_RAGGED"):
        raise SystemExit(
            f"\nBuild stopped before writing: {len(ragged)} producer(s) did not "
            "form a complete matrix.\n"
            + "\n".join(ragged)
            + "\n\nEither the circular changed shape and the reader has not kept up,"
            "\nor this round genuinely does not price every grade everywhere."
            "\nConfirm which, then re-run with GCPE_ALLOW_RAGGED=1 to accept it."
        )


def check_no_shrink(flat: dict, note) -> None:
    """Stop the build if a producer lost whole zones or grades since last round.

    A rectangle is not enough. Every extractor here addresses part of its
    document by page number, and a document that gains a page slides out from
    under those constants — quietly, because what comes back is a smaller
    rectangle, not a ragged one. Shifting HPL's LLDPE table by a single page
    reads 71 zones x 42 grades instead of 71 x 60: a complete matrix, 1,278
    prices gone, and the completeness gate above says nothing.

    So the shape is also compared against the last round that was accepted.
    Growth is fine and happens most months. A fall is not necessarily wrong —
    RIL withdrew 32 grades between August and September — but it is always
    worth a person's eye, which is the whole point.

    GCPE_ALLOW_SHRINK=1 accepts it for this run; GCPE_RECORD_SHAPE=1 writes the
    new shape as the baseline, so moving the line is always deliberate.
    """
    path = Path(__file__).resolve().parent / "expected_shape.json"
    shape = {
        p: {"zones": len(e["zones"]),
            "grades": len({g for cells in e["zones"].values() for g in cells})}
        for p, e in flat.items()
    }

    if path.exists():
        baseline = json.loads(path.read_text(encoding="utf-8"))
        shrunk = []
        for producer, now in shape.items():
            was = baseline.get("producers", {}).get(producer)
            if not was:
                continue
            for axis in ("zones", "grades"):
                if now[axis] < was[axis]:
                    shrunk.append(
                        f"SHRUNK   {producer:<6} {axis}: {was[axis]} -> {now[axis]}"
                        f"  ({was[axis] - now[axis]} fewer)")
        for line in shrunk:
            note(line)
        if shrunk and not os.environ.get("GCPE_ALLOW_SHRINK"):
            raise SystemExit(
                f"\nBuild stopped before writing: {len(shrunk)} producer axis/axes "
                f"fell below the accepted baseline in {path.name}.\n"
                + "\n".join(shrunk)
                + "\n\nA circular can genuinely withdraw grades or zones. A reader that"
                "\nhas lost a page of one reads exactly the same way."
                "\nConfirm which, then re-run with GCPE_ALLOW_SHRINK=1,"
                "\nand GCPE_RECORD_SHAPE=1 to move the baseline."
            )
    else:
        note(f"no baseline at {path.name}; run with GCPE_RECORD_SHAPE=1 to set one")

    if os.environ.get("GCPE_RECORD_SHAPE"):
        path.write_text(
            json.dumps({"round": PRICE_ROUND, "producers": shape}, indent=1),
            encoding="utf-8",
        )
        note(f"recorded {path.name} for round {PRICE_ROUND}")


# A cell that moves further than this between rounds is worth a person's eye.
# The largest genuine August-to-September move across all 55,439 cells was
# 5.34%; a book with its columns shifted by one moves 15-42% of its cells
# further than that. Ten per cent sits in the gap between the two.
DRIFT_LIMIT = 10.0
# One repriced grade is not a mispairing. A mispairing moves a whole column, so
# it shows up as a share of the book rather than a handful of cells.
DRIFT_SHARE = 0.5


def drift_report(flat: dict, note) -> dict:
    """Compare this round's prices to the last one, cell by cell.

    The gates above reason only about shape, and a mispairing that keeps every
    dimension passes them untouched: rotate a producer's columns by one and
    nothing objects. Values are what is left to check, and the useful property
    is that a price list barely moves between rounds while a mispairing moves
    most of it.

    Reports per producer and stops the build when too much of a book has moved,
    which is a question for a person rather than an error. GCPE_ALLOW_DRIFT=1
    accepts it; the report is written either way.
    """
    previous_path = Path(os.environ.get("GCPE_PREVIOUS", "") or (OUT / "price_index.json"))
    if not previous_path.exists():
        note(f"\nno previous round at {previous_path.name}; drift not checked")
        return {"compared_against": None, "producers": {}}

    previous = json.loads(previous_path.read_text(encoding="utf-8"))
    prior = previous.get("producers", {})
    stats: dict[str, dict] = {}
    movements: list[tuple[float, str, str, str, float, float]] = []

    for producer, entry in flat.items():
        was = prior.get(producer, {}).get("zones", {})
        moves: list[float] = []
        for zone, cells in entry["zones"].items():
            before = was.get(zone)
            if not before:
                continue
            for grade, now in cells.items():
                then = before.get(grade)
                if not then:
                    continue
                pct = abs(now - then) / then * 100.0
                moves.append(pct)
                movements.append((pct, producer, zone, grade, then, now))
        if not moves:
            stats[producer] = {"compared": 0}
            continue
        moves.sort()
        over5 = sum(1 for m in moves if m > 5.0)
        over10 = sum(1 for m in moves if m > DRIFT_LIMIT)
        stats[producer] = {
            "compared": len(moves),
            "median_pct": round(moves[len(moves) // 2], 3),
            "p95_pct": round(moves[int(len(moves) * 0.95)], 3),
            "max_pct": round(moves[-1], 3),
            "over_5pct": over5,
            "over_10pct": over10,
            "over_10pct_share": round(over10 / len(moves) * 100, 3),
        }

    movements.sort(reverse=True)
    top = [
        {"producer": p, "zone": z, "grade": g, "was": a, "now": b, "pct": round(pct, 3)}
        for pct, p, z, g, a, b in movements[:20]
    ]

    note(f"\nprice movement against {previous_path.parent.name}/{previous_path.name}")
    note(f"  {'producer':<8}{'compared':>10}{'median':>9}{'p95':>9}{'max':>9}"
         f"{'>5%':>8}{'>10%':>8}{'share':>9}")
    breached: list[str] = []
    for producer, s in stats.items():
        if not s.get("compared"):
            note(f"  {producer:<8}{'no comparable cells':>39}")
            continue
        note(f"  {producer:<8}{s['compared']:>10}{s['median_pct']:>8.2f}%{s['p95_pct']:>8.2f}%"
             f"{s['max_pct']:>8.2f}%{s['over_5pct']:>8}{s['over_10pct']:>8}"
             f"{s['over_10pct_share']:>8.2f}%")
        if s["over_10pct_share"] > DRIFT_SHARE:
            breached.append(
                f"DRIFT    {producer:<6} {s['over_10pct']} of {s['compared']} cells moved more "
                f"than {DRIFT_LIMIT:.0f}% ({s['over_10pct_share']:.2f}%, limit {DRIFT_SHARE}%)")

    if top:
        note("  largest movements:")
        for m in top[:5]:
            note(f"    {m['producer']:<6} {m['zone'][:18]:<18} {m['grade']:<11} "
                 f"{m['was']:>9,.0f} -> {m['now']:>9,.0f}  {m['pct']:>7.2f}%")

    if breached and not os.environ.get("GCPE_ALLOW_DRIFT"):
        raise SystemExit(
            f"\nBuild stopped before writing: {len(breached)} producer(s) moved more than "
            "a repricing normally does.\n" + "\n".join(breached)
            + "\n\nA whole column moving at once is what a mispairing looks like; a market"
            "\nthat genuinely moved looks the same from here."
            "\nCheck the largest movements above, then re-run with GCPE_ALLOW_DRIFT=1."
        )

    return {
        "compared_against": str(previous_path),
        "limit_pct": DRIFT_LIMIT,
        "share_limit_pct": DRIFT_SHARE,
        "producers": stats,
        "largest_movements": top,
    }


def write(name: str, payload) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    return path


def main() -> None:
    names = dict(FILES)
    if SOURCES_MANIFEST:
        manifest = json.loads(Path(SOURCES_MANIFEST).read_text(encoding="utf-8"))
        unknown = set(manifest) - set(FILES)
        if unknown:
            raise SystemExit(f"\n{SOURCES_MANIFEST} names sources that do not exist: "
                             f"{', '.join(sorted(unknown))}")
        names.update(manifest)
    src = {k: str(SOURCE / v) for k, v in names.items()}

    missing = [f"  {k:<16} {p}" for k, p in src.items() if not Path(p).exists()]
    if missing:
        raise SystemExit("\nBuild stopped: source files not found.\n" + "\n".join(missing))
    report: list[str] = []

    def note(line: str) -> None:
        report.append(line)
        print(line)

    check_round(src, note)

    # ---- GAIL -------------------------------------------------------------
    ex_works, gail_grades = gail_x.ex_works(src["gail_ex_works"])
    stock, _ = gail_x.stock_point(src["gail_stock_point"])
    gail_freight = gail_x.freight(src["gail_freight"])

    gail_locations = sorted({loc for _, loc in ex_works})
    note(f"GAIL ex-works   {len(gail_locations)} locations x {len(gail_grades)} grades")
    note(f"GAIL stockpoint {len(stock)} points")
    note(f"GAIL freight    {len(gail_freight['current'])} destinations")

    # ---- competitors ------------------------------------------------------
    iocl_prices = iocl_x.prices(src["iocl"])
    DISCOUNTS["IOCL"]["quantity_slabs"] = iocl_x.upliftment_slabs(src["iocl"])
    DISCOUNTS["HMEL"]["quantity_slabs"] = hmel_x.quantity_slabs()
    DISCOUNTS["OPaL"]["quantity_slabs"] = opal_x.quantity_slabs()
    DISCOUNTS["HPL"]["quantity_slabs"] = haldia_x.quantity_slabs()

    ril_prices = ril_x.prices(src["ril"])
    hmel_prices = hmel_x.prices(src["hmel"])
    haldia_hdpe = haldia_x.prices(src["haldia"])
    haldia_lldpe = haldia_x.lldpe_prices(src["haldia"])
    haldia_territory = haldia_x.territory_map(src["haldia"])
    opal_dta = opal_x.prices(src["opal_dta"])
    opal_csa = opal_x.prices(src["opal_csa"])

    note(f"IOCL   {len(iocl_prices['delivered'])} zones (delivered)")
    note(f"RIL    {len(ril_prices)} annexures, {len(ril_prices['IA']['zones'])} zones")
    note(f"HMEL   {len(hmel_prices['ex_works'])} locations, {len(hmel_prices['basic'])} grades")
    note(f"HPL    {len(haldia_hdpe['I']['points'])} price points, {len(haldia_territory)} mapped")
    note(f"OPaL   DTA {len(opal_dta['sheets'].get('DTA-HDPE', {}))} zones, CSA {len(opal_csa['sheets'].get('CS2-PE', {}))} zones")

    # ---- freight ----------------------------------------------------------
    freights = {
        "GAIL": [
            {"destination": k, "rate_per_mt": v}
            for k, v in gail_freight["current"].items()
        ],
        "HMEL": freight_x.hmel(src["hmel_freight"]),
        "HPL": freight_x.hpl(src["hpl_freight"]),
        "OPaL": freight_x.opal(src["opal_freight"]),
    }
    for producer, book in freights.items():
        note(f"freight {producer:<5} {len(book)} destinations")

    # ---- one uniform price index -----------------------------------------
    # Each producer publishes a different shape; the engine should not have to
    # know six of them. Flatten to {producer: {basis, zones: {zone: {grade: p}}}}
    # here, where the knowledge of each source already lives.
    def merge(target: dict, zone: str, cells: dict) -> None:
        target.setdefault(zone, {}).update({g: float(v) for g, v in cells.items()})

    flat: dict[str, dict] = {}

    gail_zones: dict[str, dict] = {}
    for (_, loc), cells in ex_works.items():
        merge(gail_zones, loc, cells)
    flat["GAIL"] = {"basis": "ex_works", "zones": gail_zones}

    flat["IOCL"] = {"basis": "delivered", "zones": iocl_prices["delivered"]}

    # RIL supplies the same grade from several plants at slightly different
    # delivered prices (B56003 into Mumbai: 140,636 ex-Hazira, 140,629 ex-Dahej).
    # Merging blind would let whichever annexure is read last win. Keep every
    # plant, and quote the cheapest — that is the offer the customer can get.
    # Deemed-export annexures are deliberately excluded: different customer
    # category, ~12,000/MT lower, and not comparable with a domestic sale.
    ril_zones: dict[str, dict] = {}
    ril_plants: dict[str, dict] = {}
    DOMESTIC = ("IA", "IB", "IC", "ID", "IE", "IF", "IIA", "IIB", "IIC")
    for annexure in DOMESTIC:
        caption = ril_prices.get(annexure, {}).get("caption", annexure)
        for zone, entry in ril_prices.get(annexure, {}).get("zones", {}).items():
            for grade, price in entry["prices"].items():
                cell = ril_zones.setdefault(zone, {})
                if grade not in cell or price < cell[grade]:
                    cell[grade] = float(price)
                    ril_plants.setdefault(zone, {})[grade] = caption
    flat["RIL"] = {"basis": "delivered", "zones": ril_zones, "supply_point": ril_plants}

    flat["HMEL"] = {"basis": "ex_works", "zones": hmel_prices["ex_works"]}

    hpl_zones: dict[str, dict] = {}
    for point, cells in haldia_hdpe["I"]["points"].items():
        merge(hpl_zones, point, cells)
    for point, cells in haldia_lldpe["ex_works"].items():
        merge(hpl_zones, point, cells)
    # Stacked header names share their column's price (HDT10/HDT10S).
    hpl_aliases = {**haldia_hdpe["I"]["aliases"], **haldia_lldpe["aliases"]}
    for cells in hpl_zones.values():
        for alias, primary in hpl_aliases.items():
            if primary in cells:
                cells.setdefault(alias, cells[primary])
    flat["HPL"] = {"basis": "ex_works", "zones": hpl_zones}

    opal_zones: dict[str, dict] = {}
    for sheet in ("DTA-HDPE", "DTA-LLDPE"):
        for zone, entry in opal_dta["sheets"].get(sheet, {}).items():
            merge(opal_zones, zone, entry["prices"])
    for cells in opal_zones.values():
        for alias, primary in opal_dta["aliases"].items():
            if primary in cells:
                cells.setdefault(alias, cells[primary])
    flat["OPaL"] = {"basis": "ex_works", "zones": opal_zones}

    # Three separate questions, asked in order of how cheaply they are answered:
    # is each book a rectangle, has one lost whole grades or zones, and have the
    # values moved further than a repricing normally does.
    check_complete(flat, note)
    check_no_shrink(flat, note)
    drift = drift_report(flat, note)

    for producer, payload in flat.items():
        cells = sum(len(z) for z in payload["zones"].values())
        note(f"index {producer:<5} {len(payload['zones']):>3} zones, {cells:>6} prices ({payload['basis']})")


    # ---- location resolution ---------------------------------------------
    resolvers = {
        "IOCL": Resolver("IOCL", sorted(iocl_prices["delivered"])),
        "RIL": Resolver("RIL", sorted(ril_prices["IA"]["zones"])),
        "HMEL": Resolver("HMEL", sorted(hmel_prices["ex_works"])),
        "HPL": Resolver("HPL", sorted(haldia_hdpe["I"]["points"])),
        "OPaL": Resolver("OPaL", sorted(opal_dta["sheets"].get("DTA-HDPE", {}))),
    }
    resolvers["HPL"].add_district_map(haldia_territory)

    # Aliases proven from the MZO workbook: where a competitor price the zonal
    # team used appears at exactly one zone in that producer's circular, that
    # zone is the one they price this town at. This beats guessing by name — it
    # is how Bhiwandi reaches HPL's Maharashtra_Mumbai, which no amount of
    # string matching would find, since HPL lists the district (Thane) not the
    # town.
    evidence = derive_aliases(flat, mzo.expectations(src["mzo"]))
    for producer, mapping in evidence.items():
        if producer in resolvers:
            resolvers[producer].add_evidence(mapping)
    note(
        "evidence-derived aliases: "
        + ", ".join(f"{p} {len(m)}" for p, m in sorted(evidence.items()))
    )
    for producer, resolver in resolvers.items():
        if producer != "HPL":
            resolver.add_cluster_hubs(haldia_territory)

    # Freight destinations need resolving too, and through the same machinery:
    # HMEL and HPL both deliver to Goa, but bill it as "Panaji". A second,
    # ad-hoc lookup path is how one of them silently reports "no freight".
    freight_resolvers = {
        producer: Resolver(producer, sorted({e["destination"] for e in book}))
        for producer, book in freights.items()
    }
    freight_evidence = derive_freight_aliases(freights, mzo.expectations(src["mzo"]))
    for producer, resolver in freight_resolvers.items():
        resolver.add_evidence(freight_evidence.get(producer, {}))
        resolver.add_cluster_hubs(haldia_territory)
    freight_map = {
        producer: resolver.coverage(gail_locations)["map"]
        for producer, resolver in freight_resolvers.items()
    }
    note(
        "freight destinations resolved: "
        + ", ".join(f"{p} {len(m)}/{len(gail_locations)}" for p, m in sorted(freight_map.items()))
    )

    coverage = {p: r.coverage(gail_locations) for p, r in resolvers.items()}
    note("")
    note("location coverage against GAIL's 313 ex-works locations:")
    for producer, cov in coverage.items():
        pct = cov["resolved"] / cov["total"] * 100
        tiers = ", ".join(
            f"{k}={v}" for k, v in sorted(cov["tiers"].items()) if k != "unresolved"
        )
        note(
            f"  {producer:<5} {cov['resolved']:>3}/{cov['total']} ({pct:4.1f}%)"
            f"  from {cov['zones_published']} published zones  [{tiers}]"
        )
    priced = len({l for c in coverage.values() for l in c["map"]})
    note(f"  GAIL locations with at least one competitor price: {priced}/{len(gail_locations)}")

    # ---- cross-reference --------------------------------------------------
    xref = crossref.load(src["crossref"])
    xref_index = crossref.index_by_gail_grade(xref)
    note(f"\ncross-reference  {len(xref_index)} GAIL grades, {len(xref['gaps'])} portfolio gaps")

    # ---- emit -------------------------------------------------------------
    write(
        "prices",
        {
            "effective_date": PRICE_ROUND,
            "gail": {
                "ex_works": {
                    loc: cells for (_, loc), cells in ex_works.items()
                },
                "stock_point": {
                    f"{sap}|{loc}": cells for (sap, loc), cells in stock.items()
                },
                "grades": gail_grades,
                "basis": "ex_works",
            },
            "iocl": {"prices": iocl_prices, "basis": "delivered"},
            "ril": {"annexures": ril_prices, "basis": "delivered"},
            "hmel": {**hmel_prices, "basis": "ex_works"},
            "hpl": {
                "hdpe": haldia_hdpe,
                "lldpe": haldia_lldpe,
                "territory": haldia_territory,
                "basis": "ex_works",
            },
            "opal": {"dta": opal_dta, "csa": opal_csa, "basis": "ex_works"},
        },
    )
    write("freight", {"effective_date": FREIGHT_ROUND, "books": freights,
                      "destination_map": freight_map,
                      "gail_previous": gail_freight["previous"],
                      "gail_pricing_points": gail_freight["pricing_points"]})
    write("discounts", {"effective_date": PRICE_ROUND, "producers": DISCOUNTS})
    write("crossref", {**xref, "index": xref_index})
    # Spelling variants travel with the data. The engine normalises place names
    # too, and a divergent copy of this table in TypeScript would silently
    # reintroduce the "no freight to Bhiwandi" class of miss.
    write(
        "locations",
        {
            "canonical": gail_locations,
            "coverage": coverage,
            "spellings": SPELLINGS,
        },
    )

    write(
        "price_index",
        {
            "effective_date": PRICE_ROUND,
            "producers": flat,
            "location_map": {p: c["map"] for p, c in coverage.items()},
            "location_tier": {p: c["tier_of"] for p, c in coverage.items()},
        },
    )

    write("drift_report", {"generated_for": PRICE_ROUND, **drift})
    write("build_report", {"generated_for": PRICE_ROUND, "lines": report})
    note(f"\nwrote {len(list(OUT.glob('*.json')))} files to {OUT}")


if __name__ == "__main__":
    main()
