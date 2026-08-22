import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api, type DealOption, type DealSimulation, type PaymentMode } from "../../lib/api";
import {
  Field,
  Input,
  PaymentToggle,
  PrimaryButton,
  Suggestions,
  useSuggestions,
} from "../../lib/inputs";
import { rupees, theme } from "../../lib/theme";
import { Card, Caveat, Empty, ErrorNote, Pill, SectionTitle } from "../../lib/ui";

const OUTCOME_COLOR: Record<string, string> = {
  leading: theme.color.leading,
  matched: theme.color.matched,
  behind: theme.color.behind,
  not_priced: theme.color.unknown,
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: theme.color.leading,
  medium: theme.color.matched,
  low: theme.color.behind,
};

/**
 * Deal Simulator.
 *
 * Shows what each move costs *and* whether it actually wins. The partial
 * concession is displayed precisely because it usually loses: an officer who
 * offers half the gap has spent margin and still not taken the order.
 */
export default function DealScreen() {
  const [customer, setCustomer] = useState("");
  const [grade, setGrade] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState("250");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [result, setResult] = useState<DealSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gradeHits = useSuggestions(grade, "grade");
  const locationHits = useSuggestions(location, "location");

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(
        await api.simulate({
          customer: customer.trim() || undefined,
          grade: grade.trim(),
          location: location.trim(),
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

        <Field label="Grade">
          <Input
            value={grade}
            onChangeText={setGrade}
            autoCapitalize="characters"
            placeholder="B52A003"
          />
          <Suggestions items={gradeHits} onPick={setGrade} />
        </Field>

        <Field label="Location">
          <Input
            value={location}
            onChangeText={setLocation}
            autoCapitalize="characters"
            placeholder="AHMEDABAD"
          />
          <Suggestions items={locationHits} onPick={setLocation} />
        </Field>

        <Field label="Volume (MT)">
          <Input value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
        </Field>

        <Field label="Payment terms">
          <PaymentToggle value={paymentMode} onChange={setPaymentMode} />
        </Field>

        <PrimaryButton label="Run simulation" onPress={run} busy={busy} />
      </Card>

      {error ? <ErrorNote message={error} /> : null}

      {result ? (
        <>
          <Card style={{ borderColor: OUTCOME_COLOR[result.outcome] }}>
            <View style={styles.statusRow}>
              <SectionTitle>Position today</SectionTitle>
              <Pill
                label={`DATA ${result.dataConfidence.toUpperCase()}`}
                color={CONFIDENCE_COLOR[result.dataConfidence]}
              />
            </View>
            <Text style={[styles.outcome, { color: OUTCOME_COLOR[result.outcome] }]}>
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
  const colour = OUTCOME_COLOR[option.outcome];
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
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  outcome: { fontSize: 26, fontWeight: "800", marginBottom: theme.space(2) },
  narrative: {
    color: theme.color.text,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: theme.space(2),
  },
  option: {
    backgroundColor: theme.color.surfaceAlt,
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
  optionLabel: { color: theme.color.text, fontSize: 14, fontWeight: "700", flex: 1 },
  optionGrid: { flexDirection: "row", justifyContent: "space-between" },
  metric: { flex: 1 },
  metricLabel: { color: theme.color.textFaint, fontSize: 10, marginBottom: 2 },
  metricValue: {
    color: theme.color.text,
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  footnote: {
    color: theme.color.textFaint,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space(1),
  },
});
