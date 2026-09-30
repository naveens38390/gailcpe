"""
Regression check: a rebuild of the cross-reference must reproduce what production serves.

    py -3 test_crossref_decisions.py <master.xlsx> [<master.xlsx> ...]

For each master given, runs the same two steps build.py runs (load + approved decisions) and
compares the result with the committed data/normalized/crossref.json, the file the database is
seeded from and which equals production's gradeMappings (verified 2026-09-29). Exit 1 on any
difference. Run it with the client's original master and with the corrected one: both must pass.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "extractors"))
import crossref  # noqa: E402


def rebuild(master: str) -> dict:
    xref = crossref.load(master)
    index = crossref.index_by_gail_grade(xref)
    decisions = json.loads((HERE / "reference" / "crossref_decisions.json").read_text(encoding="utf-8"))
    crossref.apply_decisions(index, decisions["decisions"])
    return {**xref, "index": index}


def main(masters: list[str]) -> int:
    committed = json.loads((HERE.parent / "data" / "normalized" / "crossref.json").read_text(encoding="utf-8"))
    failed = 0
    for master in masters:
        built = rebuild(master)
        diffs = []
        for grade in sorted(set(built["index"]) | set(committed["index"])):
            a, b = built["index"].get(grade), committed["index"].get(grade)
            if a != b:
                diffs.append(f"    {grade}: rebuilt {a and a.get('equivalents')} / committed {b and b.get('equivalents')}")
        whole = json.dumps(built, sort_keys=True) == json.dumps(committed, sort_keys=True)
        print(f"{Path(master).name}: {len(built['index'])} grades, {len(diffs)} differ from crossref.json"
              f"{'' if whole else ' (other sections differ too)' if not diffs else ''}")
        for d in diffs:
            print(d)
        failed += bool(diffs) or not whole
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
