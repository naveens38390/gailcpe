import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, type CircularList, type Round } from "../../lib/api";
import { theme } from "../../lib/theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../lib/ui";

/**
 * Circular Repository.
 *
 * Versioned by effective date from the first record. New circulars arrive
 * monthly, and an officer defending a quote needs the circular that was live on
 * the day they gave it — publishing supersedes rather than deletes.
 */
export default function CircularsScreen() {
  const [list, setList] = useState<CircularList | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [circulars, roundList] = await Promise.all([
        api.circulars(),
        api.rounds(),
      ]);
      setList(circulars);
      setRounds(roundList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load circulars.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading label="Loading circulars" />;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={theme.color.accent}
        />
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      {rounds.length ? (
        <Card>
          <SectionTitle>Price rounds</SectionTitle>
          {rounds.map((round) => (
            <View key={round.effectiveDate} style={styles.round}>
              <Text style={styles.roundDate}>
                {new Date(round.effectiveDate).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
              <Text style={styles.roundProducers}>
                {round.producers.join(" · ")}
              </Text>
            </View>
          ))}
          {rounds.length === 1 ? (
            <Text style={styles.footnote}>
              Only one round is loaded, so there is nothing to compare against
              yet. Comparisons between rounds appear once a second circular is
              published.
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Price circulars</SectionTitle>
        {list?.price.length ? (
          list.price.map((circular) => (
            <CircularRow key={String(circular._id)} circular={circular} />
          ))
        ) : (
          <Empty>No price circulars loaded.</Empty>
        )}
      </Card>

      <Card>
        <SectionTitle>Freight circulars</SectionTitle>
        {list?.freight.length ? (
          list.freight.map((circular) => (
            <CircularRow key={String(circular._id)} circular={circular} />
          ))
        ) : (
          <Empty>No freight circulars loaded.</Empty>
        )}
      </Card>
    </ScrollView>
  );
}

function CircularRow({ circular }: { circular: Record<string, unknown> }) {
  const status = String(circular.status ?? "");
  const stats = (circular.stats ?? {}) as Record<string, number>;
  const summary = Object.entries(stats)
    .map(([key, value]) => `${value.toLocaleString("en-IN")} ${key}`)
    .join(" · ");

  return (
    <View style={styles.circular}>
      <View style={styles.circularHead}>
        <Text style={styles.producer}>{String(circular.producer ?? "")}</Text>
        <Pill
          label={status.toUpperCase()}
          color={status === "active" ? theme.color.leading : theme.color.textFaint}
        />
      </View>
      <Text style={styles.effective}>
        w.e.f.{" "}
        {new Date(String(circular.effectiveDate)).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
        {circular.basis ? ` · ${String(circular.basis).replace("_", "-")}` : ""}
      </Text>
      {summary ? <Text style={styles.stats}>{summary}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  round: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.space(2),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  roundDate: { color: theme.color.text, fontSize: 14, fontWeight: "700" },
  roundProducers: { color: theme.color.textFaint, fontSize: 11, flex: 1, textAlign: "right" },
  circular: {
    paddingVertical: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  circularHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  producer: { color: theme.color.text, fontSize: 15, fontWeight: "700" },
  effective: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  stats: { color: theme.color.textFaint, fontSize: 11, marginTop: 2 },
  footnote: {
    color: theme.color.textFaint,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space(2),
  },
});
