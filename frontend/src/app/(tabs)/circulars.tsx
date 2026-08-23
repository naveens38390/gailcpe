import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { api, type CircularList, type Round } from "../../services/api";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/**
 * Circular Repository.
 *
 * Versioned by effective date from the first record. New circulars arrive
 * monthly, and an officer defending a quote needs the circular that was live on
 * the day they gave it — publishing supersedes rather than deletes.
 */
export default function CircularsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
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
          tintColor={colors.primary}
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
  const styles = useStyles();
  const { colors } = useTheme();
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
          color={status === "active" ? colors.success : colors.textFaint}
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

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  round: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.space(2),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  roundDate: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  roundProducers: { color: c.textFaint, fontSize: 11, flex: 1, textAlign: "right" },
  circular: {
    paddingVertical: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  circularHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  producer: { color: c.textPrimary, fontSize: 15, fontWeight: "700" },
  effective: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  stats: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  footnote: {
    color: c.textFaint,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space(2),
  },
}));
