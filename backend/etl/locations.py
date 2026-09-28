"""Resolving one customer location across six producers' naming schemes.

Nobody names places the same way:

    GAIL     BHIWANDI        PUNE       GAZIABAD/NOIDA   AURANGABAD
    IOCL     Mumbai          Pune       Gautam Budh nagar  Aurangabad
    RIL      MUMBAI          PUNE       NOIDA            AURANGBDMH
    HMEL     Bhiwandi        Pune       Ghaziabad        Aurangabad
    Haldia   Maharashtra_Mumbai  Maharashtra_Pune  Uttar Pradesh_Noida
    OPaL     Bhiwandi        Pune       Ghaziabad        Aurangabad (MH)

GAIL's own 313 ex-works locations are the canonical list, because that is what a
GAIL sales officer types. Everything else resolves onto it.

The one rule that matters: **an unresolved location is reported, never guessed.**
Silently pricing Bhiwandi against a competitor's Nagpur would produce a a
confident number that is wrong, and a wrong gap sends a price correction up the
chain. `resolve` returns None and the caller shows "no published price".
"""

from __future__ import annotations

import re
import unicodedata

# Producer place names that do not normalise onto GAIL's, verified against the
# MZO workbook's own zone choices where it covers them.
ALIASES: dict[str, dict[str, str]] = {
    "RIL": {
        "AURANGABAD": "AURANGBDMH",
        "GAZIABAD/NOIDA": "NOIDA",
        "BHIWANDI": "MUMBAI",
        "DAMAN": "SILVASSA",
        "CALCUTTA": "KOLKATA",
        "BENGALURU": "BENGALURU",
        "BANGALORE": "BENGALURU",
    },
    "IOCL": {
        # IOCL prices by zone and its zone-to-district annexure is missing from
        # the circular, so these come from the MZO workbook's own pairings.
        "BHIWANDI": "MUMBAI",
        "GAZIABAD/NOIDA": "GAUTAM BUDH NAGAR",
        "SILVASSA": "DADRA(SILVASSA)",
        "VAPI": "VAPI",
        "HYDERABAD": "RANGAREDDY",
        "KOLKATA": "HOWRAH",
        "RANCHI": "JHARKHAND",
        "PATNA": "BIHAR",
        "RAIPUR": "CHATTISGARH",
        "COCHIN": "KERALA",
    },
    "HMEL": {
        "GAZIABAD/NOIDA": "GHAZIABAD",
        "BHATINDA": "BHATINDA",
    },
    "OPaL": {
        "AURANGABAD": "AURANGABAD (MH)",
        "GAZIABAD/NOIDA": "GHAZIABAD",
        "GOA": "PANJI",
        "KOLKATA": "KOLKATA",
        "MEHSANA": "KALOL (MEHSANA)",
    },
    # HPL lists districts, and Bhiwandi (in Thane) is not one of them. The zonal
    # workbook's Haldia figures for Bhiwandi — ex works 140,210, ex depot 143,596 —
    # are exactly Rs 1,000 above the September Maharashtra_Mumbai prices (139,210,
    # 142,596), the same Rs 1,000 HPL took off every price in this round. The
    # price-matching that used to derive this alias (see derive_aliases) cannot
    # while a whole round has moved.
    "HPL": {"BHIWANDI": "Maharashtra_Mumbai"},
}


# Spelling variants of the same town. GAIL alone spells Silvassa two ways across
# its own two files, so these are needed before any competitor is considered.
SPELLINGS = {
    "SILVAASA": "SILVASSA",
    "BHINWANDI": "BHIWANDI",
    "NASIK": "NASHIK",
    "MANGLORE": "MANGALORE",
    "CALCUTTA": "KOLKATA",
    "GAZIABAD": "GHAZIABAD",
    "BENGALURU": "BANGALORE",
    "BHATINDA": "BATHINDA",
    "PANJI": "PANAJI",
    "VIZAG": "VISAKHAPATNAM",
    "VISAK": "VISAKHAPATNAM",
    "BARODA": "VADODARA",
    "TRIVANDRUM": "THIRUVANANTHAPURAM",
    "PONDICHERRY": "PUDUCHERRY",
    # HPL spells Bargarh (Odisha) "Barhgarh" — in its territory list always, in its price list
    # since 16 Sep 2026; the freight books say BARGARH (verified same place, client-approved 2026-09-26).
    "BARHGARH": "BARGARH",
}


# A published district-to-price-point map (currently HPL's alone) is read purely by district
# *name*, with no state attached (see `Resolver.add_district_map`). A name that happens to be a
# real place in two different states — Bilaspur is a Chhattisgarh town and, separately, a Himachal
# Pradesh district — then resolves to whichever one the producer's document lists, regardless of
# which one GAIL actually meant (R20). These two tables let `resolve_detailed` catch that: the
# state a price *point*'s own name implies, and the state each canonical GAIL location is actually
# in (`reference/gail_location_state.json`, committed and reviewed — see
# `reference/gail_location_state_reasons.json` for the handful that needed a judgment call).
_POINT_STATE_PREFIX = {
    "West Bengal": "West Bengal", "Orissa": "Odisha", "Madhya Pradesh": "Madhya Pradesh",
    "Tamil Nadu": "Tamil Nadu", "Telangana": "Telangana", "Andhra Pradesh": "Andhra Pradesh",
    "Karnataka": "Karnataka", "Haryana": "Haryana", "Uttar Pradesh": "Uttar Pradesh",
    "Uttarakhand": "Uttarakhand", "Punjab": "Punjab", "Himachal Pradesh": "Himachal Pradesh",
    "J&K": "Jammu and Kashmir", "Rajasthan": "Rajasthan", "Maharashtra": "Maharashtra",
    "Gujarat": "Gujarat", "Jharkhand": "Jharkhand",
}
_POINT_STATE_FIXED = {
    "Bihar": "Bihar", "Chattisgarh": "Chhattisgarh", "Assam": "Assam", "Kerala": "Kerala",
    "Goa": "Goa", "Delhi": "Delhi", "Chandigarh": "Chandigarh", "Pondicherry": "Puducherry",
    "Dadra": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman": "Dadra and Nagar Haveli and Daman and Diu",
}


def point_state(point: str) -> str | None:
    """The state a producer's own price-point name implies, or None if it cannot be told.

    A point named `State_City` (HPL's convention) or a bare state name says so directly; anything
    else (a plain city name, a multi-state grouping like "Meghalaya & NE States") returns None —
    a guard must never *reject* a match on a guess, only on a state it can actually name.
    """
    if point in _POINT_STATE_FIXED:
        return _POINT_STATE_FIXED[point]
    if "_" in point:
        return _POINT_STATE_PREFIX.get(point.split("_", 1)[0])
    return None


def normalise(name: str) -> str:
    """Fold a place name to a comparable key.

    Case, punctuation, compound names, the state prefix Haldia bolts on, and
    outright spelling differences all vary between circulars — and within GAIL's
    own files — while naming the same town.
    """
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = text.split("_")[-1]  # Haldia's "Maharashtra_Pune"
    text = text.split("/")[0]  # GAIL's "SILVASSA / DADRA & NAGAR HAVELI"
    text = re.sub(r"\(.*?\)", " ", text)  # RIL's "Alwar (Bhiwadi)"
    text = re.sub(r"[^A-Za-z0-9 ]", " ", text)
    key = re.sub(r"\s+", " ", text).strip().upper()
    return SPELLINGS.get(key, key)


class Resolver:
    """Maps a canonical GAIL location onto one producer's own place names."""

    def __init__(self, producer: str, names: list[str],
                 aliases: dict[str, str] | None = None,
                 gail_state: dict[str, str] | None = None,
                 evidence_over_exact: bool = False):
        self.producer = producer
        self.names = names
        # Price zones: evidence is re-matched against every round's new prices, so a
        # coincidence can pass (R25) — it must not displace the producer's own zone of
        # the same name. Freight books do not change each round, and freight evidence
        # records how the zonal team actually bills a town (HPL Pune at the LONAVALE
        # rate, four agreeing rows), so freight resolvers keep evidence first.
        self._evidence_over_exact = evidence_over_exact
        self._by_key: dict[str, str] = {}
        for name in names:
            self._by_key.setdefault(normalise(name), name)
        chosen = ALIASES.get(producer, {}) if aliases is None else aliases
        self._aliases = {normalise(k): v for k, v in chosen.items()}
        self._district_map: dict[str, str] = {}
        self._inferred: dict[str, str] = {}
        self._evidence: dict[str, str] = {}
        # State guard for `add_district_map` (R20): {canonical GAIL location: its state}.
        self._gail_state = gail_state or {}

    def add_district_map(self, mapping: dict[str, list[str]]) -> None:
        """Take a producer's published district-to-price-point map (HPL's).

        A published map beats name matching: it is the producer's own statement
        of which town buys at which price.
        """
        for point, districts in mapping.items():
            for district in districts:
                self._district_map.setdefault(normalise(district), point)

    def add_cluster_hubs(self, mapping: dict[str, list[str]]) -> None:
        """Use HPL's district map to place towns this producer does not name.

        Competitors publish 69-90 pricing zones; GAIL sells to 313 locations. The
        rest of GAIL's towns sit *inside* a competitor zone, but only HPL says
        which towns those are. So: if HPL puts Agra in its "Uttar Pradesh_Mathura"
        territory and this producer happens to publish a "Mathura" zone, price
        Agra there.

        That is an inference chaining two published facts, not a published fact,
        so it is tagged `inferred_via_hpl` and kept separate from exact matches.
        A user sees which tier their number came from.
        """
        for point, districts in mapping.items():
            hub = normalise(point)
            if hub not in self._by_key:
                continue
            for district in districts:
                self._inferred.setdefault(normalise(district), self._by_key[hub])

    def add_evidence(self, mapping: dict[str, str]) -> None:
        """Take aliases proven from the MZO workbook (see `derive_aliases`)."""
        for location, zone in mapping.items():
            self._evidence[normalise(location)] = zone

    def resolve_detailed(self, gail_location: str) -> tuple[str | None, str]:
        """(producer's name for this place, how we got there)."""
        key = normalise(gail_location)
        # Evidence outranks hand-written aliases: it is a price this producer
        # actually published, matched to the zone that published it. For price
        # zones it never outranks the producer's own zone of the same name, though:
        # evidence is one workbook price equal to one zone's price, and a coincidence
        # passes that test (R25: HPL's Daman depot zone lost to Karnataka_Bellary
        # when the workbook's Daman price equalled Bellary's).
        if key in self._evidence and (self._evidence_over_exact or key not in self._by_key):
            return self._evidence[key], "evidence"
        if key in self._aliases:
            target = self._aliases[key]
            resolved = self._by_key.get(normalise(target))
            if resolved:
                return resolved, "alias"
        if key in self._by_key:
            return self._by_key[key], "exact"
        if key in self._district_map:
            point = self._district_map[key]
            town_state = self._gail_state.get(gail_location)
            pt_state = point_state(point)
            # Reject only a *confirmed* disagreement (both sides known); an unclassifiable point
            # name (a multi-state grouping, say) is never treated as a mismatch.
            if not (town_state and pt_state and town_state != pt_state):
                return point, "published_map"
        if key in self._inferred:
            return self._inferred[key], "inferred_via_hpl"
        return None, "unresolved"

    def resolve(self, gail_location: str) -> str | None:
        return self.resolve_detailed(gail_location)[0]

    def coverage(self, gail_locations: list[str]) -> dict:
        resolved = {loc: self.resolve_detailed(loc) for loc in gail_locations}
        tiers: dict[str, int] = {}
        for _, tier in resolved.values():
            tiers[tier] = tiers.get(tier, 0) + 1
        return {
            "producer": self.producer,
            "zones_published": len(self.names),
            "resolved": sum(1 for t, _ in resolved.values() if t),
            "total": len(gail_locations),
            "tiers": tiers,
            "missing": sorted(loc for loc, (t, _) in resolved.items() if not t),
            "map": {loc: t for loc, (t, _) in resolved.items() if t},
            "tier_of": {loc: k for loc, (t, k) in resolved.items() if t},
        }


def derive_aliases(
    price_index: dict[str, dict], mzo_rows: list[dict], section: str = "ex_works"
) -> dict[str, dict[str, str]]:
    """Prove location aliases from the zonal workbook instead of guessing them.

    The MZO workbook quotes a competitor's basic price for a named town. If that
    exact price appears at exactly one zone in that producer's own circular,
    then that is the zone the producer prices the town at — stated by GAIL's own
    zonal team and confirmed against the producer's document.

    This is the only thing that reaches cases string matching cannot: HPL lists
    *districts*, so Bhiwandi (a town in Thane) never matches by name, but its
    price does.

    Ambiguous towns — where the price appears at several zones — are skipped
    rather than resolved by majority vote; a coin-flip alias is worse than none.
    """
    producer_key = {
        "GAIL": "GAIL",
        "IOCL": "IOCL",
        "RIL": "RIL",
        "HMEL": "HMEL",
        "OPAL": "OPaL",
        "HALDIA": "HPL",
    }
    votes: dict[tuple[str, str], dict[str, int]] = {}

    for row in mzo_rows:
        if row.get("section") != section:
            continue
        basic = row.get("basic")
        if not isinstance(basic, (int, float)):
            continue
        producer = producer_key.get(row["producer"])
        zones = price_index.get(producer, {}).get("zones", {})
        matches = [
            zone
            for zone, cells in zones.items()
            if cells.get(row["grade"]) == basic
        ]
        if len(matches) != 1:
            continue
        tally = votes.setdefault((producer, row["location"].strip()), {})
        tally[matches[0]] = tally.get(matches[0], 0) + 1

    out: dict[str, dict[str, str]] = {}
    for (producer, location), tally in votes.items():
        if len(tally) != 1:
            continue  # the evidence disagrees with itself; leave it unresolved
        out.setdefault(producer, {})[location] = next(iter(tally))
    return out


def derive_freight_aliases(
    freight_books: dict[str, list[dict]], mzo_rows: list[dict]
) -> dict[str, dict[str, str]]:
    """Prove freight-destination aliases the same way as price zones.

    The zonal workbook records the freight it used for a named town. If exactly
    one destination in that producer's freight circular carries that rate, that
    is the destination they bill the town at. This is what connects GAIL's "GOA"
    to HMEL's and HPL's "Panaji" without asserting that a state equals a city.
    """
    producer_key = {
        "GAIL": "GAIL",
        "HMEL": "HMEL",
        "OPAL": "OPaL",
        "HALDIA": "HPL",
    }
    votes: dict[tuple[str, str], dict[str, int]] = {}

    for row in mzo_rows:
        if row.get("section") != "ex_works":
            continue
        rate = row.get("freight")
        producer = producer_key.get(row["producer"])
        if producer is None or not isinstance(rate, (int, float)) or rate <= 0:
            continue
        matches = {
            entry["destination"]
            for entry in freight_books.get(producer, [])
            # The workbook rounds, and OPaL's rate carries paise.
            if abs(entry["rate_per_mt"] - rate) < 1
            or abs(entry["rate_per_mt"] + entry.get("insurance_per_mt", 0) - rate) < 1
        }
        if len(matches) != 1:
            continue
        tally = votes.setdefault((producer, row["location"].strip()), {})
        destination = next(iter(matches))
        tally[destination] = tally.get(destination, 0) + 1

    out: dict[str, dict[str, str]] = {}
    for (producer, location), tally in votes.items():
        if len(tally) != 1:
            continue
        out.setdefault(producer, {})[location] = next(iter(tally))
    return out
