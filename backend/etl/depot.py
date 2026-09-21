"""Ex-depot price books, flattened to the same {zone: {grade: price}} shape as ex-works.

Every producer prints a second price list for stock the customer collects from a
depot or warehouse, and each names it differently:

    GAIL   stock-point sheet          one row per SAP stock point, several per town
    IOCL   Ex DOPW and Ex RSC tables  two depot networks, some towns in both
    RIL    annexures VII-A/B, VIII-A  "MH Mumbai RIL BHIWANDI DEPO", one row per depot
    HMEL   ex-depot basic price       per location, flat
    HPL    ex-stock price             the same 71 price points as ex-works
    OPaL   CSA warehouse sheets       consignment-stockist prices per city

Where a town has more than one depot (or a producer prints a grade in two
tables) the cheapest price is kept, and the depot it came from is recorded — the
same rule the ex-works index already applies to RIL's plants: it is the offer a
customer can actually get.
"""

from __future__ import annotations

from locations import normalise


def _merge_min(target: dict, zone: str, cells: dict, source: dict | None = None,
               label: str | None = None) -> None:
    into = target.setdefault(zone, {})
    for grade, price in cells.items():
        value = float(price)
        if grade not in into or value < into[grade]:
            into[grade] = value
            if source is not None and label:
                source.setdefault(zone, {})[grade] = label


def gail(stock: dict) -> dict:
    """{(sap, location): cells} -> one zone per town, cheapest across its stock points."""
    zones: dict[str, dict] = {}
    names: dict[str, str] = {}
    for (_sap, location), cells in stock.items():
        name = names.setdefault(normalise(location), location.strip())
        _merge_min(zones, name, cells)
    return {"zones": zones}


def iocl(prices: dict) -> dict:
    zones: dict[str, dict] = {}
    source: dict[str, dict] = {}
    for table in ("ex_dopw", "ex_rsc"):
        for zone, cells in prices.get(table, {}).items():
            _merge_min(zones, zone, cells, source, table)
    return {"zones": zones, "supply_point": source}


# RIL prints one row per depot, headed by a two-letter state code and the town.
RIL_DEPOT_ANNEXURES = ("VIIA", "VIIB", "VIIIA")


def ril_town(zone: str) -> str:
    parts = zone.split()
    return parts[1] if len(parts) > 1 else zone


def ril(annexures: dict) -> dict:
    zones: dict[str, dict] = {}
    source: dict[str, dict] = {}
    for key in RIL_DEPOT_ANNEXURES:
        for zone, entry in annexures.get(key, {}).get("zones", {}).items():
            _merge_min(zones, ril_town(zone).title(), entry["prices"], source, zone)
    return {"zones": zones, "supply_point": source}


def hmel(prices: dict) -> dict:
    zones: dict[str, dict] = {}
    for location, cells in prices.get("depot", {}).items():
        _merge_min(zones, location, cells)
    return {"zones": zones}


def hpl(hdpe: dict, lldpe: dict) -> dict:
    zones: dict[str, dict] = {}
    for point, cells in hdpe["II"]["points"].items():
        _merge_min(zones, point, cells)
    for point, cells in lldpe["ex_stock"].items():
        _merge_min(zones, point, cells)
    aliases = {**hdpe["II"]["aliases"], **lldpe["aliases"]}
    for cells in zones.values():
        for alias, primary in aliases.items():
            if primary in cells:
                cells.setdefault(alias, cells[primary])
    return {"zones": zones}


# The circular prints two annexures, and their own captions say which is which:
# CS1-PE is the "Price List for Domestic Sales ex CSA Warehouse" — what a
# customer pays — and CS2-PE is the "Stock Transfer Price List for Consignment
# Stockists" — what OPaL charges its own stockists. Only CS1 is a customer price,
# and it is the list the zonal workbook's OPaL depot figures come from.
OPAL_DEPOT_SHEET = "CS1-PE"


def opal(csa: dict) -> dict:
    zones: dict[str, dict] = {}
    for zone, entry in csa["sheets"].get(OPAL_DEPOT_SHEET, {}).items():
        _merge_min(zones, zone, entry["prices"])
    for cells in zones.values():
        for alias, primary in csa["aliases"].items():
            if primary in cells:
                cells.setdefault(alias, cells[primary])
    return {"zones": zones}
