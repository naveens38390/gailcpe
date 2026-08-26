import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  api,
  type Comparison,
  type GradeAvailability,
  type PaymentMode,
  type ProductVariants,
  type Quote,
} from "../../services/api";
import { Field, Input, PaymentToggle, PrimaryButton } from "../../components/inputs";
import { PriceLadder } from "../../components/priceLadder";
import { ChipMulti, SelectField, type Option } from "../../components/select";
import { seriesColor } from "../../constants/colors";
import { useCatalog } from "../../context/catalog";
import { gapColor, rupees, theme, TIER_LABEL } from "../../theme";
import { Card, Caveat, Empty, ErrorNote, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/**
 * Price Comparison.
 *
 * Every number here arrives computed from the backend. The screen decides how
 * to present them and nothing else — no arithmetic, so a figure quoted from a
 * phone is the same figure the pricing team sees.
 */
const AVAILABILITY_BADGE: Record<string, { text: string; tone: Option["badgeTone"] }> = {
  comparable: { text: "comparable", tone: "success" },
  gail_only: { text: "GAIL only", tone: "warning" },
  no_gail_price: { text: "no GAIL price", tone: "danger" },
};

export default function CompareScreen() {
  const styles = useStyles();
  const { catalog, loading: catalogLoading, error: catalogError } = useCatalog();

  const [grade, setGrade] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState("120");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("credit_ifc");
  const [hidden, setHidden] = useState<string[]>([]);

  const [availability, setAvailability] = useState<GradeAvailability | null>(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);

  const [variants, setVariants] = useState<ProductVariants | null>(null);

  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Grade drives everything below it: ask the backend which locations can
  // actually price it, and narrow the next two choices to those.
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
        // A location that no longer prices the new grade cannot stay selected.
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

  // The other grades that answer the same requirement. Re-fetched when the
  // location changes because the prices they are chosen on are per-location.
  useEffect(() => {
    if (!grade) {
      setVariants(null);
      return;
    }
    let cancelled = false;
    api
      .gradeVariants(grade, location || undefined)
      .then((v) => {
        if (!cancelled) setVariants(v);
      })
      .catch(() => {
        if (!cancelled) setVariants(null);
      });
    return () => {
      cancelled = true;
    };
  }, [grade, location]);

  const gradeOptions: Option[] = useMemo(() => {
    if (!catalog) return [];
    return catalog.grades.map((g) => {
      const badge = AVAILABILITY_BADGE[g.availability]!;
      return {
        value: g.gailGrade,
        label: g.gailGrade,
        detail: `${g.polymer} · ${g.application}${g.characteristic ? ` · ${g.characteristic}` : ""}`,
        badge: badge.text,
        badgeTone: badge.tone,
        keywords: `${g.section} ${g.competitors.join(" ")} ${g.mfi ?? ""} ${g.density ?? ""}`,
      };
    });
  }, [catalog]);

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
    if (!catalog) return [];
    return catalog.locations.map((l) => ({
      value: l.name,
      label: l.name,
      detail: `${l.producers.length} producer${l.producers.length === 1 ? "" : "s"} publish here`,
    }));
  }, [availability, catalog]);

  /** Producers that can actually quote this grade at this location. */
  const availableProducers = useMemo(() => {
    if (!availability) return catalog?.producers.map((p) => p.code) ?? [];
    if (!location) return availability.producers;
    return availability.locations.find((l) => l.name === location)?.producers ?? [];
  }, [availability, location, catalog]);

  const selectedGrade = catalog?.grades.find((g) => g.gailGrade === grade);
  const ready = Boolean(grade && location && Number(quantity) > 0);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(
        await api.compare({
          grade,
          location,
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

  const shown = result ? result.quotes.filter((q) => !hidden.includes(q.producer)) : [];
  const ordered = [...shown].sort((a, b) => {
    if (a.invoiceLanded === null) return 1;
    if (b.invoiceLanded === null) return -1;
    return a.invoiceLanded - b.invoiceLanded;
  });

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <SectionTitle>Compare</SectionTitle>

        {catalogError ? <ErrorNote message={catalogError} /> : null}

        <SelectField
          label="Grade"
          placeholder="Select a grade"
          hint={
            selectedGrade
              ? `${selectedGrade.locationCount} location${selectedGrade.locationCount === 1 ? "" : "s"} priced · ${
                  selectedGrade.competitors.length
                    ? `mapped to ${selectedGrade.competitors.join(", ")}`
                    : "no competitor equivalence published"
                }`
              : "Search by GAIL code, application, or a competitor code"
          }
          value={grade}
          options={gradeOptions}
          onChange={setGrade}
          loading={catalogLoading}
        />

        <SelectField
          label="Customer location"
          placeholder={grade ? "Select a location" : "Choose a grade first"}
          hint={
            availability
              ? `Showing only where ${availability.grade} is priced`
              : "All GAIL ex-works locations"
          }
          value={location}
          options={locationOptions}
          onChange={setLocation}
          disabled={!grade}
          loading={availabilityBusy}
          emptyText="No location publishes a price for this grade."
        />

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

        {location ? (
          <Field
            label="Producers"
            hint="Tap to include or exclude. Only those publishing a price here are shown."
          >
            <ChipMulti
              options={availableProducers.map((code) => ({
                value: code,
                label: code,
                color: code === "GAIL" ? undefined : seriesColor(code),
              }))}
              selected={availableProducers.filter((p) => !hidden.includes(p))}
              onToggle={(code) =>
                setHidden((h) => (h.includes(code) ? h.filter((x) => x !== code) : [...h, code]))
              }
            />
          </Field>
        ) : null}

        <PrimaryButton label="Compare" onPress={run} busy={busy} disabled={!ready} />
      </Card>

      <VariantPicker variants={variants} selected={grade} onSelect={setGrade} />

      {error ? <ErrorNote message={error} /> : null}

      {result ? (
        <>
          <Verdict result={result} />

          <Card>
            <PriceLadder
              quotes={shown}
              title={`Landed cost · ${result.grade} at ${result.location}`}
              caption={`${result.quantityMt} MT · ${
                result.paymentMode === "cash" ? "cash" : "14-day credit"
              }`}
            />
          </Card>

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
        <Empty>Select a grade and a location to compare all six producers.</Empty>
      ) : null}
    </ScrollView>
  );
}

/**
 * The other grades that answer the same requirement.
 *
 * A customer asks for a material — "blow moulding, general purpose, under five
 * litres" — not a code, and GAIL usually has more than one grade that fits. The
 * cheapest is not automatically the right one: these differ by process and
 * density, so the officer needs the spread and the specs together, not one
 * grade at a time.
 *
 * Nothing renders when a requirement has only one grade; there is no choice to
 * present.
 */
function VariantPicker({
  variants,
  selected,
  onSelect,
}: {
  variants: ProductVariants | null;
  selected: string;
  onSelect: (grade: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!variants || variants.variants.length < 2) return null;

  const priced = variants.variants.filter((v) => v.gailPrice !== null);
  const cheapest = priced.length ? priced[0]!.gailPrice! : null;
  const spread = priced.length > 1 ? priced[priced.length - 1]!.gailPrice! - cheapest! : 0;

  return (
    <Card>
      <SectionTitle>Grades for this requirement</SectionTitle>
      <Text style={styles.variantProduct}>
        {variants.product.application}
        {variants.product.characteristic ? ` · ${variants.product.characteristic}` : ""}
      </Text>
      <Text style={styles.variantCaption}>
        {variants.variants.length} grades fit
        {spread > 0
          ? ` · ${rupees(spread)}/MT between cheapest and dearest here`
          : variants.location
            ? ""
            : " · choose a location to price them"}
      </Text>

      {variants.variants.map((v) => {
        const isSelected = v.gailGrade === selected;
        const delta = v.gailPrice !== null && cheapest !== null ? v.gailPrice - cheapest : null;
        // The cross-reference hangs the additive package off the end of the
        // characteristic. It is the whole reason two grades here differ, so it
        // is shown rather than folded away with the requirement text.
        const additive = /\(([^)]*additive[^)]*)\)\s*$/i.exec(v.characteristic)?.[1];
        const specs = [v.process, v.mfi ? `MFI ${v.mfi}` : null, v.density]
          .filter(Boolean)
          .join(" · ");
        return (
          <Pressable
            key={v.gailGrade}
            onPress={() => onSelect(v.gailGrade)}
            style={[styles.variantRow, isSelected && styles.variantRowOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <View style={styles.variantMain}>
              <View style={styles.variantHead}>
                <Text style={[styles.variantGrade, isSelected && styles.variantGradeOn]}>
                  {v.gailGrade}
                </Text>
                {isSelected ? <Pill label="COMPARING" color={colors.primary} /> : null}
                {additive ? <Pill label={additive.toUpperCase()} color={colors.warning} /> : null}
                {v.availability === "no_gail_price" ? (
                  <Pill label="NO GAIL PRICE" color={colors.danger} />
                ) : null}
              </View>
              {specs ? <Text style={styles.variantSpecs}>{specs}</Text> : null}
            </View>

            <View style={styles.variantPriceCol}>
              <Text style={styles.variantPrice}>
                {v.gailPrice !== null ? rupees(v.gailPrice) : "not priced here"}
              </Text>
              {delta !== null && delta > 0 ? (
                <Text style={styles.variantDelta}>+{rupees(delta)}</Text>
              ) : delta === 0 ? (
                <Text style={styles.variantCheapest}>cheapest</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      <Text style={styles.variantFootnote}>
        Prices are GAIL's basic ex-works rate at this location. Tap a grade to
        compare it against the other producers instead.
      </Text>
    </Card>
  );
}

function Verdict({ result }: { result: Comparison }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const gap = result.gapToLeader;
  const colour = gapColor(gap, colors);

  if (gap === null || !result.leader) {
    return (
      <Card style={{ borderColor: colors.neutral }}>
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
  const styles = useStyles();
  const { colors } = useTheme();
  const isGail = quote.producer === "GAIL";
  const unpriced = quote.invoiceLanded === null;

  return (
    <Card
      style={{
        borderColor: isGail ? colors.series.GAIL : colors.border,
        opacity: unpriced ? 0.65 : 1,
      }}
    >
      <View style={styles.quoteHead}>
        <View style={styles.quoteName}>
          <Text style={[styles.producer, isGail && { color: colors.series.GAIL }]}>
            {quote.producer}
          </Text>
          {isLeader ? <Pill label="CHEAPEST" color={colors.success} /> : null}
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
  const styles = useStyles();
  return (
    <View style={styles.ladderRow}>
      <Text style={[styles.ladderLabel, strong && styles.ladderStrong]}>{label}</Text>
      <Text style={[styles.ladderValue, strong && styles.ladderStrong]}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  verdictNumber: { fontSize: 28, fontWeight: "800", marginBottom: theme.space(1) },
  verdictText: { color: c.textPrimary, fontSize: 14, lineHeight: 20 },
  verdictSub: { color: c.textMuted, fontSize: 12, marginTop: theme.space(1) },
  quoteHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quoteName: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  producer: { color: c.textPrimary, fontSize: 17, fontWeight: "800" },
  landed: { color: c.textPrimary, fontSize: 17, fontWeight: "700" },
  gradeLine: { color: c.textMuted, fontSize: 12, marginTop: 2 },

  variantProduct: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  variantCaption: { color: c.textFaint, fontSize: 12, marginTop: 2 },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(3),
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(3),
    marginTop: theme.space(2),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceAlt,
  },
  variantRowOn: { borderColor: c.primary, backgroundColor: c.surfaceCard },
  variantMain: { flex: 1, gap: 3 },
  variantHead: { flexDirection: "row", alignItems: "center", gap: theme.space(2), flexWrap: "wrap" },
  variantGrade: { color: c.textPrimary, fontSize: 15, fontWeight: "700" },
  variantGradeOn: { color: c.primary },
  variantSpecs: { color: c.textFaint, fontSize: 11 },
  variantPriceCol: { alignItems: "flex-end" },
  variantPrice: { color: c.textPrimary, fontSize: 14, fontWeight: "800" },
  variantDelta: { color: c.danger, fontSize: 11, fontWeight: "700", marginTop: 1 },
  variantCheapest: { color: c.success, fontSize: 11, fontWeight: "700", marginTop: 1 },
  variantFootnote: { color: c.textFaint, fontSize: 11, lineHeight: 16, marginTop: theme.space(3) },
  ladder: {
    marginTop: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: theme.space(2),
  },
  ladderRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  ladderLabel: { color: c.textMuted, fontSize: 12 },
  ladderValue: { color: c.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  ladderStrong: { color: c.textPrimary, fontWeight: "700" },
  note: { color: c.textMuted, fontSize: 12, lineHeight: 18, marginBottom: theme.space(2) },
}));
