import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { api, type Timeline, type TimelineEntry, type TimelineKind } from "../../services/api";
import { Field, Input } from "../../components/inputs";
import { rupees, theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";
import type { ThemeColors } from "../../constants/colors";

/**
 * Change History.
 *
 * The question behind this screen gets asked away from a desk: "why is this
 * price different from the one I quoted in February?" Answering it from the
 * documents means knowing which circular, then finding one row inside a
 * hundred-page annexure. Here the day is the way in, and each entry carries
 * who did it, which circular it came from, and the value before and after.
 */
const KIND_LABEL: Record<TimelineKind, string> = {
  circular_published: "CIRCULAR PUBLISHED",
  circular_filed: "CIRCULAR FILED",
  master_data: "MASTER DATA",
  correction: "PRICE CORRECTION",
};

const kindColor = (c: ThemeColors): Record<TimelineKind, string> => ({
  circular_published: c.success,
  circular_filed: c.neutral,
  master_data: c.primary,
  correction: c.warning,
});

export default function TimelineScreen() {
  const styles = useStyles();
  const [data, setData] = useState<Timeline | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (a: string, b: string) => {
    setLoading(true);
    try {
      setData(await api.timeline({ from: a || undefined, to: b || undefined }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(from, to);
    // Re-runs when a date is cleared as well as set, which is what "show
    // everything again" does.
  }, [load, from, to]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Card>
        <SectionTitle>Change history</SectionTitle>
        <Text style={styles.note}>
          Every published circular, master-data change and applied correction,
          newest first. Leave the dates empty to see everything.
        </Text>
        <View style={styles.dates}>
          <View style={styles.dateField}>
            <Field label="From" hint="YYYY-MM-DD">
              <Input value={from} onChangeText={setFrom} placeholder="2026-01-01" />
            </Field>
          </View>
          <View style={styles.dateField}>
            <Field label="To" hint="inclusive">
              <Input value={to} onChangeText={setTo} placeholder="2026-12-31" />
            </Field>
          </View>
        </View>
        {data ? (
          <Text style={styles.count}>
            {data.total.toLocaleString("en-IN")} change{data.total === 1 ? "" : "s"}
            {data.shown < data.total ? ` · showing the most recent ${data.shown}` : ""}
          </Text>
        ) : null}
      </Card>

      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Loading label="Loading history" /> : null}

      {!loading && data?.days.length
        ? data.days.map((day) => (
            <Card key={day.date}>
              <SectionTitle>{formatDay(day.date)}</SectionTitle>
              {day.entries.map((entry, i) => (
                <Entry key={`${entry.at}-${i}`} entry={entry} />
              ))}
            </Card>
          ))
        : null}

      {!loading && data && !data.days.length ? (
        <Empty>Nothing changed in that period.</Empty>
      ) : null}
    </ScrollView>
  );
}

function Entry({ entry }: { entry: TimelineEntry }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.entry}>
      <View style={styles.entryHead}>
        <Text style={styles.entryTitle}>{entry.title}</Text>
        <Pill label={KIND_LABEL[entry.kind]} color={kindColor(colors)[entry.kind]} />
      </View>

      <Text style={styles.entryMeta}>
        {timeOf(entry.at)} · {entry.by}
        {entry.source ? ` · ${entry.source}` : ""}
      </Text>

      {entry.detail ? <Text style={styles.entryDetail}>{entry.detail}</Text> : null}

      {entry.changes?.map((c) => (
        <View key={c.field} style={styles.change}>
          <Text style={styles.changeField}>{c.field}</Text>
          <View style={styles.changeValues}>
            <Text style={styles.changeFrom}>{display(c.from)}</Text>
            <Text style={styles.changeArrow}>→</Text>
            <Text style={styles.changeTo}>{display(c.to)}</Text>
          </View>
        </View>
      ))}

      {entry.link ? (
        <Pressable onPress={() => open(entry.link!)} hitSlop={8}>
          <Text style={styles.link}>
            {entry.link.kind === "draft" ? "Open the circular draft" : null}
            {entry.link.kind === "freight_draft" ? "Open the freight circular" : null}
            {entry.link.kind === "circular" ? "Open the source document" : null}
            {entry.link.kind === "correction" ? "Open corrections" : null}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function open(link: NonNullable<TimelineEntry["link"]>): void {
  if (link.kind === "draft") router.push(`/admin/price-circular/${link.id}` as never);
  if (link.kind === "freight_draft") router.push(`/admin/freight-circular/${link.id}` as never);
  if (link.kind === "circular") router.push("/admin/circulars" as never);
  if (link.kind === "correction") router.push("/corrections" as never);
}

/** A price reads as money; everything else reads as what it is. */
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? rupees(value) : String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function timeOf(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  dates: { flexDirection: "row", gap: theme.space(3), marginTop: theme.space(2) },
  dateField: { flex: 1 },
  count: { color: c.textFaint, fontSize: 12, marginTop: theme.space(2) },

  entry: { paddingVertical: theme.space(3), borderTopWidth: 1, borderTopColor: c.border },
  entryHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.space(2),
  },
  entryTitle: { color: c.textPrimary, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  entryMeta: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  entryDetail: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: theme.space(1) },

  change: { marginTop: theme.space(2) },
  changeField: { color: c.textMuted, fontSize: 11, fontWeight: "700" },
  changeValues: { flexDirection: "row", alignItems: "center", gap: theme.space(2), marginTop: 1 },
  changeFrom: { color: c.danger, fontSize: 12, textDecorationLine: "line-through" },
  changeArrow: { color: c.textFaint, fontSize: 12 },
  changeTo: { color: c.success, fontSize: 12, fontWeight: "700" },

  link: { color: c.primary, fontSize: 12, fontWeight: "700", marginTop: theme.space(2) },
}));
