import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { api, type FreightCircularDraft } from "../../services/api";
import { Field, Input, PrimaryButton } from "../../components/inputs";
import { SelectField, type Option } from "../../components/select";
import { revisionStatusColor } from "../../components/masterData";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/**
 * Freight Circular Management.
 *
 * The freight half of landed cost used to change on a spreadsheet with no
 * draft, no reviewer and no history, while prices went through a governed
 * workflow — and for the four ex-works producers freight decides more
 * comparisons than the price does. This is the same Draft -> Review ->
 * Approved -> Published lifecycle, on the same screens, for the other half.
 *
 * The one addition is the unmapped-destination count carried on every row: a
 * rate against a town no location maps to is real but invisible, so it is
 * shown here and has to be acknowledged before the circular can publish.
 */
export default function FreightCircularsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();

  const [drafts, setDrafts] = useState<FreightCircularDraft[]>([]);
  const [published, setPublished] = useState<Array<Record<string, unknown>>>([]);
  const [producers, setProducers] = useState<Array<{ producer: string; destinations: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [draftList, circulars, producerList] = await Promise.all([
        api.freightCirculars(),
        api.circulars("freight"),
        api.freightCircularProducers(),
      ]);
      setDrafts(draftList);
      setPublished(circulars.freight);
      setProducers(producerList);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load freight circulars.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function rollback(producer: string, circularId: string) {
    try {
      await api.rollbackFreightCircular(
        producer,
        circularId,
        "Rolled back from freight circular history",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollback failed.");
    }
  }

  if (loading) return <Loading label="Loading freight circulars" />;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <View style={styles.cardHead}>
          <SectionTitle>Draft freight circulars</SectionTitle>
          <View style={styles.headActions}>
            <Pressable onPress={() => router.push("/admin/circulars" as never)}>
              <Text style={styles.link}>File a PDF circular →</Text>
            </Pressable>
            <Pressable onPress={() => setCreating((c) => !c)}>
              <Text style={styles.link}>{creating ? "Cancel" : "+ New from live book"}</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.hint}>
          Have a circular PDF? File it on the Circulars screen and attach it there — HMEL, HPL and
          OPaL rates are read straight out of the document. "New from live book" below starts an
          empty clone instead, for editing rates by hand.
        </Text>
        {creating ? (
          <CreateForm
            producers={producers}
            onDone={(id) => router.push(`/admin/freight-circular/${id}` as never)}
          />
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Drafts ({drafts.length})</SectionTitle>
        {drafts.map((d) => (
          <Pressable
            key={d._id}
            style={styles.row}
            onPress={() => router.push(`/admin/freight-circular/${d._id}` as never)}
          >
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>
                {d.producer} · {d.circularNumber}
              </Text>
              <Pill
                label={d.status.toUpperCase()}
                color={revisionStatusColor(colors)[d.status] ?? colors.neutral}
              />
            </View>
            <Text style={styles.rowMeta}>
              w.e.f. {new Date(d.effectiveDate).toLocaleDateString("en-IN")} ·{" "}
              {d.rowCount.toLocaleString("en-IN")} destinations ·{" "}
              {d.changedRowCount.toLocaleString("en-IN")} changed
              {d.addedRowCount ? ` · ${d.addedRowCount} added` : ""}
              {d.removedDestinations?.length ? ` · ${d.removedDestinations.length} dropped` : ""}
            </Text>
            {d.unmappedCount ? (
              <Text style={[styles.rowMeta, { color: colors.warning }]}>
                {d.unmappedCount} destination{d.unmappedCount === 1 ? "" : "s"} not mapped to any
                location
                {d.unmappedAcknowledgedAt ? " — acknowledged" : " — must be reviewed before publishing"}
              </Text>
            ) : null}
          </Pressable>
        ))}
        {!drafts.length ? <Empty>No draft freight circulars yet.</Empty> : null}
      </Card>

      <Card>
        <SectionTitle>Published history</SectionTitle>
        {published.map((c) => (
          <View key={String(c._id)} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>
                {String(c.producer)} · {String(c.reference ?? "no reference")}
              </Text>
              <Pill
                label={String(c.status).toUpperCase()}
                color={c.status === "active" ? colors.success : colors.textFaint}
              />
            </View>
            <Text style={styles.rowMeta}>
              w.e.f. {new Date(String(c.effectiveDate)).toLocaleDateString("en-IN")}
              {(c.stats as Record<string, number> | undefined)?.destinations
                ? ` · ${(c.stats as Record<string, number>).destinations!.toLocaleString("en-IN")} destinations`
                : ""}
            </Text>
            {c.status !== "active" ? (
              <Pressable onPress={() => rollback(String(c.producer), String(c._id))}>
                <Text style={styles.link}>Restore this version</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {!published.length ? <Empty>No published freight circulars yet.</Empty> : null}
      </Card>
    </ScrollView>
  );
}

function CreateForm({
  producers,
  onDone,
}: {
  producers: Array<{ producer: string; destinations: number }>;
  onDone: (id: string) => void;
}) {
  const styles = useStyles();
  const [producer, setProducer] = useState("");
  const [circularNumber, setCircularNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only producers that actually publish a freight book: RIL and IOCL sell
  // delivered, so their freight is inside the price and there is nothing to
  // draft. Sourced from the live dataset rather than a hardcoded list.
  const options = useMemo<Option[]>(
    () =>
      producers.map((p) => ({
        value: p.producer,
        label: p.producer,
        badge: `${p.destinations.toLocaleString("en-IN")} destinations`,
      })),
    [producers],
  );

  async function submit() {
    // Circular number is deliberately not required: HMEL and OPaL publish
    // freight schedules with no reference printed on them, and the API
    // assigns a descriptive label rather than inviting an invented number.
    if (!producer || !effectiveDate.trim() || reason.trim().length < 10) {
      setError(
        "Producer, effective date, and a reason of at least 10 characters are required.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await api.createFreightCircular({
        producer,
        circularNumber: circularNumber.trim() || undefined,
        effectiveDate: effectiveDate.trim(),
        reason: reason.trim(),
      });
      onDone(draft._id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create that circular.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <SelectField
        label="Producer"
        value={producer}
        options={options}
        onChange={setProducer}
        placeholder="Which producer's freight book"
      />
      <Field
        label="Circular number"
        hint="Leave blank if the schedule prints none — HMEL and OPaL usually do not"
      >
        <Input value={circularNumber} onChangeText={setCircularNumber} placeholder="HPL/PM/26-27/39" />
      </Field>
      <Field label="Effective date" hint="YYYY-MM-DD">
        <Input value={effectiveDate} onChangeText={setEffectiveDate} placeholder="2026-10-01" />
      </Field>
      <Field label="Reason">
        <Input value={reason} onChangeText={setReason} placeholder="Why a new freight circular is being drafted" />
      </Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label="Create — clones the live freight book" onPress={submit} busy={busy} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headActions: { flexDirection: "row", gap: theme.space(4) },
  hint: { color: c.textFaint, fontSize: 12, marginTop: theme.space(2), lineHeight: 17 },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  row: { paddingVertical: theme.space(3), borderTopWidth: 1, borderTopColor: c.border },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowTitle: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  form: { marginTop: theme.space(3), gap: theme.space(1) },
}));
