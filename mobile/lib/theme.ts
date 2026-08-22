/**
 * One place for colour and spacing, so the six screens read as one product.
 *
 * The status palette is the app's core vocabulary: it says whether GAIL is
 * ahead, level or behind at a glance. Green/amber/red carry meaning here, so
 * they are never used decoratively.
 */
export const theme = {
  color: {
    bg: "#FFFFC5",
    surface: "#FFFFDD",
    surfaceAlt: "#FFFAA0",
    border: "#E8E2A0",
    text: "#1F2933",
    textMuted: "#52606D",
    textFaint: "#7B8794",
    accent: "#CD5C5C",
    gail: "#1E40AF",

    leading: "#0F9D58",
    matched: "#B45309",
    behind: "#DC2626",
    unknown: "#7B8794",
  },
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 12, lg: 16 },
} as const;

/** Rupees, Indian grouping, no decimals — prices here are always whole rupees. */
export function rupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `\u20B9${Math.round(value).toLocaleString("en-IN")}`;
}

/** How far behind GAIL is, in the bands the field already uses. */
export function gapColor(gap: number | null): string {
  if (gap === null) return theme.color.unknown;
  if (gap <= 0) return theme.color.leading;
  if (gap <= 500) return theme.color.matched;
  return theme.color.behind;
}

/**
 * Location tiers, in words a sales officer can act on. An inferred zone is the
 * one case where the number needs checking before it is quoted.
 */
export const TIER_LABEL: Record<string, string> = {
  exact: "Published for this location",
  alias: "Known naming difference",
  evidence: "Matched from zonal workbook pricing",
  published_map: "From the producer's own district map",
  inferred_via_hpl: "Zone inferred — confirm before quoting",
  unresolved: "No published price point",
};
