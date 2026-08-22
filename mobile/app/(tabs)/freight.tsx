import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api, type FreightView } from "../../lib/api";
import {
  Field,
  Input,
  PrimaryButton,
  Suggestions,
  useSuggestions,
} from "../../lib/inputs";
import { rupees, theme } from "../../lib/theme";
import { Card, Caveat, Empty, ErrorNote, Pill, SectionTitle } from "../../lib/ui";

/**
 * Freight Intelligence.
 *
 * Freight decides more comparisons than basic price does, because four of the
 * six producers sell ex-works. A producer with no published rate is shown as
 * unpriced rather than omitted — otherwise the cheapest row on screen might
 * simply be the one with a missing number.
 */
export default function FreightScreen() {
  const [location, setLocation] = useState("");
  const [result, setResult] = useState<FreightView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locationHits = useSuggestions(location, "location");

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(await api.freight(location.trim()));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Could not load freight.");
    } finally {
      setBusy(false);
    }
  }

  const maxRate =
    result?.rows.reduce((m, r) => Math.max(m, r.ratePerMt ?? 0), 0) ?? 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <SectionTitle>Freight to a destination</SectionTitle>
        <Field label="Location">
          <Input
            value={location}
            onChangeText={setLocation}
            autoCapitalize="characters"
            placeholder="PUNE"
          />
          <Suggestions items={locationHits} onPick={setLocation} />
        </Field>
        <PrimaryButton label="Show freight" onPress={run} busy={busy} />
      </Card>

      {error ? <ErrorNote message={error} /> : null}

      {result ? (
        <>
          <Card>
            <SectionTitle>
              {result.location} · w.e.f. {result.effectiveDate}
            </SectionTitle>
            {result.rows.map((row) => {
              const share = maxRate > 0 ? (row.ratePerMt ?? 0) / maxRate : 0;
              const isCheapest = row.producer === result.cheapest;
              return (
                <View key={row.producer} style={styles.row}>
                  <View style={styles.rowHead}>
                    <View style={styles.rowName}>
                      <Text style={styles.producer}>{row.producer}</Text>
                      {isCheapest ? (
                        <Pill label="LOWEST" color={theme.color.leading} />
                      ) : null}
                    </View>
                    <Text style={styles.rate}>
                      {row.basis === "delivered"
                        ? "in price"
                        : row.published
                          ? rupees(row.ratePerMt)
                          : "not published"}
                    </Text>
                  </View>

                  {row.basis === "ex_works" && row.published ? (
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.max(4, share * 100)}%`,
                            backgroundColor: isCheapest
                              ? theme.color.leading
                              : theme.color.accent,
                          },
                        ]}
                      />
                    </View>
                  ) : null}

                  <Text style={styles.meta}>
                    {row.basis === "delivered"
                      ? "Delivered price — freight already included"
                      : row.destination
                        ? `billed as ${row.destination}`
                        : "no destination match"}
                    {row.insurancePerMt > 0
                      ? ` · +${rupees(row.insurancePerMt)} insurance`
                      : ""}
                  </Text>
                </View>
              );
            })}
          </Card>

          <Card>
            <SectionTitle>Reading this</SectionTitle>
            {result.notes.map((note) => (
              <Caveat key={note}>{note}</Caveat>
            ))}
          </Card>
        </>
      ) : !busy && !error ? (
        <Empty>
          Pick a destination to see what each producer charges to deliver there.
        </Empty>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  row: {
    paddingVertical: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  rowHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowName: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  producer: { color: theme.color.text, fontSize: 15, fontWeight: "700" },
  rate: {
    color: theme.color.text,
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  barTrack: {
    height: 6,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: 3,
    marginTop: theme.space(2),
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3 },
  meta: { color: theme.color.textFaint, fontSize: 11, marginTop: theme.space(1) },
});
