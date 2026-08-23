import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { api, type PriceCircularDraft } from "../../services/api";
import { Field, Input, PrimaryButton } from "../../components/inputs";
import { revisionStatusColor } from "../../components/masterData";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, ExportButtons, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/**
 * Price Circular Management — the circular itself as the versioned entity.
 * "Many rows, one revision": a draft is cloned from the live price book,
 * edited row by row or in bulk on the price-circular/[id] screen (which
 * reuses the Data Grid Module, not a new implementation), then goes through
 * Draft -> Review -> Approved -> Published as one unit — one approval, one
 * publish, one audit record, not hundreds of individual ones.
 */
export default function PriceCircularsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const canPropose = true;
  const canPublish = true;

  const [drafts, setDrafts] = useState<PriceCircularDraft[]>([]);
  const [published, setPublished] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [draftList, circulars] = await Promise.all([
        api.priceCirculars(),
        api.circulars(),
      ]);
      setDrafts(draftList);
      setPublished(circulars.price.filter((c) => c.producer === "GAIL"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load circulars.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function rollback(circularId: string) {
    try {
      await api.rollbackPriceCircular(circularId, "Rolled back from circular history");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollback failed.");
    }
  }

  if (loading) return <Loading label="Loading price circulars" />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {error ? <ErrorNote message={error} /> : null}

      {canPropose ? (
        <Card>
          <View style={styles.cardHead}>
            <SectionTitle>Draft circulars</SectionTitle>
            <Pressable onPress={() => setCreating((c) => !c)}>
              <Text style={styles.link}>{creating ? "Cancel" : "+ New circular"}</Text>
            </Pressable>
          </View>
          {creating ? <CreateForm onDone={(id) => router.push(`/admin/price-circular/${id}` as never)} /> : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Drafts ({drafts.length})</SectionTitle>
        {drafts.map((d) => (
          <Pressable key={d._id} style={styles.row} onPress={() => router.push(`/admin/price-circular/${d._id}` as never)}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>{d.circularNumber}</Text>
              <Pill label={d.status.toUpperCase()} color={revisionStatusColor(colors)[d.status] ?? colors.neutral} />
            </View>
            <Text style={styles.rowMeta}>
              w.e.f. {new Date(d.effectiveDate).toLocaleDateString("en-IN")} · {d.rowCount.toLocaleString("en-IN")} rows ·{" "}
              {d.changedRowCount.toLocaleString("en-IN")} changed
            </Text>
          </Pressable>
        ))}
        {!drafts.length ? <Empty>No draft circulars yet.</Empty> : null}
      </Card>

      <Card>
        <SectionTitle>Published history</SectionTitle>
        {published.map((c) => (
          <View key={String(c._id)} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>{String(c.reference)}</Text>
              <Pill
                label={String(c.status).toUpperCase()}
                color={c.status === "active" ? colors.success : colors.textFaint}
              />
            </View>
            <Text style={styles.rowMeta}>
              w.e.f. {new Date(String(c.effectiveDate)).toLocaleDateString("en-IN")}
            </Text>
            <ExportButtons
              excel={{
                path: `/exports/price-circular/${c._id}/excel`,
                filename: `PriceCircular-${c.reference}.xlsx`,
              }}
              pdf={{
                path: `/exports/price-circular/${c._id}/pdf`,
                filename: `PriceCircular-${c.reference}.pdf`,
              }}
            />
            {canPublish && c.status !== "active" ? (
              <Pressable onPress={() => rollback(String(c._id))}>
                <Text style={styles.link}>Restore this version</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {!published.length ? <Empty>No published circulars yet.</Empty> : null}
      </Card>
    </ScrollView>
  );
}

function CreateForm({ onDone }: { onDone: (id: string) => void }) {
  const styles = useStyles();
  const [circularNumber, setCircularNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!circularNumber.trim() || !effectiveDate.trim() || reason.trim().length < 10) {
      setError("Circular number, effective date, and a reason of at least 10 characters are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await api.createPriceCircular({
        circularNumber: circularNumber.trim(),
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
      <Field label="Circular number"><Input value={circularNumber} onChangeText={setCircularNumber} placeholder="PE/2026-27/019" /></Field>
      <Field label="Effective date" hint="YYYY-MM-DD"><Input value={effectiveDate} onChangeText={setEffectiveDate} placeholder="2026-10-01" /></Field>
      <Field label="Reason"><Input value={reason} onChangeText={setReason} placeholder="Why a new circular is being drafted" /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label="Create — clones the live price book" onPress={submit} busy={busy} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  row: { paddingVertical: theme.space(3), borderTopWidth: 1, borderTopColor: c.border },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowTitle: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  form: { marginTop: theme.space(3), gap: theme.space(1) },
}));
