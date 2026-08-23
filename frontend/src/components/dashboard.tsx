import type { ReactNode } from "react";
import { Text, View } from "react-native";

import type { AuditLogEntry } from "../services/api";
import { actorLabel } from "./masterData";
import { Empty } from "./ui";
import { theme } from "../theme";
import { makeStyles } from "../context/theme";

const ACTION_LABELS: Record<string, string> = {
  "correction.propose": "Correction Submitted",
  "correction.approve": "Correction Approved",
  "correction.reject": "Correction Rejected",
  "correction.request_changes": "Correction Sent Back",
  "price_circular.publish": "Circular Published",
  "price_circular.submit": "Circular Submitted",
  "price_circular.review": "Circular Reviewed",
  "price_circular.rollback": "Circular Rolled Back",
  login: "Signed In",
};

/** A readable label for one audit action — shared by the dashboard's Recent
 * Activity feed and the Audit Log screen, so the two never drift apart. */
export function describeAuditAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action.endsWith(".publish")) return "Master Data Updated";
  if (action.endsWith(".submit")) return "Change Submitted";
  if (action.endsWith(".review")) return "Change Reviewed";
  if (action.endsWith(".rollback")) return "Change Rolled Back";
  return action;
}

export function KpiCard({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  const styles = useStyles();
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, { color }]}>{value ?? "–"}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

export function KpiGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.kpiGroup}>
      <Text style={styles.kpiGroupTitle}>{title}</Text>
      <View style={styles.kpiRow}>{children}</View>
    </View>
  );
}

export function RecentActivityFeed({ items }: { items: AuditLogEntry[] }) {
  const styles = useStyles();
  if (!items.length) return <Empty>No activity yet.</Empty>;
  return (
    <View>
      {items.map((entry) => (
        <View key={entry._id} style={styles.activityRow}>
          <Text style={styles.activityAction}>{describeAuditAction(entry.action)}</Text>
          <Text style={styles.activityMeta}>
            {actorLabel(entry.user)} · {new Date(entry.createdAt).toLocaleString("en-IN")}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  kpiGroup: { marginBottom: theme.space(4) },
  kpiGroupTitle: {
    color: c.textFaint,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.space(2),
  },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(5) },
  kpi: { minWidth: 90 },
  kpiValue: { fontSize: 24, fontWeight: "800" },
  kpiLabel: { color: c.textMuted, fontSize: 11, marginTop: 2 },
  activityRow: { paddingVertical: theme.space(2), borderTopWidth: 1, borderTopColor: c.border },
  activityAction: { color: c.textPrimary, fontSize: 13, fontWeight: "700" },
  activityMeta: { color: c.textFaint, fontSize: 11, marginTop: 2 },
}));
