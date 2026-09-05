"""Run the pipeline against the September 2026 circulars, into staging.

The extractors have never seen these documents. Nothing here writes to
data/normalized: the output directory is redirected, and the August sources are
left in place so the two rounds can be built and compared side by side.

    py -3 run_september.py [outdir]
"""

from __future__ import annotations

import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

# Set before build is imported: PRICE_ROUND is read from the environment at
# import time, and check_round() then requires every circular to state it.
os.environ.setdefault("GCPE_PRICE_ROUND", "2026-09-01")

import build  # noqa: E402

DOWNLOADS = pathlib.Path("C:/Users/DELL/Downloads")

SEPTEMBER = {
    "gail_ex_works": "PE - Ex Works Basic Prices w.e.f. September 1, 2026.pdf",
    "gail_stock_point": "PE - Stock Point prices w.e.f. September 1, 2026.pdf",
    "iocl": "IOC PE Price List 01 Sept 2026.pdf",
    "ril": "PE RO PRICE CIRCULAR wef 01.09.2026.pdf",
    "hmel": "PE Price Circular 01.09.2026.pdf",
    "haldia": "HPL PE PRICE LIST 01st SEPT 2026.pdf",
    "opal_dta": "OPaL Polymers DTA price circular_PE wef 1st September 2026.pdf",
    "opal_csa": "OPaL Polymers CSA price circular_PE wef 1st September 2026.pdf",
}

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "D:/Gail2/staged/sept")
out.mkdir(parents=True, exist_ok=True)

for key, name in SEPTEMBER.items():
    path = DOWNLOADS / name
    if not path.exists():
        raise SystemExit(f"missing source: {path}")
    build.FILES[key] = str(path)

build.OUT = out
build.main()
