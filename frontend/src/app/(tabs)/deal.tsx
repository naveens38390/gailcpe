import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import {
  api,
  type DealOption,
  type DealSimulation,
  type GradeAvailability,
  type PaymentMode,
} from "../../services/api";
import { Field, Input, PaymentToggle, PrimaryButton } from "../../components/inputs";
import { PriceLadder } from "../../components/priceLadder";
import { SelectField, type Option } from "../../components/select";
import { useCatalog } from "../../context/catalog";
import { rupees, theme } from "../../theme";
import { Card, Caveat, Empty, ErrorNote, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";
import type { ThemeColors } from "../../constants/colors";

const outcomeColor = (c: ThemeColors): Record<string, string> => ({
  leading: c.success,
  matched: c.warning,
  behind: c.danger,
  not_priced: c.neutral,
});

const confidenceColor = (c: ThemeColors): Record<string, string> => ({
  high: c.success,
  medium: c.warning,
  low: c.danger,
});

/**
 * Deal Simulator.
 *
 * Shows what each move costs *and* whether it actually wins. The partial
 * concession is displayed precisely because it usually loses: an officer who
 * offers half the gap has spent margin and still not taken the order.
 */
export default function DealScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { catalog, loading: catalogLoading } = useCatalog();
  const [customer, setCustomer] = useState("");
  const [grade, setGrade] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState("250");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [result, setResult] = useState<DealSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<GradeAvailability | null>(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);

  // Same dependency as Compare: the grade decides which locations can answer.
  useEffect(() => {
    if (!grade) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setAvailabilityBusy(true);
    api
      .gradeAvailability(grade)
      .then((a) => {
        if (cancelled) return;
        setAvailability(a);
        setLocation((current) =>
          current && a.locations.some((l) => l.name === current) ? current : "",
        );
      })
      .catch(() => {
        if (!cancelled) setAvailability(null);
      })
      .finally(() => {
        if (!cancelled) setAvailabilityBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [grade]);

  const gradeOptions: Option[] = useMemo(
    () =>
      (catalog?.grades ?? []).map((g) => ({
        value: g.gailGrade,
        label: g.gailGrade,
        detail: `${g.polymer} · ${g.application}${g.characteristic ? ` · ${g.characteristic}` : ""}`,
        badge:
          g.availability === "comparable"
            ? "comparable"
            : g.availability === "gail_only"
              ? "GAIL only"
              : "no GAIL price",
        badgeTone:
          g.availability === "comparable"
            ? "success"
            : g.availability === "gail_only"
              ? "warning"
              : "danger",
        keywords: `${g.section} ${g.competitors.join(" ")}`,
      })),
    [catalog],
  );

  const locationOptions: Option[] = useMemo(() => {
    if (availability) {
      return availability.locations.map((l) => ({
        value: l.name,
        label: l.name,
        detail: `${l.producers.length} producer${l.producers.length === 1 ? "" : "s"} priced · ${l.producers.join(", ")}`,
        badge: l.producers.length > 1 ? `${l.producers.length}` : "GAIL only",
        badgeTone: l.producers.length > 1 ? "success" : "warning",
      }));
    }
    return (catalog?.locations ?? []).map((l) => ({ value: l.name, label: l.name }));
  }, [availability, catalog]);

  const ready = Boolean(grade && location && Number(quantity) > 0);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(
        await api.simulate({
          customer: customer.trim() || undefined,
          grade,
          location,
          quantityMt: Number(quantity) || 0,
          paymentMode,
        }),
      );
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Simulation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <SectionTitle>Simulate a deal</SectionTitle>

        <Field label="Customer (optional)">
          <Input value={customer} onChangeText={setCustomer} placeholder="ABC Plastics" />
        </Field>

        <SelectField
          label="Grade"
          placeholder="Select a grade"
          value={grade}
          options={gradeOptions}
          onChange={setGrade}
          loading={catalogLoading}
        />

        <SelectField
          label="Location"
          placeholder={grade ? "Select a location" : "Choose a grade first"}
          hint={availability ? `Only where ${availability.grade} is priced` : undefined}
          value={location}
          options={locationOptions}
          onChange={setLocation}
          disabled={!grade}
          loading={availabilityBusy}
          emptyText="No location publishes a price for this grade."
        />

        <Field label="Volume (MT)">
          <Input value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
        </Field>

        <Field label="Payment terms">
          <PaymentToggle value={paymentMode} onChange={setPaymentMode} />
        </Field>

        <PrimaryButton label="Run simulation" onPress={run} busy={busy} disabled={!ready} />
      </Card>

      {error ? <ErrorNote message={error} /> : null}

      {result ? (
        <>
          <Card style={{ borderColor: outcomeColor(colors)[result.outcome] }}>
            <View style={styles.statusRow}>
              <SectionTitle>Position today</SectionTitle>
              <Pill
                label={`DATA ${result.dataConfidence.toUpperCase()}`}
                color={confidenceColor(colors)[result.dataConfidence]}
              />
            </View>
            <Text style={[styles.outcome, { color: outcomeColor(colors)[result.outcome] }]}>
              {result.outcome === "behind"
                ? "Behind"
                : result.outcome === "leading"
                  ? "Leading"
                  : result.outcome === "matched"
                    ? "Level"
                    : "Not priced"}
            </Text>
            {result.narrative.map((line) => (
              <Text key={line} style={styles.narrative}>
                {line}
              </Text>
            ))}
          </Card>

          <Card>
            <PriceLadder
              quotes={result.comparison.quotes}
              title={`Landed cost · ${result.grade} at ${result.location}`}
              caption={`${result.quantityMt} MT · ${
                result.comparison.paymentMode === "cash" ? "cash" : "14-day credit"
              }`}
            />
          </Card>

          {result.options.length ? (
            <Card>
              <SectionTitle>What each move costs</SectionTitle>
              {result.options.map((option) => (
                <OptionRow key={option.label} option={option} />
              ))}
              <Text style={styles.footnote}>
                Correction is per MT off GAIL&apos;s landed cost. Total is that
                correction across {result.quantityMt} MT.
              </Text>
            </Card>
          ) : null}

          {result.dataCaveats.length ? (
            <Card>
              <SectionTitle>Before you quote</SectionTitle>
              {result.dataCaveats.map((caveat) => (
                <Caveat key={caveat}>{caveat}</Caveat>
              ))}
            </Card>
          ) : null}
        </>
      ) : !busy && !error ? (
        <Empty>
          Enter a grade, location and volume to see where GAIL stands and what
          closing the gap would cost.
        </Empty>
      ) : null}
    </ScrollView>
  );
}

function OptionRow({ option }: { option: DealOption }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const colour = outcomeColor(colors)[option.outcome];
  return (
    <View
      style={[
        styles.option,
        option.recommended && { borderColor: colour, borderWidth: 1 },
      ]}
    >
      <View style={styles.optionHead}>
        <Text style={styles.optionLabel}>{option.label}</Text>
        {option.recommended ? <Pill label="RECOMMENDED" color={colour} /> : null}
      </View>
      <View style={styles.optionGrid}>
        <Metric label="Cut / MT" value={rupees(option.correctionPerMt)} />
        <Metric label="Landed" value={rupees(option.gailLanded)} />
        <Metric
          label="Gap after"
          value={option.gapAfter > 0 ? rupees(option.gapAfter) : "ahead"}
          color={colour}
        />
        <Metric label="Total cost" value={rupees(option.totalCost)} />
      </View>
    </View>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  outcome: { fontSize: 26, fontWeight: "800", marginBottom: theme.space(2) },
  narrative: {
    color: c.textPrimary,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: theme.space(2),
  },
  option: {
    backgroundColor: c.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
    marginBottom: theme.space(2),
  },
  optionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.space(2),
  },
  optionLabel: { color: c.textPrimary, fontSize: 14, fontWeight: "700", flex: 1 },
  optionGrid: { flexDirection: "row", justifyContent: "space-between" },
  metric: { flex: 1 },
  metricLabel: { color: c.textFaint, fontSize: 10, marginBottom: 2 },
  metricValue: {
    color: c.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  footnote: {
    color: c.textFaint,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space(1),
  },
}));
