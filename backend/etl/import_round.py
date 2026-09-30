"""
One-command import of a price round (the bridge until the API extracts prices itself).

    py -3 import_round.py --folder "D:/Circulars/2026-10-01" --round 2026-10-01
    py -3 import_round.py --folder ... --round ... --dry-run        # build + extracts only, nothing sent

What it does, in order, stopping at the first problem:
  1. Recognises the round's price circulars in --folder by producer (GAIL Ex Works and Stock Point,
     IOCL, RIL, HMEL, HPL, OPaL DTA and CSA). Every one of the eight must be there.
  2. Runs the ETL (build.py) on them with all its gates. A gate that stops (shrink, drift, location
     fallback) is a decision for a person, not something to override here; --allow-shrink /
     --allow-drift pass an acknowledgement through when that person has made it.
  3. Writes one extract per producer: its works/delivered book plus its Ex Depot book, so that
     publishing the circular also publishes its depot prices.
  4. Unless --dry-run: signs in to the app, files any of the round's documents not yet on file, and
     attaches each producer's extract to its main circular. The circulars then wait as drafts.

The client then opens Circulars -> Publish all, checks the summary and publishes.

Sign-in: GCPE_EMAIL and GCPE_PASSWORD from the environment, or asked for. Nothing is stored.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "extractors"))

API_DEFAULT = "https://gcpe-api.onrender.com/api"
BASE_MANIFEST_DEFAULT = "D:/Gail2/staged/round-2026-09-16/manifest-2026-09-16.json"
CROSSREF_DEFAULT = "D:/Gail2/Documents/GAIL_PE_CrossReference_Master_2026-09-28.xlsx"
PRICE_KEYS = ["gail_ex_works", "gail_stock_point", "iocl", "ril", "hmel", "haldia", "opal_dta", "opal_csa"]
PRODUCER_OF = {"gail_ex_works": "GAIL", "gail_stock_point": "GAIL", "iocl": "IOCL", "ril": "RIL", "hmel": "HMEL",
               "haldia": "HPL", "opal_dta": "OPaL", "opal_csa": "OPaL"}
MAIN_KEY = {"GAIL": "gail_ex_works", "IOCL": "iocl", "RIL": "ril", "HMEL": "hmel", "HPL": "haldia", "OPaL": "opal_dta"}

PATTERNS = [  # most specific first, as in the app's detector
    ("HPL", re.compile(r"haldia\s+petrochemicals|\bHPL\b", re.I)),
    ("HMEL", re.compile(r"HPCL[\s-]*Mittal|\bHMEL\b", re.I)),
    ("OPaL", re.compile(r"ONGC\s+Petro[\s-]*additions|\bOPaL\b", re.I)),
    ("IOCL", re.compile(r"Indian\s+Oil|\bIOCL\b|\bIOC\b", re.I)),
    ("RIL", re.compile(r"Reliance\s+Industries|\bRIL\b", re.I)),
    ("GAIL", re.compile(r"\bGAIL\b", re.I)),
]


def fail(msg: str) -> None:
    print(f"\nSTOPPED: {msg}")
    sys.exit(1)


def first_page_text(path: Path) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(str(path)) as pdf:
            return (pdf.pages[0].extract_text() or "") if pdf.pages else ""
    except Exception:
        return ""


def classify(folder: Path) -> dict[str, Path]:
    """Which file is which of the eight price circulars. Freight circulars are ignored here."""
    found: dict[str, Path] = {}
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() != ".pdf" or "freight" in f.name.lower():
            continue
        text = first_page_text(f)
        producer = next((code for code, rx in PATTERNS if rx.search(f.stem)), None)
        if not producer:
            scores = sorted(((len(rx.findall(text)), code) for code, rx in PATTERNS), reverse=True)
            producer = scores[0][1] if scores and scores[0][0] else None
        if producer == "GAIL":
            key = "gail_stock_point" if re.search(r"stock\s*point", f"{f.stem} {text[:2000]}", re.I) else "gail_ex_works"
        elif producer == "OPaL":
            key = "opal_csa" if re.search(r"\bCSA\b", f.stem, re.I) else "opal_dta"
        elif producer == "HPL":
            key = "haldia"
        else:
            key = (producer or "").lower() or None
        if not key:
            print(f"  ? {f.name}: producer not recognised, ignored")
            continue
        if key in found:
            fail(f"two files look like {key}: {found[key].name} and {f.name}. Keep one in the folder.")
        found[key] = f
        print(f"  {key:17} {f.name}")
    missing = [k for k in PRICE_KEYS if k not in found]
    if missing:
        fail(f"no file found for: {', '.join(missing)}. A round is built from all eight price circulars.")
    return found


def build(found: dict[str, Path], args) -> Path:
    base = json.loads(Path(args.base_manifest).read_text(encoding="utf-8"))
    manifest = {**base, **{k: str(v).replace("\\", "/") for k, v in found.items()}, "crossref": args.crossref}
    out = Path(args.out or (Path(args.folder) / f"import-{args.round}"))
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    env = {**os.environ, "GCPE_PRICE_ROUND": args.round, "GCPE_SOURCES": str(out / "manifest.json"), "GCPE_OUT": str(out / "round")}
    if args.previous:
        env["GCPE_PREVIOUS"] = args.previous
    if args.allow_shrink:
        env["GCPE_ALLOW_SHRINK"] = "1"
    if args.allow_drift:
        env["GCPE_ALLOW_DRIFT"] = "1"
    print(f"\nbuilding round {args.round} (ETL, all gates) ...")
    log = out / "build.log"
    with log.open("w", encoding="utf-8") as fh:
        rc = subprocess.run([sys.executable, str(HERE / "build.py")], env=env, cwd=str(HERE), stdout=fh, stderr=subprocess.STDOUT).returncode
    tail = log.read_text(encoding="utf-8", errors="replace").strip().splitlines()[-25:]
    if rc != 0:
        print("\n".join(tail))
        fail(f"the ETL stopped (see {log}). Resolve it, or acknowledge it with --allow-shrink / --allow-drift if a person has decided to.")
    print("\n".join(tail[-6:]))
    return out


def write_extracts(out: Path, round_: str) -> dict[str, Path]:
    pi = json.loads((out / "round" / "price_index.json").read_text(encoding="utf-8"))
    if pi.get("effective_date") != round_:
        fail(f"the built round is {pi.get('effective_date')}, not {round_}")
    paths = {}
    for producer, node in pi["producers"].items():
        depot = (pi.get("depot") or {}).get(producer, {}).get("zones")
        extract = {"producer": producer, "basis": node["basis"], "effective_date": round_, "zones": node["zones"]}
        if depot:
            extract["depot"] = {"zones": depot}
        p = out / f"{producer}-{round_}-extract.json"
        p.write_text(json.dumps(extract, ensure_ascii=False), encoding="utf-8")
        rows = sum(len(g) for g in node["zones"].values())
        drows = sum(len(g) for g in (depot or {}).values())
        print(f"  {producer:5} {rows:>6,} prices, {drows:>6,} Ex Depot prices -> {p.name}")
        paths[producer] = p
    return paths


class Api:
    def __init__(self, base: str):
        self.base, self.token = base.rstrip("/"), ""

    def _send(self, method: str, path: str, body: bytes | None = None, ctype: str | None = None, timeout: int = 300):
        req = urllib.request.Request(f"{self.base}{path}", data=body, method=method)
        if ctype:
            req.add_header("Content-Type", ctype)
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:400]
            raise RuntimeError(f"{method} {path}: HTTP {e.code} {detail}") from None

    def login(self, email: str, password: str):
        r = self._send("POST", "/auth/login", json.dumps({"email": email, "password": password}).encode(), "application/json", 120)
        self.token = r.get("accessToken") or fail("sign-in failed")

    def multipart(self, path: str, fields: dict[str, str], field: str, file: Path, ctype: str):
        b = uuid.uuid4().hex
        parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{field}"; filename="{file.name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode()
                     + file.read_bytes() + f"\r\n--{b}--\r\n".encode())
        return self._send("POST", path, b"".join(parts), f"multipart/form-data; boundary={b}")


def attach(found: dict[str, Path], extracts: dict[str, Path], args) -> None:
    api = Api(args.api)
    email = os.environ.get("GCPE_EMAIL") or input("App sign-in email: ")
    password = os.environ.get("GCPE_PASSWORD") or getpass.getpass("Password: ")
    api.login(email, password)
    print(f"\nsigned in to {args.api}")
    on_file = api._send("GET", "/circulars?kind=price")["price"]

    def filed(key: str):
        f = found[key]
        return next((c for c in on_file if c["producer"] == PRODUCER_OF[key] and str(c["effectiveDate"])[:10] == args.round
                     and (c.get("sourceFilename") == f.name)), None)

    for key, f in found.items():
        if filed(key):
            print(f"  on file   {key:17} {f.name}")
            continue
        r = api.multipart("/circulars/bulk-upload", {}, "files", f, "application/pdf")
        item = r["results"][0]
        if item["status"] != "filed" or item.get("producer") != PRODUCER_OF[key] or item.get("effectiveDate") != args.round:
            fail(f"{f.name} was not filed as {PRODUCER_OF[key]} {args.round}: {item}")
        print(f"  filed     {key:17} {f.name}")
    on_file = api._send("GET", "/circulars?kind=price")["price"]
    for producer, key in MAIN_KEY.items():
        rec = filed(key)
        if not rec:
            fail(f"{producer}'s main circular for {args.round} is not on file")
        if rec.get("draft"):
            print(f"  drafted   {producer:5} already has a draft; left alone")
            continue
        r = api.multipart(f"/circulars/{rec['_id']}/extract", {}, "file", extracts[producer], "application/json")
        print(f"  drafted   {producer:5} {r['rowCount']:>6,} prices, {r.get('depotRowCount', 0):>6,} Ex Depot, {r['changedRowCount']:>6,} changed, "
              f"{r['removedCount']:>5,} unmentioned")
    print("\nDone. Open the app: Circulars -> Publish all -> check the summary -> Publish.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folder", required=True)
    ap.add_argument("--round", required=True, help="effective date, YYYY-MM-DD")
    ap.add_argument("--api", default=API_DEFAULT)
    ap.add_argument("--out")
    ap.add_argument("--base-manifest", default=BASE_MANIFEST_DEFAULT, help="last round's manifest: freight, MZO and other fixed inputs")
    ap.add_argument("--crossref", default=CROSSREF_DEFAULT)
    ap.add_argument("--previous", help="last round's price_index.json, for the drift gate")
    ap.add_argument("--allow-shrink", action="store_true")
    ap.add_argument("--allow-drift", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.round):
        fail("--round must be YYYY-MM-DD")
    print(f"round {args.round}: price circulars in {args.folder}")
    found = classify(Path(args.folder))
    out = build(found, args)
    print("\nextracts:")
    extracts = write_extracts(out, args.round)
    if args.dry_run:
        print(f"\ndry run: nothing sent. Files in {out}")
        return
    attach(found, extracts, args)


if __name__ == "__main__":
    main()
