import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  api,
  type Comparison,
  type PaymentMode,
  type Quote,
} from "../../lib/api";
import { useAuth, ROLE_LABEL } from "../../lib/auth";
import {
  Field,
  Input,
  PaymentToggle,
  PrimaryButton,
  Suggestions,
  useSuggestions,
} from "../../lib/inputs";
import { gapColor, rupees, theme, TIER_LABEL } from "../../lib/theme";
import { Card, Caveat, Empty, ErrorNote, Pill, SectionTitle } from "../../lib/ui";

/**
 * Price Comparison.
 *
 * Every number here arrives computed from the backend. The screen decides how
 * to present them and nothing else — no arithmetic, so a figure quoted from a
 * phone is the same figure the pricing team sees.
 */
export default function CompareScreen() {
  const { user, signOut } = useAuth();
  const [grade, setGrade] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState("120");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("credit_ifc");
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gradeHits = useSuggestions(grade, "grade");
  const locationHits = useSuggestions(location, "location");

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(
        await api.compare({
          grade: grade.trim(),
          location: location.trim(),
          quantityMt: Number(quantity) || 0,
          paymentMode,
        }),
      );
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  const ordered = result
    ? [...result.quotes].sort((a, b) => {
        if (a.invoiceLanded === null) return 1;
        if (b.invoiceLanded === null) return -1;
        return a.invoiceLanded - b.invoiceLanded;
      })
    : [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>{user?.name}</Text>
          <Text style={styles.role}>{ROLE_LABEL[user?.role ?? ""] ?? user?.role}</Text>
        </View>
        <Pressable onPress={signOut} hitSlop={12}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <Card>
        <SectionTitle>Compare</SectionTitle>

        <Field label="Grade" hint="GAIL code, or the competitor code the customer quoted">
          <Input
            value={grade}
            onChangeText={setGrade}
            autoCapitalize="characters"
            placeholder="B52A003"
          />
          <Suggestions items={gradeHits} onPick={setGrade} />
        </Field>

        <Field label="Customer location">
          <Input
            value={location}
            onChangeText={setLocation}
            autoCapitalize="characters"
            placeholder="PUNE"
          />
          <Suggestions items={locationHits} onPick={setLocation} />
        </Field>

        <Field label="Quantity (MT)">
          <Input
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            placeholder="120"
          />
        </Field>

        <Field label="Payment terms">
          <PaymentToggle value={paymentMode} onChange={setPaymentMode} />
        </Field>

        <PrimaryButton label="Compare" onPress={run} busy={busy} />
      </Card>

      {error ? <ErrorNote message={error} /> : null}

      {result ? (
        <>
          <Verdict result={result} />
          {ordered.map((quote) => (
            <QuoteRow
              key={quote.producer}
              quote={quote}
              isLeader={quote.producer === result.leader?.producer}
            />
          ))}

          <Card>
            <SectionTitle>Basis of these numbers</SectionTitle>
            <Text style={styles.note}>
              Prices w.e.f. {result.effectiveDate}; freight w.e.f. {result.freightDate}.
            </Text>
            <Text style={styles.note}>
              Landed cost is basic less cash discount, plus freight for ex-works
              sellers only. RIL and IOCL publish delivered prices — their freight
              is already inside.
            </Text>
            {result.warnings.map((warning) => (
              <Caveat key={warning}>{warning}</Caveat>
            ))}
          </Card>
        </>
      ) : !busy && !error ? (
        <Empty>Enter a grade and a location to compare all six producers.</Empty>
      ) : null}
    </ScrollView>
  );
}

function Verdict({ result }: { result: Comparison }) {
  const gap = result.gapToLeader;
  const colour = gapColor(gap);

  if (gap === null || !result.leader) {
    return (
      <Card style={{ borderColor: theme.color.unknown }}>
        <SectionTitle>Verdict</SectionTitle>
        <Text style={styles.verdictText}>
          No competitor could be priced here, so there is no gap to close.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={{ borderColor: colour }}>
      <SectionTitle>Verdict</SectionTitle>
      <Text style={[styles.verdictNumber, { color: colour }]}>
        {gap > 0 ? `${rupees(gap)} behind` : `${rupees(-gap)} ahead`}
      </Text>
      <Text style={styles.verdictText}>
        GAIL is #{result.gailRank} of {result.quotes.filter((q) => q.invoiceLanded !== null).length} priced.
        {gap > 0 ? ` ${result.leader.producer} leads.` : " GAIL leads."}
      </Text>
      <Text style={styles.verdictSub}>
        On {result.quantityMt} MT that is {rupees(Math.abs(gap) * result.quantityMt)} across the order.
      </Text>
    </Card>
  );
}

function QuoteRow({ quote, isLeader }: { quote: Quote; isLeader: boolean }) {
  const isGail = quote.producer === "GAIL";
  const unpriced = quote.invoiceLanded === null;

  return (
    <Card
      style={{
        borderColor: isGail ? theme.color.gail : theme.color.border,
        opacity: unpriced ? 0.65 : 1,
      }}
    >
      <View style={styles.quoteHead}>
        <View style={styles.quoteName}>
          <Text style={[styles.producer, isGail && { color: theme.color.gail }]}>
            {quote.producer}
          </Text>
          {isLeader ? <Pill label="CHEAPEST" color={theme.color.leading} /> : null}
        </View>
        <Text style={styles.landed}>{rupees(quote.invoiceLanded)}</Text>
      </View>

      <Text style={styles.gradeLine}>
        {quote.grade ?? "no equivalent"}
        {quote.zone ? ` · ${quote.zone}` : ""}
        {quote.basis ? ` · ${quote.basis.replace("_", "-")}` : ""}
      </Text>

      {!unpriced ? (
        <View style={styles.ladder}>
          <LadderRow label="Basic" value={rupees(quote.basic)} />
          {quote.cashDiscount > 0 ? (
            <LadderRow label="Less cash discount" value={`- ${rupees(quote.cashDiscount)}`} />
          ) : null}
          {quote.basis === "ex_works" ? (
            <LadderRow label="Plus freight" value={`+ ${rupees(quote.freight)}`} />
          ) : null}
          <LadderRow label="Landed (pre-GST)" value={rupees(quote.invoiceLanded)} strong />
          {quote.quantityDiscount > 0 ? (
            <LadderRow
              label="Less quantity credit"
              value={`- ${rupees(quote.quantityDiscount)}`}
            />
          ) : null}
          <LadderRow label="Effective net" value={rupees(quote.effectiveNet)} strong />
          {quote.insurance > 0 ? (
            <LadderRow
              label="Insurance (billed separately)"
              value={rupees(quote.insurance)}
            />
          ) : null}
        </View>
      ) : null}

      {quote.locationTier === "inferred_via_hpl" ? (
        <Caveat>{TIER_LABEL[quote.locationTier]}</Caveat>
      ) : null}
      {quote.mappingConfidence && quote.mappingConfidence !== "H" ? (
        <Caveat>
          Grade mapping confidence is {quote.mappingConfidence}. Confirm the
          substitution before quoting.
        </Caveat>
      ) : null}
      {quote.gaps.map((gap) => (
        <Caveat key={gap}>{gap}</Caveat>
      ))}
    </Card>
  );
}

function LadderRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.ladderRow}>
      <Text style={[styles.ladderLabel, strong && styles.ladderStrong]}>{label}</Text>
      <Text style={[styles.ladderValue, strong && styles.ladderStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.space(4),
  },
  hello: { color: theme.color.text, fontSize: 16, fontWeight: "700" },
  role: { color: theme.color.textFaint, fontSize: 12 },
  signOut: { color: theme.color.accent, fontSize: 13, fontWeight: "600" },
  verdictNumber: { fontSize: 28, fontWeight: "800", marginBottom: theme.space(1) },
  verdictText: { color: theme.color.text, fontSize: 14, lineHeight: 20 },
  verdictSub: { color: theme.color.textMuted, fontSize: 12, marginTop: theme.space(1) },
  quoteHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quoteName: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  producer: { color: theme.color.text, fontSize: 17, fontWeight: "800" },
  landed: { color: theme.color.text, fontSize: 17, fontWeight: "700" },
  gradeLine: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  ladder: {
    marginTop: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space(2),
  },
  ladderRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  ladderLabel: { color: theme.color.textMuted, fontSize: 12 },
  ladderValue: { color: theme.color.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  ladderStrong: { color: theme.color.text, fontWeight: "700" },
  note: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18, marginBottom: theme.space(2) },
});
