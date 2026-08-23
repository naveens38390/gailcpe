/**
 * The one place a colour is chosen.
 *
 * Every screen reads from here through `useTheme()` — nothing hard-codes a hex
 * string. Keys are semantic (`textMuted`, `danger`) rather than literal
 * (`grey500`, `red`), so a token can be re-tuned for one theme without hunting
 * through the screens that use it.
 *
 * The status palette is the app's core vocabulary: it says whether GAIL is
 * ahead, level or behind at a glance. Success/warning/danger carry meaning
 * here, so they are never used decoratively.
 */

/** Colours that mean the same thing in both themes. */
export const brand = {
  /** GAIL Red — the primary action colour. */
  primary: "#D92B38",
  /** Gas Flame Blue — supporting brand colour for headers and accents. */
  secondary: "#1B4965",
} as const;

/**
 * Producer series colours, for charts and any place a producer needs to be
 * identifiable by colour alone. GAIL keeps the brand red so it reads as "us"
 * against the competition.
 */
export const chartSeries = {
  GAIL: "#D92B38",
  IOCL: "#0284C7",
  BPCL: "#EAB308",
  HPCL: "#2563EB",
  // The remaining producers in this dataset, kept visually distinct from the four above.
  RIL: "#7C3AED",
  HMEL: "#0D9488",
  OPaL: "#EA580C",
  HPL: "#A16207",
} as const;

/** Fallback order for a producer with no assigned series colour. */
const SERIES_FALLBACK = ["#0284C7", "#EAB308", "#2563EB", "#7C3AED", "#0D9488", "#EA580C"];

/** The colour that identifies one producer across charts and lists. */
export function seriesColor(producer: string): string {
  const known = (chartSeries as Record<string, string>)[producer];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < producer.length; i++) hash = (hash * 31 + producer.charCodeAt(i)) | 0;
  return SERIES_FALLBACK[Math.abs(hash) % SERIES_FALLBACK.length]!;
}

export interface ThemeColors {
  // ---- brand -------------------------------------------------------------
  /** GAIL Red. Primary buttons, active tabs, links. */
  primary: string;
  /** Text and icons placed on top of `primary`. */
  onPrimary: string;
  /** Gas Flame Blue. */
  secondary: string;

  // ---- status ------------------------------------------------------------
  /** GAIL is ahead / a change was approved. */
  success: string;
  /** Level, or awaiting a decision. */
  warning: string;
  /** GAIL is behind / rejected. */
  danger: string;
  /** No data — never "bad", just unknown. */
  neutral: string;
  /** Background of an error note. */
  dangerSurface: string;
  /** Text placed on `dangerSurface`. */
  onDangerSurface: string;

  // ---- surfaces ----------------------------------------------------------
  bgApp: string;
  surfaceCard: string;
  /** Table stripes, chips, and anything that sits on a card. */
  surfaceAlt: string;
  border: string;

  // ---- text --------------------------------------------------------------
  textPrimary: string;
  textMuted: string;
  /** Placeholders, captions, and disabled labels. */
  textFaint: string;

  /** Dimming layer behind a modal or bottom sheet. */
  scrim: string;

  /** Producer series colours, re-exported per theme for convenience. */
  series: Record<string, string>;
}

export const light: ThemeColors = {
  primary: brand.primary,
  onPrimary: "#FFFFFF",
  secondary: brand.secondary,

  success: "#16A34A",
  warning: "#CA8A04",
  danger: "#DC2626",
  neutral: "#94A3B8",
  dangerSurface: "#FEE2E2",
  onDangerSurface: "#991B1B",

  bgApp: "#F8FAFC",
  surfaceCard: "#FFFFFF",
  surfaceAlt: "#F1F5F9",
  border: "#E2E8F0",

  textPrimary: "#0F172A",
  textMuted: "#64748B",
  textFaint: "#94A3B8",

  scrim: "rgba(15, 23, 42, 0.45)",

  series: chartSeries,
};

export const dark: ThemeColors = {
  primary: brand.primary,
  onPrimary: "#FFFFFF",
  secondary: "#2E6F96",

  success: "#22C55E",
  warning: "#EAB308",
  danger: "#EF4444",
  neutral: "#64748B",
  dangerSurface: "#3B1418",
  onDangerSurface: "#FCA5A5",

  bgApp: "#0B0F17",
  surfaceCard: "#151C28",
  surfaceAlt: "#1E2635",
  border: "#1E293B",

  textPrimary: "#F8FAFC",
  textMuted: "#94A3B8",
  textFaint: "#64748B",

  scrim: "rgba(0, 0, 0, 0.6)",

  series: chartSeries,
};

export type ColorSchemeName = "light" | "dark";

export const Colors: Record<ColorSchemeName, ThemeColors> = { light, dark };

export default Colors;
