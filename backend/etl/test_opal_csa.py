"""
Regression check for the OPaL CSA (Ex Depot) reader: the Silvassa and Daman rows.

    py -3 test_opal_csa.py "<OPAL CSA circular for 16 Sep 2026>.pdf"

On those two rows the PDF draws "Dadra and Nagar Haveli and Daman and Diu" over the first price, and
Silvassa's label wraps onto a line of its own. Until 2026-09-29 the reader lost 30 of Silvassa's 39
Ex Depot prices and 3 of Daman's. Expected values are read off the circular's CS1-PE annexure.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "extractors"))
import depot  # noqa: E402
import opal  # noqa: E402

EXPECTED = {
    # zone: {grade: price} — the fused first price, the one glued to "Diu", and a clean one
    "Daman": {"M6112": 132231, "B48H02U": 146171, "B6003": 141491, "F2001S": 141031},
    "Silvassa": {"M6112": 132240, "B48H02U": 146180, "B6003": 141510, "F2001S": 141030, "ULLE": None},
}


def main(pdf: str) -> int:
    csa = opal.prices(pdf)
    zones = depot.opal(csa)["zones"]
    reference = len(zones["Ahmedabad"])
    failures = []
    for zone, expected in EXPECTED.items():
        got = zones.get(zone, {})
        if len(got) != reference:
            failures.append(f"{zone}: {len(got)} codes, Ahmedabad has {reference}")
        for grade, price in expected.items():
            if price is None:
                if grade not in got:
                    failures.append(f"{zone} {grade}: missing")
            elif got.get(grade) != price:
                failures.append(f"{zone} {grade}: {got.get(grade)} expected {price}")
    print(f"Silvassa {len(zones.get('Silvassa', {}))}, Daman {len(zones.get('Daman', {}))}, Ahmedabad {reference} codes")
    for f in failures:
        print("  FAIL", f)
    print("PASS" if not failures else "FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
