import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { api, type Correction, type CorrectionStatus, type CorrectionSummary } from "../../services/api";
import { actorLabel, correctionStatusColor } from "../../components/masterData";
import { rupees, theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/** The tab a screen shows and the status it actually queries — "applied" is
 * this app's one true "approved" state; the schema's own "approved" value is
 * never assigned by the backend. */
const TABS: Array<{ key: string; label: string; status: CorrectionStatus }> = [
  { key: "pending", label: "Pending", status: "pending" },
  { key: "approved", label: "Approved", status: "applied" },
  { key: "rejected", label: "Rejected", status: "rejected" },
  { key: "changes", label: "Revision Requested", status: "changes_requested" },
];

/**
 * Approvals — the manager-facing view of the same corrections data the
 * field-facing (tabs)/corrections.tsx screen already proposes and decides
 * against. This adds KPI counts, a status-tab split, and routes into a
 * dedicated detail screen instead of deciding inline.
 */
export default function ApprovalsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();

  const [summary, setSummary] = useState<CorrectionSummary | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const [items, setItems] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: CorrectionStatus) => {
    setLoading(true);
    try {
      const [list, summaryData] = await Promise.all([
        api.corrections(status),
        api.correctionSummary(),
      ]);
      setItems(list);
      setSummary(summaryData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab.status);
  }, [load, tab]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <Card>
        <SectionTitle>Approvals</SectionTitle>
        <View style={styles.kpiRow}>
          <Kpi label="Pending" value={summary?.pending} color={colors.warning} />
          <Kpi label="Approved today" value={summary?.approvedToday} color={colors.success} />
          <Kpi label="Rejected" value={summary?.rejected} color={colors.danger} />
          <Kpi label="Revision requested" value={summary?.changesRequested} color={colors.primary} />
        </View>
      </Card>

      <View style={styles.tabRow}>
        {TABS.map((t) => {
          const active = t.key === tab.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Loading label="Loading approvals" /> : null}

      {!loading ? (
        <Card>
          {items.map((c) => (
            <Pressable
              key={c._id}
              style={styles.row}
              onPress={() => router.push(`/admin/approval/${c._id}` as never)}
            >
              <View style={styles.rowHead}>
                <Text style={styles.rowGrade}>
                  {c.grade} · {c.zone}
                </Text>
                <Pill
                  label={c.status.replace("_", " ").toUpperCase()}
                  color={correctionStatusColor(colors)[c.status] ?? colors.neutral}
                />
              </View>
              <Text style={styles.priceLine}>
                {rupees(c.currentPrice)} → {rupees(c.proposedPrice)}
              </Text>
              <Text style={styles.reason} numberOfLines={2}>
                {c.reason}
              </Text>
              <Text style={styles.meta}>
                proposed by {actorLabel(c.proposedBy)} ·{" "}
                {new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </Text>
            </Pressable>
          ))}
          {!items.length ? <Empty>No {tab.label.toLowerCase()} corrections.</Empty> : null}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Kpi({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  const styles = useStyles();
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, { color }]}>{value ?? "–"}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(4), marginTop: theme.space(3) },
  kpi: { minWidth: 96 },
  kpiValue: { fontSize: 22, fontWeight: "800" },
  kpiLabel: { color: c.textMuted, fontSize: 11, marginTop: 2 },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space(2),
    marginTop: theme.space(3),
    marginBottom: theme.space(3),
  },
  tab: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  tabActive: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { color: c.textMuted, fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: c.onPrimary },
  row: { paddingVertical: theme.space(3), borderTopWidth: 1, borderTopColor: c.border },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowGrade: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  priceLine: { color: c.textPrimary, fontSize: 13, fontWeight: "600", marginTop: theme.space(1) },
  reason: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  meta: { color: c.textFaint, fontSize: 11, marginTop: 2 },
}));
