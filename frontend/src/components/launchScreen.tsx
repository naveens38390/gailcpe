/**
 * What the app shows while it is opening, and if it cannot open.
 *
 * The native splash hands over the moment the first frame renders, which is
 * before the session exists — so without this the app would flash a bare
 * spinner between a designed splash and a designed screen. This carries the
 * same mark, so the handover is invisible.
 */

import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { makeStyles, useTheme } from "../context/theme";
import { theme } from "../theme";

/** The three-bar mark: the price ladder, drawn the same way the charts do. */
function Mark() {
  const styles = useStyles();
  const { colors } = useTheme();
  const bars = [
    { width: "52%" as const, color: colors.primary },
    { width: "78%" as const, color: colors.series.IOCL },
    { width: "100%" as const, color: colors.neutral },
  ];
  return (
    <View style={styles.mark}>
      {bars.map((b) => (
        <View
          key={b.width}
          style={[styles.bar, { width: b.width, backgroundColor: b.color }]}
        />
      ))}
    </View>
  );
}

export function LaunchScreen({
  status,
  error,
  onRetry,
}: {
  status: string;
  error?: string | null;
  onRetry?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.root}>
      <View style={styles.centre}>
        <Mark />
        <Text style={styles.wordmark}>GCPE</Text>
        <Text style={styles.tagline}>GAIL PE Competitive Pricing</Text>

        {error ? (
          <View style={styles.errorBlock}>
            <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
            <Text style={styles.errorTitle}>Cannot reach the pricing service</Text>
            <Text style={styles.errorBody}>{error}</Text>
            {onRetry ? (
              <Pressable style={styles.retry} onPress={onRetry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.statusBlock}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
      </View>

      <Text style={styles.footer}>GAIL (India) Limited · Polymer Marketing</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: c.bgApp,
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.space(14),
    paddingHorizontal: theme.space(8),
  },
  centre: { flex: 1, justifyContent: "center", alignItems: "center", width: "100%" },
  mark: { width: 96, alignItems: "flex-start", gap: 7, marginBottom: theme.space(6) },
  bar: { height: 14, borderRadius: 7 },
  wordmark: {
    color: c.textPrimary,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 6,
  },
  tagline: {
    color: c.textMuted,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: theme.space(2),
  },
  statusBlock: { flexDirection: "row", alignItems: "center", gap: theme.space(3), marginTop: theme.space(10) },
  status: { color: c.textFaint, fontSize: 13 },
  errorBlock: { alignItems: "center", marginTop: theme.space(10), gap: theme.space(2) },
  errorTitle: { color: c.textPrimary, fontSize: 16, fontWeight: "700" },
  errorBody: { color: c.textMuted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  retry: {
    backgroundColor: c.primary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(6),
    paddingVertical: theme.space(3),
    marginTop: theme.space(3),
  },
  retryText: { color: c.onPrimary, fontWeight: "700", fontSize: 14 },
  footer: { color: c.textFaint, fontSize: 11, letterSpacing: 0.5 },
}));
