import { buildLocationMatch, inferredCaveat, TIER_LABEL, tierGroup } from "./location-match";
import type { LocationTier } from "./types";

describe("tierGroup", () => {
  it("groups exact, alias and evidence as exact", () => {
    expect(tierGroup("exact")).toBe("exact");
    expect(tierGroup("alias")).toBe("exact");
    expect(tierGroup("evidence")).toBe("exact");
  });

  it("groups published_map and state_zone as territory", () => {
    expect(tierGroup("published_map")).toBe("territory");
    expect(tierGroup("state_zone")).toBe("territory");
  });

  it("groups inferred_location and the legacy inferred_via_hpl alias as inferred", () => {
    expect(tierGroup("inferred_location")).toBe("inferred");
    expect(tierGroup("inferred_via_hpl")).toBe("inferred");
  });

  it("groups unresolved as none", () => {
    expect(tierGroup("unresolved")).toBe("none");
  });

  it("groups an unrecognised tier as none rather than guessing a match", () => {
    expect(tierGroup("something_new_next_round" as LocationTier)).toBe("none");
  });
});

describe("TIER_LABEL", () => {
  it("has the three customer-facing labels the design specifies", () => {
    expect(TIER_LABEL.exact).toBe("Exact Published Match");
    expect(TIER_LABEL.territory).toBe("Territory Match");
    expect(TIER_LABEL.inferred).toBe("Inferred Location Match");
    expect(TIER_LABEL.none).toBe("");
  });
});

describe("buildLocationMatch", () => {
  it("is undefined when there is no zone at all", () => {
    expect(buildLocationMatch("unresolved", null)).toBeUndefined();
  });

  it("is undefined for an unresolved tier even if a zone were somehow present", () => {
    expect(buildLocationMatch("unresolved", "Mumbai")).toBeUndefined();
  });

  it("carries group and label with no meta for an exact match", () => {
    expect(buildLocationMatch("exact", "BHIWANDI")).toEqual({
      group: "exact",
      label: "Exact Published Match",
      matchedZone: "BHIWANDI",
    });
  });

  it("carries the fallback meta for an inferred match", () => {
    const match = buildLocationMatch("inferred_location", "Udaipur", {
      km: 95,
      crossesState: false,
      corroborated: true,
      source: "nearest",
    });
    expect(match).toEqual({
      group: "inferred",
      label: "Inferred Location Match",
      matchedZone: "Udaipur",
      distanceKm: 95,
      crossesState: false,
      corroborated: true,
      source: "nearest",
    });
  });

  it("omits distanceKm for a whole-state zone (km is null, no single point)", () => {
    const match = buildLocationMatch("state_zone", "Kerala", {
      km: null,
      crossesState: false,
      corroborated: false,
      source: "state_zone",
    });
    expect(match?.distanceKm).toBeUndefined();
    expect(match?.group).toBe("territory");
  });

  it("labels a retained row Retained Existing Mapping, keeping it in the inferred group", () => {
    const match = buildLocationMatch("inferred_location", "Pune", {
      km: 113,
      crossesState: false,
      corroborated: true,
      source: "retained",
      supplied: true,
    });
    expect(match?.label).toBe("Retained Existing Mapping");
    expect(match?.group).toBe("inferred");
    expect(match?.distanceKm).toBe(113);
  });

  it("carries a distance for a Territory Match the table only confirms (supplied: false)", () => {
    const match = buildLocationMatch("published_map", "Rajasthan_Kota", {
      km: 12,
      crossesState: false,
      corroborated: true,
      source: "annexure_v",
      supplied: false,
    });
    expect(match?.label).toBe("Territory Match");
    expect(match?.distanceKm).toBe(12);
  });

  it("still groups the legacy inferred_via_hpl tier as inferred for old stored records", () => {
    const match = buildLocationMatch("inferred_via_hpl", "Kolhapur");
    expect(match?.group).toBe("inferred");
    expect(match?.label).toBe("Inferred Location Match");
  });
});

describe("inferredCaveat", () => {
  it("names the producer, zone and distance", () => {
    const match = buildLocationMatch("inferred_location", "Mumbai", {
      km: 58,
      crossesState: false,
      corroborated: true,
      source: "nearest",
    })!;
    expect(inferredCaveat("IOCL", "Khopoli", match)).toBe(
      "IOCL is priced at Mumbai (58 km from Khopoli)",
    );
  });

  it("flags a state crossing", () => {
    const match = buildLocationMatch("inferred_location", "Hyderabad", {
      km: 115,
      crossesState: true,
      corroborated: false,
      source: "nearest",
    })!;
    expect(inferredCaveat("RIL", "Bidar", match)).toBe(
      "RIL is priced at Hyderabad (115 km from Bidar); crosses into another state",
    );
  });

  it("says so when the quote is a retained existing mapping", () => {
    const match = buildLocationMatch("inferred_location", "Pune", {
      km: 113,
      crossesState: false,
      corroborated: true,
      source: "retained",
    })!;
    expect(inferredCaveat("HMEL", "Ahmednagar", match)).toBe(
      "HMEL is priced at Pune (113 km from Ahmednagar), the existing mapping",
    );
  });

  it("omits the distance clause when there is none (a whole-state zone)", () => {
    const match = buildLocationMatch("state_zone", "Kerala", {
      km: null,
      crossesState: false,
      corroborated: false,
      source: "state_zone",
    })!;
    expect(inferredCaveat("IOCL", "Alappuzha", match)).toBe("IOCL is priced at Kerala");
  });
});
