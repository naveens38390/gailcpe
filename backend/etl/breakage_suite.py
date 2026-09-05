"""Break each extractor on purpose and prove the build refuses to ship it.

The gates are only worth what they catch, and reasoning about that is not
evidence. Each scenario below edits one extractor to reintroduce a defect this
audit actually found — or, for GAIL, to invent one it has not seen — runs the
full pipeline, and records three things: the exit code, whether any file was
written, and which gate spoke.

Every edit is made to a copy of the file and reverted in a finally block, so
the tree is the same afterwards whatever happens. The suite verifies that too.

    py -3 breakage_suite.py
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = Path("D:/Gail2/staged/breakage")
RUNNER = HERE / "run_september.py"

# (name, file, find, replace, what this reproduces[, (find2, replace2)])
SCENARIOS = [
    ("HMEL — a grade column removed",
     "extractors/hmel.py",
     "            for code, (price, _, _, _) in zip(codes, bands):",
     "            for code, (price, _, _, _) in list(zip(codes, bands))[:-1]:",
     "the last column of every section silently dropped"),

    # Both held-name guards have to go together. Removing either one alone
    # leaves the other covering it, and the build stays clean — which is how
    # the first version of this suite reported a pass for the wrong reason.
    ("IOCL — orphan-row defect reintroduced",
     "extractors/iocl.py",
     '            pending = ""\n            continue\n        matched',
     "            continue\n        matched",
     "a caption held as a zone name and claimed by an orphaned row",
     ('            basis = matched\n            pending = ""\n            continue',
      "            basis = matched\n            continue")),

    ("HPL — LLDPE section shifted one page",
     "extractors/haldia.py",
     "pages=[6, 7]",
     "pages=[7, 8]",
     "a circular that gained a page"),

    ("OPaL — stacked-header defect reintroduced",
     "extractors/opal.py",
     "        columns = _columns(block[0])",
     "        columns = [(w.text, w.xmid) for w in block[0].words\n"
     "                   if GRADE_CODE.match(w.text) and w.text not in ('Zone', 'State')]",
     "F52H04/ rejected by the code shape, F52H02 aliased to a neighbour"),

    # The first version made the pattern one character stricter, which every
    # GAIL code still satisfied. It broke nothing, and the build shipping was
    # the right answer to a question that had not been asked. This one rejects
    # seven printed columns, which is the risk actually being tested.
    ("GAIL — the code shape rejects a printed column",
     "extractors/gail.py",
     'GRADE_CODE = re.compile(r"^[A-Z]{1,2}\\d[0-9A-Z]{3,}$")',
     'GRADE_CODE = re.compile(r"^(?!W)[A-Z]{1,2}\\d[0-9A-Z]{3,}$")',
     "a header word the shape does not admit, as happened to HMEL, HPL and OPaL"),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run() -> tuple[int, str]:
    if OUT.exists():
        shutil.rmtree(OUT)
    # No GCPE_ALLOW_SHRINK here. Setting it — as the first version of this
    # suite did, because September legitimately shrinks against an August
    # baseline — disables the gate most of these scenarios depend on, and every
    # one of them then "passed" by shipping. The baseline is recorded at
    # September first instead, so nothing legitimate is pending.
    env = {**os.environ, "GCPE_PRICE_ROUND": "2026-09-01",
           "PYTHONIOENCODING": "utf-8"}
    env.pop("GCPE_ALLOW_SHRINK", None)
    proc = subprocess.run([sys.executable, str(RUNNER), str(OUT)],
                          capture_output=True, text=True, env=env, cwd=HERE)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def gate_of(log: str) -> str:
    if "do not state" in log:
        return "round guard"
    if "did not form a complete matrix" in log:
        return "rectangle gate"
    if "fell below the accepted baseline" in log:
        return "shrink gate"
    return "none"


print("=" * 82)
print("DELIBERATE BREAKAGE — does the pipeline refuse to ship it?")
print("=" * 82)

SHAPE = HERE / "expected_shape.json"
shape_backup = SHAPE.read_text(encoding="utf-8") if SHAPE.exists() else None

# Record the baseline at September, so the only shrink any scenario can trip is
# the one it caused. Against the August baseline RIL is legitimately 30 grades
# down, and suppressing that would switch off the gate for everything else.
subprocess.run(
    [sys.executable, str(RUNNER), str(OUT)],
    capture_output=True, text=True, cwd=HERE,
    env={**os.environ, "GCPE_PRICE_ROUND": "2026-09-01",
         "GCPE_ALLOW_SHRINK": "1", "GCPE_RECORD_SHAPE": "1",
         "PYTHONIOENCODING": "utf-8"},
)

# A control: unbroken, the pipeline must still ship. Without it, a suite that
# stopped everything would look like a pass.
control_code, control_log = run()
control_files = len(list(OUT.glob("*.json"))) if OUT.exists() else 0

before = {s[1]: digest(HERE / s[1]) for s in SCENARIOS}
results = [("CONTROL — nothing broken (must ship)",
            "SHIPPED" if control_code == 0 else "STOPPED",
            str(control_code), str(control_files), gate_of(control_log))]

for scenario in SCENARIOS:
    name, rel, find, replace, reproduces = scenario[:5]
    extra = scenario[5] if len(scenario) > 5 else None
    target = HERE / rel
    original = target.read_text(encoding="utf-8")
    if find not in original:
        results.append((name, "SKIPPED", "-", "-", "pattern not found — extractor has moved on"))
        continue
    backup = Path(tempfile.gettempdir()) / f"bk_{target.name}"
    backup.write_text(original, encoding="utf-8")
    try:
        edited = original.replace(find, replace, 1)
        if extra:
            if extra[0] not in edited:
                raise SystemExit(f"second edit for {name!r} did not match")
            edited = edited.replace(extra[0], extra[1], 1)
        target.write_text(edited, encoding="utf-8")
        code, log = run()
        files = len(list(OUT.glob("*.json"))) if OUT.exists() else 0
        results.append((name, "STOPPED" if code != 0 else "SHIPPED",
                        str(code), str(files), gate_of(log)))
    finally:
        target.write_text(backup.read_text(encoding="utf-8"), encoding="utf-8")

# Confirm nothing was left modified.
after = {rel: digest(HERE / rel) for rel in before}
restored = all(before[k] == after[k] for k in before)

print(f"\n{'scenario':<48}{'result':<10}{'exit':>5}{'files':>7}   gate")
print("-" * 82)
shipped = 0
control_ok = True
for name, verdict, code, files, gate in results:
    is_control = name.startswith("CONTROL")
    if is_control:
        control_ok = verdict == "SHIPPED"
    elif verdict == "SHIPPED":
        shipped += 1
    print(f"{name:<48}{verdict:<10}{code:>5}{files:>7}   {gate}")

if OUT.exists():
    shutil.rmtree(OUT)

print("-" * 82)
print(f"{len(results) - 1} broken scenarios, {shipped} reached output")
print(f"control shipped as it should: {'yes' if control_ok else 'NO'}")
print(f"extractor files restored byte-for-byte: {'yes' if restored else 'NO'}")

# Leave the baseline where it was found, so running this changes nothing.
if shape_backup is not None:
    SHAPE.write_text(shape_backup, encoding="utf-8")
elif SHAPE.exists():
    SHAPE.unlink()
print(f"expected_shape.json restored: {'yes' if shape_backup is not None else 'removed'}")

sys.exit(1 if shipped or not restored or not control_ok else 0)
