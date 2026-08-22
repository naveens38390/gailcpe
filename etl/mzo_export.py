"""Export the MZO workbook's own numbers as an engine acceptance test."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "extractors"))
import mzo

OUT = Path(__file__).resolve().parent.parent / "data" / "normalized"
rows = mzo.expectations(str(Path("D:/Gail") / "20260801 - Price comparision - MZO.xlsx"))
(OUT / "mzo_expectations.json").write_text(
    json.dumps({"source": "20260801 - Price comparision - MZO.xlsx", "rows": rows},
               indent=1, ensure_ascii=False), encoding="utf-8")
print(f"{len(rows)} expectation rows")
import collections
print("by producer:", dict(collections.Counter(r["producer"] for r in rows)))
print("by sheet:", dict(collections.Counter(r["sheet"] for r in rows)))
print("locations:", sorted({r["location"] for r in rows}))
for r in rows[:4]: print("  ", r)
