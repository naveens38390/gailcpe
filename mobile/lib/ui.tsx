/**
 * Small shared pieces. Kept here so every screen states uncertainty the same
 * way — a caveat that looks different on each screen stops being read.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { useState } from "react";

import { downloadExport } from "./download";
import { theme } from "./theme";

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: object;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

/** A caveat about the data itself, not about the deal. */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <View style={styles.caveat}>
      <Text style={styles.caveatMark}>!</Text>
      <Text style={styles.caveatText}>{children}</Text>
    </View>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <View style={styles.centre}>
      <ActivityIndicator color={theme.color.accent} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <View style={styles.centre}>
      <Text style={styles.muted}>{children}</Text>
    </View>
  );
}

export function Pill({
  label,
  color = theme.color.textMuted,
}: {
  label: string;
  color?: string;
}) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

/**
 * The one place a screen turns "published data" into a downloadable file.
 * Excel and PDF are generated fresh on every tap, server-side, from whatever
 * is currently published — never a cached copy.
 */
export function ExportButtons({
  excel,
  pdf,
}: {
  excel?: { path: string; filename: string };
  pdf?: { path: string; filename: string };
}) {
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "excel" | "pdf", target: { path: string; filename: string }) {
    setBusy(kind);
    setError(null);
    try {
      await downloadExport(target.path, target.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate that file.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View>
      <View style={styles.exportRow}>
        {excel ? (
          <Pressable
            style={styles.exportBtn}
            onPress={() => run("excel", excel)}
            disabled={busy !== null}
          >
            <Text style={styles.exportBtnText}>{busy === "excel" ? "Generating…" : "⬇ Excel"}</Text>
          </Pressable>
        ) : null}
        {pdf ? (
          <Pressable
            style={styles.exportBtn}
            onPress={() => run("pdf", pdf)}
            disabled={busy !== null}
          >
            <Text style={styles.exportBtnText}>{busy === "pdf" ? "Generating…" : "⬇ PDF"}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.exportError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    marginBottom: theme.space(3),
  },
  sectionTitle: {
    color: theme.color.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: theme.space(2),
  },
  muted: { color: theme.color.textMuted, fontSize: 13, lineHeight: 19 },
  centre: { alignItems: "center", gap: theme.space(2), padding: theme.space(8) },
  caveat: {
    flexDirection: "row",
    gap: theme.space(2),
    backgroundColor: theme.color.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.matched,
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
    marginTop: theme.space(2),
  },
  caveatMark: { color: theme.color.matched, fontWeight: "800", fontSize: 13 },
  caveatText: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18, flex: 1 },
  error: {
    backgroundColor: "#FEE2E2",
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
    marginBottom: theme.space(3),
  },
  errorText: { color: "#991B1B", fontSize: 13, lineHeight: 19 },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.space(2),
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  exportRow: { flexDirection: "row", gap: theme.space(2), marginTop: theme.space(2) },
  exportBtn: {
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  exportBtnText: { color: theme.color.text, fontSize: 12, fontWeight: "700" },
  exportError: { color: "#991B1B", fontSize: 11, marginTop: theme.space(1) },
});
