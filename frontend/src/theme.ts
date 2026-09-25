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
 * The three location-match groups (decision 0010). The API sends the label on
 * every quote, including the fourth, Retained Existing Mapping; these are only
 * the fallback for a quote from an API that predates the field.
 */
export const MATCH_LABEL = {
  exact: "Exact Published Match",
  territory: "Territory Match",
  inferred: "Inferred Location Match",
} as const;
