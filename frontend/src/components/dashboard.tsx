import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

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

/** How many entries the dashboard shows before deferring to the full log. */
const ACTIVITY_PREVIEW = 5;

/**
 * The dashboard's glance at what has been happening.
 *
 * Deliberately a preview, not a log. Sign-ins alone can fill a screen, and a
 * page of them pushes the modules an administrator came for below the fold.
 * The audit trail itself is unchanged and complete — this shows the newest few
 * and points at it.
 */
export function RecentActivityFeed({
  items,
  onViewAll,
}: {
  items: AuditLogEntry[];
  onViewAll?: () => void;
}) {
  const styles = useStyles();
  if (!items.length) return <Empty>No activity yet.</Empty>;

  const shown = items.slice(0, ACTIVITY_PREVIEW);
  const more = items.length > ACTIVITY_PREVIEW;

  return (
    <View>
      {shown.map((entry) => (
        <View key={entry._id} style={styles.activityRow}>
          <Text style={styles.activityAction}>{describeAuditAction(entry.action)}</Text>
          <Text style={styles.activityMeta}>
            {actorLabel(entry.user)} · {new Date(entry.createdAt).toLocaleString("en-IN")}
          </Text>
        </View>
      ))}

      {onViewAll ? (
        <Pressable onPress={onViewAll} style={styles.activityMore} hitSlop={8}>
          <Text style={styles.activityMoreText}>
            {more ? "View all activity" : "Open the audit log"}
          </Text>
        </Pressable>
      ) : null}
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
  activityMore: {
    paddingTop: theme.space(3),
    marginTop: theme.space(1),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  activityMoreText: { color: c.primary, fontSize: 13, fontWeight: "700" },
}));
