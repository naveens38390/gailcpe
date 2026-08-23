import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { api, type AuditLogEntry, type AuditLogQuery } from "../../services/api";
import { actorLabel, formatDiffValue } from "../../components/masterData";
import { describeAuditAction } from "../../components/dashboard";
import { Field, Input } from "../../components/inputs";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

const FILTER_TABS: Array<{ key: string; label: string; filter: Pick<AuditLogQuery, "entity" | "action"> }> = [
  { key: "all", label: "All", filter: {} },
  { key: "correction", label: "Corrections", filter: { entity: "correction" } },
  { key: "circular", label: "Circulars", filter: { entity: "price_circular" } },
  { key: "producer", label: "Producers", filter: { entity: "producer" } },
  { key: "location", label: "Locations", filter: { entity: "location" } },
  { key: "grade", label: "Grades", filter: { entity: "grade" } },
  { key: "discount_terms", label: "Discount Terms", filter: { entity: "discount_terms" } },
  { key: "login", label: "Login", filter: { action: "login" } },
];

const PAGE_SIZE = 25;

/**
 * Who changed what, and when — across the whole app, not one module at a
 * time. There is exactly one administrator account today, so a user filter
 * would be a no-op control with one possible value; the backend still
 * accepts one (AuditLogQuery.user) for whenever a second account exists, but
 * nothing here renders it.
 */
export default function AuditLogScreen() {
  const styles = useStyles();
  const { colors } = useTheme();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState(FILTER_TABS[0]);

  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      append ? setLoadingMore(true) : setLoading(true);
      try {
        const res = await api.auditLogs({
          from: from.trim() || undefined,
          to: to.trim() || undefined,
          q: q.trim() || undefined,
          ...tab.filter,
          page: nextPage,
          limit: PAGE_SIZE,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setPage(res.page);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the audit log.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [from, to, q, tab],
  );

  useEffect(() => {
    const timer = setTimeout(() => load(1, false), q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, q, tab]);

  const hasMore = items.length < total;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <Card>
        <SectionTitle>Audit Log</SectionTitle>

        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Field label="From" hint="YYYY-MM-DD">
              <Input value={from} onChangeText={setFrom} placeholder="2026-08-01" />
            </Field>
          </View>
          <View style={styles.dateField}>
            <Field label="To" hint="YYYY-MM-DD">
              <Input value={to} onChangeText={setTo} placeholder="2026-08-23" />
            </Field>
          </View>
        </View>

        <Field label="Search">
          <Input value={q} onChangeText={setQ} placeholder="Search action or entity" />
        </Field>

        <View style={styles.tabRow}>
          {FILTER_TABS.map((t) => {
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
      </Card>

      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Loading label="Loading audit log" /> : null}

      {!loading ? (
        <Card>
          {items.map((entry) => (
            <AuditLogRow key={entry._id} entry={entry} />
          ))}
          {!items.length ? <Empty>No audit log entries match these filters.</Empty> : null}
          {hasMore ? (
            <Pressable style={styles.loadMore} onPress={() => load(page + 1, true)} disabled={loadingMore}>
              <Text style={styles.link}>
                {loadingMore ? "Loading…" : `Load more (${total - items.length})`}
              </Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function AuditLogRow({ entry }: { entry: AuditLogEntry }) {
  const styles = useStyles();
  const { previous, next, ...rest } = entry.detail as {
    previous?: unknown;
    next?: unknown;
    entityId?: unknown;
    [key: string]: unknown;
  };
  const hasDiff = previous !== undefined || next !== undefined;
  const fallback = Object.entries(rest)
    .filter(([k]) => k !== "entityId")
    .map(([k, v]) => `${k}: ${formatDiffValue(v)}`)
    .join(" · ");

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.action}>{describeAuditAction(entry.action)}</Text>
        <Text style={styles.entity}>{entry.entity}</Text>
      </View>
      {hasDiff ? (
        <View style={styles.diffLine}>
          <Text style={styles.diffFrom}>{formatDiffValue(previous)}</Text>
          <Text style={styles.diffArrow}>→</Text>
          <Text style={styles.diffTo}>{formatDiffValue(next)}</Text>
        </View>
      ) : fallback ? (
        <Text style={styles.fallback}>{fallback}</Text>
      ) : null}
      <Text style={styles.meta}>
        {actorLabel(entry.user)} · {new Date(entry.createdAt).toLocaleString("en-IN")}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  dateRow: { flexDirection: "row", gap: theme.space(3) },
  dateField: { flex: 1 },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(2), marginTop: theme.space(2) },
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
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  row: { paddingVertical: theme.space(3), borderTopWidth: 1, borderTopColor: c.border },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  action: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  entity: { color: c.textFaint, fontSize: 11, textTransform: "uppercase" },
  diffLine: { flexDirection: "row", alignItems: "center", gap: theme.space(2), marginTop: theme.space(1) },
  diffFrom: { color: c.textFaint, fontSize: 12, textDecorationLine: "line-through" },
  diffArrow: { color: c.textFaint, fontSize: 12 },
  diffTo: { color: c.textPrimary, fontSize: 13, fontWeight: "700" },
  fallback: { color: c.textMuted, fontSize: 12, marginTop: theme.space(1) },
  meta: { color: c.textFaint, fontSize: 11, marginTop: theme.space(1) },
  loadMore: { alignItems: "center", paddingVertical: theme.space(3), marginTop: theme.space(2) },
}));
