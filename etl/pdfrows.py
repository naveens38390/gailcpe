"""Row-safe PDF table reading.

`pdftotext -layout` silently shifts right-hand column groups by one row in the
GAIL / RIL / IOCL / Haldia / OPaL circulars, because rows in those tables have
uneven baseline spacing. A shifted price looks exactly like a correct one, so
every extractor here works from word coordinates instead.
"""

from __future__ import annotations

import collections
import re
from dataclasses import dataclass
from typing import Iterator

import pdfplumber

# Words whose baselines fall within this many points are one row. Row pitch in
# these circulars is 6pt at the tightest, so 3 separates rows without splitting
# a row whose glyphs sit a fraction of a point apart.
ROW_TOLERANCE = 3.0

# A value is claimed by the nearest column header within this x-distance. Column
# pitch is ~45pt at the tightest; 40 keeps a stray number from being adopted by
# a column it does not belong to.
COLUMN_RADIUS = 40.0


@dataclass
class Word:
    text: str
    x0: float
    x1: float
    top: float

    @property
    def xmid(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Row:
    page: int
    top: float
    words: list[Word]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    def numbers(self) -> list[tuple[float, float]]:
        """(value, x-midpoint) for every numeric token in the row."""
        return [
            (parse_number(w.text), w.xmid)
            for w in self.words
            if is_number(w.text)
        ]

    def numeric_boundary(self) -> float | None:
        """Left edge of the first numeric word — where the label ends.

        Callers that need this must not recompute it from value midpoints: a
        word's midpoint is right of its own left edge, so a midpoint boundary
        folds the first value into the label.
        """
        numeric = [w for w in self.words if is_number(w.text)]
        return min(w.x0 for w in numeric) if numeric else None

    def label_and_values(self) -> tuple[str, list[tuple[float, float]]]:
        """Split the row into its leading text label and its numeric cells.

        The boundary is the *left edge* of the first numeric word. Using a
        midpoint here would fold that first number into the label, since a
        word's x0 is always less than its own midpoint.
        """
        numeric = [w for w in self.words if is_number(w.text)]
        if not numeric:
            return self.text.strip(), []
        boundary = min(w.x0 for w in numeric)
        label = " ".join(w.text for w in self.words if w.x0 < boundary).strip()
        values = [(parse_number(w.text), w.xmid) for w in numeric]
        return label, values


_CACHE: dict[str, list[Row]] = {}


def rows(path: str, pages: range | list[int] | None = None) -> Iterator[Row]:
    """Yield rows of words, top to bottom, left to right within a row.

    Parsed pages are cached per file: extractors routinely walk a document twice
    (once to measure column positions, once to read them), and pdfplumber's word
    extraction is the slowest step in the pipeline by a wide margin.
    """
    if path not in _CACHE:
        _CACHE[path] = list(_parse(path))
    for row in _CACHE[path]:
        if pages is None or row.page in pages:
            yield row


def _parse(path: str) -> Iterator[Row]:
    with pdfplumber.open(path) as pdf:
        for index, page in enumerate(pdf.pages, 1):
            buckets: dict[int, list[Word]] = collections.defaultdict(list)
            for w in page.extract_words():
                word = Word(w["text"], w["x0"], w["x1"], w["top"])
                buckets[round(word.top / ROW_TOLERANCE)].append(word)
            for key in sorted(buckets):
                words = sorted(buckets[key], key=lambda w: w.x0)
                yield Row(index, key * ROW_TOLERANCE, words)


_NUMBER = re.compile(r"^-?[\d,]*\d(?:\.\d+)?$")


def is_number(token: str) -> bool:
    token = token.strip()
    return bool(token) and bool(_NUMBER.match(token)) and any(c.isdigit() for c in token)


def parse_number(token: str) -> float:
    return float(token.replace(",", ""))


@dataclass
class Value:
    number: float
    x_start: float  # left edge of the first fragment, for label/value boundary
    xmid: float  # midpoint of the last fragment, for column assignment


def merge_indian_digits(words: list[Word]) -> list[Value]:
    """Rebuild values that pdfplumber split mid-number.

    GAIL's sheets render lakh-grouped prices with a space after the leading
    digit ("1 ,39,640"), so the leading 1 arrives as its own word. Accumulate
    fragments until two group separators have been seen, which is exactly one
    complete Indian-format price. `x_start` tracks the first fragment so callers
    can tell a row's label apart from its values.
    """
    values: list[Value] = []
    buffer = ""
    start: float | None = None
    for w in words:
        token = w.text
        if re.fullmatch(r"\d", token) or re.fullmatch(r",?[\d,]+", token):
            if not buffer:
                start = w.x0
            buffer += token
            if buffer.count(",") >= 2:
                try:
                    values.append(Value(float(buffer.replace(",", "")), start, w.xmid))
                except ValueError:
                    pass
                buffer = ""
                start = None
        else:
            buffer = ""
            start = None
    return values


def join_numeric_fragments(words: list[Word], max_gap: float = 2.0) -> list[Word]:
    """Glue a number that the PDF split across touching words.

    HPL renders "3,756.00" as "3" and ",756.00" set flush against each other.
    Left alone, the fragments read as two columns — which both corrupts the rate
    and displaces every real column when column edges are measured by frequency.
    Only touching fragments are joined, so genuinely separate columns survive.
    """
    out: list[Word] = []
    for w in words:
        if (
            out
            and w.x0 - out[-1].x1 <= max_gap
            and re.fullmatch(r"[\d,.]+", w.text)
            and re.fullmatch(r"[\d,.]+", out[-1].text)
        ):
            previous = out.pop()
            out.append(Word(previous.text + w.text, previous.x0, w.x1, previous.top))
        else:
            out.append(w)
    return out


def pair_orphans(
    rows_in: list[Row], max_gap: float = 2 * ROW_TOLERANCE
) -> Iterator[tuple[str, list[tuple[float, float]], Row]]:
    """Yield (label, values, row) with two-line table cells stitched together.

    A row label too long for its cell is set on its own baseline, a few points
    above or below its values. Which side it lands on is not consistent — IOCL
    puts the name first, Haldia puts it after — so pair in either direction, but
    only across a gap small enough to be the same table row.
    """
    parsed = [(r,) + r.label_and_values() for r in rows_in]
    used: set[int] = set()
    for i, (row, label, values) in enumerate(parsed):
        if i in used:
            continue
        if values and label:
            yield label, values, row
            continue
        if values and not label:
            for j in (i - 1, i + 1):
                if 0 <= j < len(parsed) and j not in used:
                    other, other_label, other_values = parsed[j]
                    if (
                        other_label
                        and not other_values
                        and abs(other.top - row.top) <= max_gap
                    ):
                        used.add(j)
                        yield other_label, values, row
                        break


def split_header_token(word: Word, code: re.Pattern) -> list[tuple[str, float]]:
    """Split a header cell that fused several column codes into one word.

    IOCL and HMEL headers sometimes render adjacent grade codes with no space
    ("080M60080M60U020M52080M55"), so the token spans four columns. The codes
    are fixed-shape, so re-tokenise the text and spread x across the word's own
    width in proportion to each code's character count — which is where those
    columns actually sit, since the header is set in a monospaced-width run.
    """
    codes = code.findall(word.text)
    if len(codes) <= 1:
        return [(word.text, word.xmid)]
    total = sum(len(c) for c in codes)
    span = word.x1 - word.x0
    out: list[tuple[str, float]] = []
    consumed = 0
    for c in codes:
        centre = word.x0 + span * (consumed + len(c) / 2) / total
        out.append((c, centre))
        consumed += len(c)
    return out


def assign_to_columns(
    values: list[Value] | list[tuple[float, float]],
    columns: list[tuple[str, float]],
    radius: float = COLUMN_RADIUS,
) -> dict[str, float]:
    """Attach each value to the column header nearest it horizontally."""
    out: dict[str, float] = {}
    if not columns:
        return out
    for value in values:
        number, x = (
            (value.number, value.xmid) if isinstance(value, Value) else value
        )
        name, cx = min(columns, key=lambda c: abs(c[1] - x))
        if abs(cx - x) < radius:
            out[name] = number
    return out
