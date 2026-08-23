/**
 * Spacing, shape, and the formatting rules the screens share.
 *
 * Colour lives in `constants/colors.ts` and is reached through `useTheme()` —
 * nothing here holds a hex value, so a screen cannot accidentally pin itself
 * to one theme.
 */

import type { ThemeColors } from "./constants/colors";

export const theme = {
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 12, lg: 16 },
} as const;

/** Rupees, Indian grouping, no decimals — prices here are always whole rupees. */
export function rupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/** How far behind GAIL is, in the bands the field already uses. */
export function gapColor(gap: number | null, c: ThemeColors): string {
  if (gap === null) return c.neutral;
  if (gap <= 0) return c.success;
  if (gap <= 500) return c.warning;
  return c.danger;
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
