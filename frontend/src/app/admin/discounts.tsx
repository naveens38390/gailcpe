import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  api,
  type DiscountImpact,
  type DiscountTermsRecord,
  type Revision,
} from "../../services/api";
import { Field, Input, PrimaryButton } from "../../components/inputs";
import { PendingRevisionRow, RevisionHistory } from "../../components/masterData";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

const PRODUCER = "GAIL";

const FIELDS: Array<{ key: keyof DiscountTermsRecord; label: string }> = [
  { key: "cashDiscount", label: "Cash discount (Rs/MT)" },
  { key: "cashDiscountLdpe", label: "Cash discount, LDPE (Rs/MT)" },
  { key: "earlyPaymentPerDay", label: "EPI — early payment (Rs/MT/day)" },
  { key: "earlyPaymentMaxDays", label: "EPI — max days" },
  { key: "interestFreeCreditDays", label: "IFC — interest-free credit (days)" },
  { key: "dealerDiscount", label: "Dealer discount (Rs/MT)" },
  { key: "metalloceneQdCap", label: "Metallocene QD cap (Rs/MT)" },
];

/**
 * Discount Terms — GAIL's cash discount, EPI, IFC, dealer scheme and
 * quantity slabs, as a first-class master-data entity on the same engine as
 * Producers, Locations and Grades (Draft -> Review -> Approved -> Published
 * -> Rollback), not the ad-hoc propose/approve pair this started as.
 *
 * This is the module that exists to close the single most-repeated gap in
 * this dataset: GAIL's quantity-discount slabs are not in any supplied
 * circular, so the engine reports them as UNKNOWN until this is published.
 */
export default function DiscountsScreen() {
  const styles = useStyles();
  const canPropose = true;
  const canReview = true;
  const canPublish = true;

  const [current, setCurrent] = useState<DiscountTermsRecord | null>(null);
  const [impact, setImpact] = useState<DiscountImpact | null>(null);
  const [pending, setPending] = useState<Revision[]>([]);
  const [history, setHistory] = useState<Revision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, impactData, pend] = await Promise.all([
        api.discountTerms(),
        api.discountImpact(PRODUCER),
        canReview ? api.discountPending() : Promise.resolve([]),
      ]);
      setCurrent(list.find((t) => t.producer === PRODUCER) ?? null);
      setImpact(impactData);
      setPending(pend);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load discount terms.");
    } finally {
      setLoading(false);
    }
  }, [canReview]);

  useEffect(() => {
    load();
  }, [load]);

  async function openHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    try {
      setHistory(await api.discountHistory(PRODUCER));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history.");
    }
  }

  if (loading) return <Loading label="Loading discount terms" />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <View style={styles.cardHead}>
          <SectionTitle>GAIL discount terms</SectionTitle>
          <View style={styles.rowActions}>
            {canPropose ? (
              <Pressable onPress={() => setEditing((e) => !e)}>
                <Text style={styles.link}>{editing ? "Cancel" : "Propose edit"}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={openHistory}>
              <Text style={styles.link}>{showHistory ? "Hide history" : "History"}</Text>
            </Pressable>
          </View>
        </View>

        <CurrentTerms current={current} />

        {impact ? (
          <View style={styles.impact}>
            <Text style={styles.impactTitle}>Last {impact.windowDays} days</Text>
            <Text style={styles.impactLine}>
              {impact.comparisons} comparison{impact.comparisons === 1 ? "" : "s"} · {impact.simulations} deal
              simulation{impact.simulations === 1 ? "" : "s"} · {impact.locations.length} location
              {impact.locations.length === 1 ? "" : "s"}
            </Text>
            {impact.comparisons + impact.simulations > 0 ? (
              <Text style={styles.impactWarn}>
                These terms apply to every GAIL quote — confirm before publishing a change.
              </Text>
            ) : null}
          </View>
        ) : null}

        {editing ? (
          <EditForm
            current={current}
            onDone={() => {
              setEditing(false);
              load();
            }}
          />
        ) : null}

        {showHistory ? (
          <RevisionHistory
            revisions={history}
            canPublish={canPublish}
            onRollback={async (version, reason) => {
              await api.rollbackDiscountTerms(PRODUCER, version, reason);
              setHistory(await api.discountHistory(PRODUCER));
              await load();
            }}
            onDiff={(from, to) => api.discountDiff(PRODUCER, from, to)}
          />
        ) : null}
      </Card>

      {canReview && pending.length ? (
        <Card>
          <SectionTitle>Pending ({pending.length})</SectionTitle>
          {pending.map((rev) => (
            <PendingRevisionRow
              key={rev._id}
              rev={rev}
              canReview={canReview}
              canPublish={canPublish}
              busy={busyId === rev._id}
              actions={{
                submit: (id) => api.submitDiscountRevision(id),
                review: (id, approve) => api.reviewDiscountRevision(id, approve),
                publish: (id) => api.publishDiscountRevision(id),
              }}
              onDone={() => {
                setBusyId(null);
                load();
              }}
              onError={setError}
            />
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function CurrentTerms({ current }: { current: DiscountTermsRecord | null }) {
  const styles = useStyles();
  const set = FIELDS.filter((f) => current?.[f.key] !== undefined && current?.[f.key] !== null);
  return (
    <View>
      {set.length ? (
        set.map((f) => (
          <View key={f.key} style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{f.label}</Text>
            <Text style={styles.summaryValue}>{String(current?.[f.key])}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.readOnlyNote}>No discount terms published yet.</Text>
      )}
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>Quantity discount slabs</Text>
        <Text style={styles.summaryValue}>
          {current?.quantitySlabs?.length ? `${current.quantitySlabs.length} slabs` : "not published"}
        </Text>
      </View>
      {current?.quantitySlabs?.length ? (
        <View style={styles.slabTable}>
          {current.quantitySlabs.map((s, i) => (
            <Text key={i} style={styles.slabRow}>
              {s.from_mt}–{s.to_mt ?? "∞"} MT → Rs {s.rate_per_mt}/MT
            </Text>
          ))}
        </View>
      ) : null}
      {current?.effectiveFrom ? (
        <Text style={styles.readOnlyNote}>
          Effective from {new Date(current.effectiveFrom).toLocaleString("en-IN")} · v{current.currentVersion}
        </Text>
      ) : null}
    </View>
  );
}

function EditForm({ current, onDone }: { current: DiscountTermsRecord | null; onDone: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const [slabs, setSlabs] = useState<Array<{ from_mt: string; to_mt: string; rate_per_mt: string }>>(
    current?.quantitySlabs?.map((s) => ({
      from_mt: String(s.from_mt),
      to_mt: s.to_mt === null ? "" : String(s.to_mt),
      rate_per_mt: String(s.rate_per_mt),
    })) ?? [],
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addSlab() {
    setSlabs((s) => [...s, { from_mt: "", to_mt: "", rate_per_mt: "" }]);
  }
  function updateSlab(i: number, field: "from_mt" | "to_mt" | "rate_per_mt", value: string) {
    setSlabs((s) => s.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }
  function removeSlab(i: number) {
    setSlabs((s) => s.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const raw = values[f.key];
      if (raw !== undefined && raw.trim() !== "") payload[f.key] = Number(raw);
    }
    if (slabs.length) {
      if (slabs.some((s) => !s.from_mt.trim() || !s.rate_per_mt.trim())) {
        setError("Every slab needs at least a From (MT) and a Rate (Rs/MT).");
        return;
      }
      payload.quantitySlabs = slabs.map((s) => ({
        from_mt: Number(s.from_mt),
        to_mt: s.to_mt.trim() === "" ? null : Number(s.to_mt),
        rate_per_mt: Number(s.rate_per_mt),
      }));
    }
    if (!Object.keys(payload).length) {
      setError("Change at least one field before submitting.");
      return;
    }
    if (reason.trim().length < 10) {
      setError("Reason needs to be at least 10 characters.");
      return;
    }
    payload.reason = reason.trim();

    setBusy(true);
    try {
      if (current) {
        await api.draftDiscountTerms(PRODUCER, payload as never);
      } else {
        await api.createDiscountTerms({ producer: PRODUCER, ...(payload as object) } as never);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      {FIELDS.map((f) => (
        <Field key={f.key} label={f.label}>
          <Input
            value={values[f.key] ?? ""}
            onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
            keyboardType="numeric"
            placeholder={current?.[f.key] !== undefined ? `currently ${current[f.key]}` : "not set"}
          />
        </Field>
      ))}

      <Field label="Quantity discount slabs" hint="Replaces the whole table when submitted">
        {slabs.map((row, i) => (
          <View key={i} style={styles.slabInputRow}>
            <TextInput
              value={row.from_mt}
              onChangeText={(t) => updateSlab(i, "from_mt", t)}
              placeholder="From MT"
              placeholderTextColor={colors.textFaint}
              keyboardType="numeric"
              style={[styles.slabInput, { flex: 1 }]}
            />
            <TextInput
              value={row.to_mt}
              onChangeText={(t) => updateSlab(i, "to_mt", t)}
              placeholder="To MT (blank = open)"
              placeholderTextColor={colors.textFaint}
              keyboardType="numeric"
              style={[styles.slabInput, { flex: 1 }]}
            />
            <TextInput
              value={row.rate_per_mt}
              onChangeText={(t) => updateSlab(i, "rate_per_mt", t)}
              placeholder="Rs/MT"
              placeholderTextColor={colors.textFaint}
              keyboardType="numeric"
              style={[styles.slabInput, { flex: 1 }]}
            />
            <Pressable onPress={() => removeSlab(i)} hitSlop={8}>
              <Text style={styles.removeSlab}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable onPress={addSlab} style={styles.addSlab}>
          <Text style={styles.addSlabText}>+ Add slab</Text>
        </Pressable>
      </Field>

      <Field label="Reason">
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. GAIL's zonal team has always matched RIL's slabs informally — publish it"
          placeholderTextColor={colors.textFaint}
          multiline
          numberOfLines={3}
          style={styles.textarea}
        />
      </Field>

      {error ? <ErrorNote message={error} /> : null}

      <PrimaryButton label="Submit for review" onPress={submit} busy={busy} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowActions: { flexDirection: "row", gap: theme.space(4) },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  readOnlyNote: { color: c.textFaint, fontSize: 11, marginTop: theme.space(2) },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  summaryLabel: { color: c.textMuted, fontSize: 12 },
  summaryValue: { color: c.textPrimary, fontSize: 12, fontWeight: "700" },
  slabTable: { marginTop: theme.space(1) },
  slabRow: { color: c.textFaint, fontSize: 11, paddingVertical: 1 },
  impact: {
    marginTop: theme.space(3),
    backgroundColor: c.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
  },
  impactTitle: { color: c.textFaint, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  impactLine: { color: c.textPrimary, fontSize: 13, marginTop: theme.space(1) },
  impactWarn: { color: c.warning, fontSize: 12, marginTop: theme.space(1) },
  form: { marginTop: theme.space(3), gap: theme.space(1) },
  textarea: {
    backgroundColor: c.surfaceCard,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
    color: c.textPrimary,
    padding: theme.space(3),
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: "top",
  },
  slabInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(1),
    marginBottom: theme.space(1),
  },
  slabInput: {
    backgroundColor: c.surfaceCard,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.sm,
    color: c.textPrimary,
    padding: theme.space(2),
    fontSize: 12,
  },
  removeSlab: { color: c.danger, fontSize: 16, paddingHorizontal: theme.space(1) },
  addSlab: { alignSelf: "flex-start", marginTop: theme.space(1) },
  addSlabText: { color: c.primary, fontSize: 12, fontWeight: "700" },
}));
