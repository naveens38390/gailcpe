/**
 * Hand-rolled chart primitives on react-native-svg — already a dependency,
 * works identically on native and web. No charting library: these are a
 * handful of small presentational components, not a real charting engine,
 * and this app has none installed today.
 *
 * Sized via viewBox rather than a measured onLayout width: react-native-web's
 * onLayout is ResizeObserver-backed and never fired reliably here for a
 * plain View with no intrinsic content, so the SVG never got a nonzero width
 * to render at. A fixed virtual coordinate system plus width="100%" lets the
 * SVG viewport itself stretch to fill its container — no measurement, no
 * layout race, works identically on native and web.
 */

import { Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect } from "react-native-svg";

import { theme } from "../theme";
import { makeStyles, useTheme } from "../context/theme";

export interface ChartPoint {
  label: string;
  value: number;
}

const DEFAULT_HEIGHT = 120;
/** The virtual coordinate space every chart is drawn in — arbitrary, since
 * the viewBox scales it to whatever width the SVG actually renders at. */
const VIRTUAL_WIDTH = 320;

export function BarChart({
  data,
  color,
  height = DEFAULT_HEIGHT,
}: {
  data: ChartPoint[];
  color?: string;
  height?: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tint = color ?? colors.primary;
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 2;
  const barWidth = data.length ? Math.max(1, VIRTUAL_WIDTH / data.length - gap) : 0;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${VIRTUAL_WIDTH} ${height}`} preserveAspectRatio="none">
        {data.map((d, i) => {
          const barHeight = (d.value / max) * (height - 4);
          return (
            <Rect
              key={i}
              x={i * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              fill={tint}
              opacity={d.value === 0 ? 0.15 : 1}
            />
          );
        })}
      </Svg>
      <ChartFooter first={data[0]?.label} last={data[data.length - 1]?.label} />
    </View>
  );
}

export function LineChart({
  data,
  color,
  height = DEFAULT_HEIGHT,
}: {
  data: ChartPoint[];
  color?: string;
  height?: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tint = color ?? colors.primary;
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? VIRTUAL_WIDTH / (data.length - 1) : 0;

  const points = data
    .map((d, i) => `${i * stepX},${height - (d.value / max) * (height - 8) - 4}`)
    .join(" ");

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${VIRTUAL_WIDTH} ${height}`} preserveAspectRatio="none">
        <Line x1={0} y1={height - 4} x2={VIRTUAL_WIDTH} y2={height - 4} stroke={colors.border} strokeWidth={1} />
        <Polyline points={points} fill="none" stroke={tint} strokeWidth={2} />
        {data.map((d, i) => (
          <Circle
            key={i}
            cx={i * stepX}
            cy={height - (d.value / max) * (height - 8) - 4}
            r={d.value === 0 ? 0 : 2.5}
            fill={tint}
          />
        ))}
      </Svg>
      <ChartFooter first={data[0]?.label} last={data[data.length - 1]?.label} />
    </View>
  );
}

/** A single two-segment stacked bar — for a two-way ratio like approved vs
 * rejected. Deliberately not a pie/donut: arc math is more complexity than
 * a two-way split needs. */
export function RatioBar({
  a,
  b,
}: {
  a: { label: string; value: number; color?: string };
  b: { label: string; value: number; color?: string };
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const total = a.value + b.value;
  const aColor = a.color ?? colors.success;
  const bColor = b.color ?? colors.danger;
  const aPct = total > 0 ? a.value / total : 0.5;
  const bPct = 1 - aPct;

  return (
    <View>
      <View style={styles.ratioBar}>
        {total > 0 ? (
          <>
            <View style={[styles.ratioSegment, { flex: aPct, backgroundColor: aColor }]} />
            <View style={[styles.ratioSegment, { flex: bPct, backgroundColor: bColor }]} />
          </>
        ) : (
          <View style={[styles.ratioSegment, { flex: 1, backgroundColor: colors.border }]} />
        )}
      </View>
      <View style={styles.ratioLegend}>
        <LegendItem color={aColor} label={`${a.label} (${a.value})`} />
        <LegendItem color={bColor} label={`${b.label} (${b.value})`} />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function ChartFooter({ first, last }: { first?: string; last?: string }) {
  const styles = useStyles();
  if (!first || !last || first === last) return null;
  return (
    <View style={styles.footerRow}>
      <Text style={styles.footerLabel}>{first}</Text>
      <Text style={styles.footerLabel}>{last}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: theme.space(1) },
  footerLabel: { color: c.textFaint, fontSize: 10 },
  ratioBar: {
    flexDirection: "row",
    height: 20,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  ratioSegment: { height: "100%" },
  ratioLegend: { flexDirection: "row", gap: theme.space(4), marginTop: theme.space(2) },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.space(1) },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: c.textMuted, fontSize: 12 },
}));
