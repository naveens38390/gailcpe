"""Regenerate the freight destination map with the real ETL resolver.

Offline analysis only. Runs the same Resolver, the same MZO evidence
derivation and the same cluster-hub inference that build.py uses, once against
the freight books production carries and once against the books read from the
producers' PDFs, and reports every mapping that differs.

This exists because the earlier impact analysis modelled only the resolver's
exact-match tier. The real resolver ranks MZO *evidence* above an exact name
match, so a corrected book does not automatically repoint a town at itself —
which is precisely the assumption that needed testing.

Writes to D:/Gail2/staged. Publishes nothing, changes no production data.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "extractors"))

import haldia as haldia_x  # noqa: E402
import mzo  # noqa: E402
from locations import Resolver, derive_freight_aliases  # noqa: E402

SOURCE = Path("D:/Gail")
NORM = HERE.parent / "data" / "normalized"
STAGED = Path("D:/Gail2/staged")

MZO_FILE = str(SOURCE / "20260801 - Price comparision - MZO.xlsx")
HALDIA_FILE = str(SOURCE / "Haldia.pdf")


def build_map(books: dict[str, list[dict]], gail_locations: list[str],
              haldia_territory, mzo_rows) -> dict:
    """Exactly what build.py does for freight_map, plus the tier of each hit."""
    resolvers = {
        producer: Resolver(producer, sorted({e["destination"] for e in book}))
        for producer, book in books.items()
    }
    evidence = derive_freight_aliases(books, mzo_rows)
    for producer, resolver in resolvers.items():
        resolver.add_evidence(evidence.get(producer, {}))
        resolver.add_cluster_hubs(haldia_territory)
    return {
        producer: resolver.coverage(gail_locations)
        for producer, resolver in resolvers.items()
    }


def main() -> None:
    current = json.loads((NORM / "freight.json").read_text(encoding="utf8"))
    corrected = json.loads((STAGED / "freight.corrected.json").read_text(encoding="utf8"))
    locations = json.loads((NORM / "locations.json").read_text(encoding="utf8"))
    gail_locations = locations["canonical"]

    print("reading Haldia territory map and MZO workbook ...")
    haldia_territory = haldia_x.territory_map(HALDIA_FILE)
    mzo_rows = mzo.expectations(MZO_FILE)
    print(f"  haldia territory points: {len(haldia_territory)}")
    print(f"  mzo rows: {len(mzo_rows)}")

    before = build_map(current["books"], gail_locations, haldia_territory, mzo_rows)
    after = build_map(corrected["books"], gail_locations, haldia_territory, mzo_rows)

    print("\ncoverage, resolved of 313 locations:")
    for producer in sorted(before):
        b, a = before[producer], after[producer]
        print(f"  {producer:<5} {b['resolved']:>4} -> {a['resolved']:>4}"
              f"   zones {b['zones_published']:>4} -> {a['zones_published']:>4}")

    print("\ntier mix:")
    for producer in sorted(before):
        print(f"  {producer}")
        print(f"    before {before[producer]['tiers']}")
        print(f"    after  {after[producer]['tiers']}")

    # ---- every mapping that changes ---------------------------------------
    deltas = []
    for producer in sorted(before):
        bmap, amap = before[producer]["map"], after[producer]["map"]
        btier, atier = before[producer]["tier_of"], after[producer]["tier_of"]
        for loc in gail_locations:
            b, a = bmap.get(loc), amap.get(loc)
            if b == a:
                continue
            deltas.append({
                "producer": producer,
                "location": loc,
                "from": b,
                "from_tier": btier.get(loc),
                "to": a,
                "to_tier": atier.get(loc),
            })

    print(f"\nmappings that change: {len(deltas)}")
    print(f"{'producer':<7}{'location':<24}{'from':<26}{'to':<26}tier")
    print("-" * 96)
    for d in deltas:
        frm = f"{d['from']} ({d['from_tier']})" if d["from"] else "unresolved"
        to = f"{d['to']} ({d['to_tier']})" if d["to"] else "unresolved"
        print(f"{d['producer']:<7}{d['location']:<24}{frm:<26}{to:<26}")

    # ---- did the towns we expected to repoint actually repoint? -----------
    expected = json.loads((STAGED / "route-correction-sheet.json").read_text(encoding="utf8"))
    print("\ncheck against the 30 routes the exact-match model predicted:")
    agree, disagree = 0, 0
    for r in expected:
        producer, loc = r["producer"], r["location"]
        amap = after[producer]["map"]
        atier = after[producer]["tier_of"]
        got = amap.get(loc)
        # The model assumed the town would point at itself once its row existed.
        from locations import normalise as _n
        if got and _n(got) == _n(loc):
            agree += 1
        else:
            disagree += 1
            print(f"  DIFFERS  {producer:<5} {loc:<22} real ETL -> {got} ({atier.get(loc)})")
    print(f"  agree {agree} · differ {disagree}")

    STAGED.mkdir(parents=True, exist_ok=True)
    (STAGED / "destination-map.regenerated.json").write_text(
        json.dumps({p: after[p]["map"] for p in after}, indent=1, ensure_ascii=False),
        encoding="utf8",
    )
    (STAGED / "destination-map.regenerated.delta.json").write_text(
        json.dumps(deltas, indent=1, ensure_ascii=False), encoding="utf8"
    )
    (STAGED / "destination-map.regenerated.tiers.json").write_text(
        json.dumps({p: after[p]["tier_of"] for p in after}, indent=1, ensure_ascii=False),
        encoding="utf8",
    )
    print("\nwritten to", STAGED)


if __name__ == "__main__":
    main()
