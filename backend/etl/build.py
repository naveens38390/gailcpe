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

SOURCE = Path("D:/Gail")
OUT = Path(__file__).resolve().parent.parent / "data" / "normalized"

PRICE_ROUND = "2026-08-01"
FREIGHT_ROUND = "2026-06-01"

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

    check_no_shrink(flat, note)


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


def write(name: str, payload) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    return path


def main() -> None:
    src = {k: str(SOURCE / v) for k, v in FILES.items()}
    report: list[str] = []

    def note(line: str) -> None:
        report.append(line)
        print(line)

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

    check_complete(flat, note)

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

    write("build_report", {"generated_for": PRICE_ROUND, "lines": report})
    note(f"\nwrote {len(list(OUT.glob('*.json')))} files to {OUT}")


if __name__ == "__main__":
    main()
