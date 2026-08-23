import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api, type AppNotification, type NotificationType } from "../../services/api";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

const TYPE_TABS: Array<{ key: string; label: string; type?: NotificationType }> = [
  { key: "all", label: "All" },
  { key: "proposed", label: "Submitted", type: "correction.proposed" },
  { key: "approved", label: "Approved", type: "correction.approved" },
  { key: "rejected", label: "Rejected", type: "correction.rejected" },
  { key: "changes", label: "Changes Requested", type: "correction.changes_requested" },
  { key: "circular", label: "Circular Published", type: "circular.published" },
];

const PAGE_SIZE = 20;

export default function NotificationsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState(TYPE_TABS[0]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      append ? setLoadingMore(true) : setLoading(true);
      try {
        const res = await api.notifications({
          unreadOnly,
          type: tab.type,
          q: q.trim() || undefined,
          page: nextPage,
          limit: PAGE_SIZE,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setPage(res.page);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load notifications.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [unreadOnly, tab, q],
  );

  // Debounced: filters and search both refetch from page 1.
  useEffect(() => {
    const timer = setTimeout(() => load(1, false), q ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly, tab, q]);

  async function open(n: AppNotification) {
    if (!n.read) {
      try {
        await api.markNotificationRead(n._id);
        setItems((all) => all.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
      } catch {
        // Reading the notification matters more than the read-flag round trip.
      }
    }
    if (n.entityType === "correction" && n.entityId) {
      router.push(`/admin/approval/${n.entityId}` as never);
    }
  }

  async function markAllRead() {
    try {
      await api.markAllNotificationsRead();
      setItems((all) => all.map((x) => ({ ...x, read: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark all as read.");
    }
  }

  const unreadCount = items.filter((n) => !n.read).length;
  const hasMore = items.length < total;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <Card>
        <View style={styles.headRow}>
          <SectionTitle>Notifications</SectionTitle>
          {unreadCount ? (
            <Pressable onPress={markAllRead}>
              <Text style={styles.link}>Mark all read</Text>
            </Pressable>
          ) : null}
        </View>

        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search notifications"
          placeholderTextColor={colors.textFaint}
          style={styles.search}
        />

        <View style={styles.tabRow}>
          {TYPE_TABS.map((t) => {
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
          <Pressable
            onPress={() => setUnreadOnly((u) => !u)}
            style={[styles.tab, unreadOnly && styles.tabActive]}
          >
            <Text style={[styles.tabText, unreadOnly && styles.tabTextActive]}>Unread only</Text>
          </Pressable>
        </View>

        {error ? <ErrorNote message={error} /> : null}
        {loading ? <Loading label="Loading notifications" /> : null}

        {!loading &&
          items.map((n) => (
            <Pressable key={n._id} style={styles.row} onPress={() => open(n)}>
              <View style={styles.rowHead}>
                {!n.read ? <View style={styles.dot} /> : null}
                <Text style={[styles.title, !n.read && styles.titleUnread]}>{n.title}</Text>
              </View>
              <Text style={styles.notificationBody}>{n.body}</Text>
              <Text style={styles.meta}>{new Date(n.createdAt).toLocaleString("en-IN")}</Text>
            </Pressable>
          ))}
        {!loading && !items.length ? <Empty>No notifications match these filters.</Empty> : null}

        {!loading && hasMore ? (
          <Pressable style={styles.loadMore} onPress={() => load(page + 1, true)} disabled={loadingMore}>
            <Text style={styles.link}>{loadingMore ? "Loading…" : `Load more (${total - items.length})`}</Text>
          </Pressable>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  search: {
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.sm,
    color: c.textPrimary,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    fontSize: 13,
    marginTop: theme.space(3),
  },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(2), marginTop: theme.space(3) },
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
  rowHead: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.primary },
  title: { color: c.textMuted, fontSize: 14, fontWeight: "600" },
  titleUnread: { color: c.textPrimary, fontWeight: "800" },
  notificationBody: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  meta: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  loadMore: { alignItems: "center", paddingVertical: theme.space(3), marginTop: theme.space(2) },
}));
