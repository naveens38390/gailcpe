/**
 * The price ladder — where GAIL sits against everyone quoting this grade here.
 *
 * One bar per producer, ordered cheapest first, drawn from a common baseline so
 * the gap is a length rather than a subtraction the reader has to perform.
 * The axis starts below the cheapest quote rather than at zero: every bar would
 * otherwise be the same length to within a percent, and the question this chart
 * answers is the difference, not the magnitude.
 */

import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import { View, Text } from "react-native";

import { seriesColor } from "../constants/colors";
import { makeStyles, useTheme } from "../context/theme";
import { rupees, theme } from "../theme";
import type { Quote } from "../services/api";

const ROW = 34;
const LABEL_W = 58;
const VALUE_W = 82;

export function PriceLadder({
  quotes,
  metric = "invoiceLanded",
  title,
  caption,
}: {
  quotes: Quote[];
  metric?: "invoiceLanded" | "effectiveNet";
  title: string;
  caption?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  const priced = quotes
    .map((q) => ({ q, v: q[metric] }))
    .filter((r): r is { q: Quote; v: number } => typeof r.v === "number")
    .sort((a, b) => a.v - b.v);

  const unpriced = quotes.filter((q) => typeof q[metric] !== "number");

  if (priced.length < 2) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.note}>
          Not enough published prices at this location to draw a comparison.
        </Text>
      </View>
    );
  }

  const min = priced[0]!.v;
  const max = priced[priced.length - 1]!.v;
  const span = Math.max(max - min, 1);
  // Head-room below the cheapest so the leader still shows a visible bar.
  const floor = min - span * 0.35;
  const scale = (v: number) => (v - floor) / (max - floor);

  const height = priced.length * ROW + 26;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>

      <Svg width="100%" height={height} viewBox={`0 0 320 ${height}`} preserveAspectRatio="none">
        {/* Leader reference line */}
        <Line
          x1={LABEL_W}
          y1={4}
          x2={LABEL_W}
          y2={priced.length * ROW}
          stroke={colors.border}
          strokeWidth={1}
        />
        {priced.map(({ q, v }, i) => {
          const y = i * ROW + 6;
          const full = 320 - LABEL_W - VALUE_W;
          const w = Math.max(3, scale(v) * full);
          const isGail = q.producer === "GAIL";
          const fill = isGail ? colors.primary : seriesColor(q.producer);
          return (
            <G key={q.producer}>
              <SvgText
                x={LABEL_W - 6}
                y={y + 15}
                fontSize={11}
                fontWeight={isGail ? "700" : "500"}
                fill={isGail ? colors.primary : colors.textMuted}
                textAnchor="end"
              >
                {q.producer}
              </SvgText>
              <Rect
                x={LABEL_W}
                y={y}
                width={w}
                height={ROW - 14}
                rx={3}
                fill={fill}
                opacity={isGail ? 1 : 0.75}
              />
              <SvgText
                x={LABEL_W + w + 6}
                y={y + 15}
                fontSize={11}
                fontWeight={isGail ? "700" : "500"}
                fill={colors.textPrimary}
              >
                {Math.round(v).toLocaleString("en-IN")}
              </SvgText>
            </G>
          );
        })}
      </Svg>

      <View style={styles.legend}>
        <Text style={styles.legendText}>
          Cheapest {rupees(min)} · dearest {rupees(max)} · spread {rupees(max - min)}/MT
        </Text>
        {unpriced.length ? (
          <Text style={styles.legendMuted}>
            Not priced here: {unpriced.map((q) => q.producer).join(", ")}
          </Text>
        ) : null}
        {caption ? <Text style={styles.legendMuted}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { marginTop: theme.space(2) },
  title: {
    color: c.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: theme.space(2),
  },
  note: { color: c.textFaint, fontSize: 12, paddingVertical: theme.space(3) },
  legend: { marginTop: theme.space(2), gap: 2 },
  legendText: { color: c.textMuted, fontSize: 11 },
  legendMuted: { color: c.textFaint, fontSize: 11 },
}));
