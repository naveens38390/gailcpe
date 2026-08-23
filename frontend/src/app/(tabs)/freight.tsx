import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { api, type FreightView } from "../../services/api";
import { Field, PrimaryButton } from "../../components/inputs";
import { ChipMulti, SelectField, type Option } from "../../components/select";
import { seriesColor } from "../../constants/colors";
import { useCatalog } from "../../context/catalog";
import { rupees, theme } from "../../theme";
import { Card, Caveat, Empty, ErrorNote, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/**
 * Freight Intelligence.
 *
 * Freight decides more comparisons than basic price does, because four of the
 * six producers sell ex-works. A producer with no published rate is shown as
 * unpriced rather than omitted — otherwise the cheapest row on screen might
 * simply be the one with a missing number.
 */
export default function FreightScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { catalog, loading: catalogLoading } = useCatalog();
  const [location, setLocation] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [result, setResult] = useState<FreightView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Only the four ex-works producers publish a freight book. RIL and IOCL sell
   * delivered, so they have no rate to pick — they stay in the results as a
   * "freight already in the price" row, but there is nothing to filter on.
   */
  const freightProducers = useMemo(
    () => (catalog?.producers ?? []).filter((p) => p.basis === "ex_works").map((p) => p.code),
    [catalog],
  );

  const locationOptions: Option[] = useMemo(
    () =>
      (catalog?.locations ?? []).map((l) => ({
        value: l.name,
        label: l.name,
        detail: `${l.producers.length} producer${l.producers.length === 1 ? "" : "s"} publish a price here`,
      })),
    [catalog],
  );

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(await api.freight(location));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Could not load freight.");
    } finally {
      setBusy(false);
    }
  }

  const rows = (result?.rows ?? []).filter(
    (r) => r.basis !== "ex_works" || !hidden.includes(r.producer),
  );
  const maxRate = rows.reduce((m, r) => Math.max(m, r.ratePerMt ?? 0), 0);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <SectionTitle>Freight to a destination</SectionTitle>

        <SelectField
          label="Destination"
          placeholder="Select a destination"
          hint="All 313 locations GAIL prices ex-works"
          value={location}
          options={locationOptions}
          onChange={setLocation}
          loading={catalogLoading}
        />

        {freightProducers.length ? (
          <Field
            label="Ex-works producers"
            hint="RIL and IOCL sell delivered, so they always appear — their freight is inside the price."
          >
            <ChipMulti
              options={freightProducers.map((code) => ({
                value: code,
                label: code,
                color: code === "GAIL" ? undefined : seriesColor(code),
              }))}
              selected={freightProducers.filter((p) => !hidden.includes(p))}
              onToggle={(code) =>
                setHidden((h) => (h.includes(code) ? h.filter((x) => x !== code) : [...h, code]))
              }
            />
          </Field>
        ) : null}

        <PrimaryButton
          label="Show freight"
          onPress={run}
          busy={busy}
          disabled={!location}
        />
      </Card>

      {error ? <ErrorNote message={error} /> : null}

      {result ? (
        <>
          <Card>
            <SectionTitle>
              {result.location} · w.e.f. {result.effectiveDate}
            </SectionTitle>
            {rows.map((row) => {
              const share = maxRate > 0 ? (row.ratePerMt ?? 0) / maxRate : 0;
              const isCheapest = row.producer === result.cheapest;
              return (
                <View key={row.producer} style={styles.row}>
                  <View style={styles.rowHead}>
                    <View style={styles.rowName}>
                      <Text style={styles.producer}>{row.producer}</Text>
                      {isCheapest ? (
                        <Pill label="LOWEST" color={colors.success} />
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
                              ? colors.success
                              : colors.primary,
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

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  row: {
    paddingVertical: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  rowHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowName: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  producer: { color: c.textPrimary, fontSize: 15, fontWeight: "700" },
  rate: {
    color: c.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  barTrack: {
    height: 6,
    backgroundColor: c.surfaceAlt,
    borderRadius: 3,
    marginTop: theme.space(2),
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3 },
  meta: { color: c.textFaint, fontSize: 11, marginTop: theme.space(1) },
}));
