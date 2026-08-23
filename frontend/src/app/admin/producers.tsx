import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";

import { api, type ProducerRecord, type Revision } from "../../services/api";
import { Field, Input, PrimaryButton } from "../../components/inputs";
import { PendingRevisionRow, RevisionHistory } from "../../components/masterData";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

export default function ProducersScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const canPropose = true;
  const canReview = true;
  const canPublish = true;

  const [producers, setProducers] = useState<ProducerRecord[]>([]);
  const [pending, setPending] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [historyCode, setHistoryCode] = useState<string | null>(null);
  const [history, setHistory] = useState<Revision[]>([]);

  const load = useCallback(async () => {
    try {
      const [p, pend] = await Promise.all([
        api.producers(),
        canReview ? api.producerPending() : Promise.resolve([]),
      ]);
      setProducers(p);
      setPending(pend);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load producers.");
    } finally {
      setLoading(false);
    }
  }, [canReview]);

  useEffect(() => {
    load();
  }, [load]);

  async function openHistory(code: string) {
    if (historyCode === code) {
      setHistoryCode(null);
      return;
    }
    setHistoryCode(code);
    try {
      setHistory(await api.producerHistory(code));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history.");
    }
  }

  async function refreshHistoryIfOpen() {
    if (historyCode) setHistory(await api.producerHistory(historyCode));
  }

  if (loading) return <Loading label="Loading producers" />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {error ? <ErrorNote message={error} /> : null}

      {canPropose ? (
        <Card>
          <View style={styles.cardHead}>
            <SectionTitle>Producers</SectionTitle>
            <Pressable onPress={() => setCreating((c) => !c)}>
              <Text style={styles.link}>{creating ? "Cancel" : "+ New producer"}</Text>
            </Pressable>
          </View>
          {creating ? (
            <CreateForm
              onDone={() => {
                setCreating(false);
                load();
              }}
            />
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Live ({producers.length})</SectionTitle>
        {producers.map((p) => (
          <View key={p.code} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>
                {p.code} {p.isSelf ? "· self" : ""}
              </Text>
              <Pill
                label={p.active ? "ACTIVE" : "RETIRED"}
                color={p.active ? colors.success : colors.danger}
              />
            </View>
            <Text style={styles.rowMeta}>
              {p.name} · {p.basis.replace("_", "-")} · v{p.currentVersion}
            </Text>
            <View style={styles.rowActions}>
              {canPropose ? (
                <Pressable onPress={() => setEditingCode(editingCode === p.code ? null : p.code)}>
                  <Text style={styles.link}>{editingCode === p.code ? "Cancel" : "Propose edit"}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => openHistory(p.code)}>
                <Text style={styles.link}>{historyCode === p.code ? "Hide history" : "History"}</Text>
              </Pressable>
            </View>
            {editingCode === p.code ? (
              <DraftForm
                producer={p}
                onDone={() => {
                  setEditingCode(null);
                  load();
                }}
              />
            ) : null}
            {historyCode === p.code ? (
              <RevisionHistory
                revisions={history}
                canPublish={canPublish}
                onRollback={async (version, reason) => {
                  await api.rollbackProducer(p.code, version, reason);
                  await load();
                  await refreshHistoryIfOpen();
                }}
                onDiff={(from, to) => api.producerDiff(p.code, from, to)}
              />
            ) : null}
          </View>
        ))}
        {!producers.length ? <Empty>No producers yet.</Empty> : null}
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
                submit: (id) => api.submitProducerRevision(id),
                review: (id, approve) => api.reviewProducerRevision(id, approve),
                publish: (id) => api.publishProducerRevision(id),
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

function CreateForm({ onDone }: { onDone: () => void }) {
  const styles = useStyles();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [basis, setBasis] = useState<"ex_works" | "delivered" | "ex_depot">("ex_works");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!code.trim() || !name.trim() || reason.trim().length < 10) {
      setError("Code, name, and a reason of at least 10 characters are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createProducer({ code: code.trim().toUpperCase(), name: name.trim(), basis, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not propose that producer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Field label="Code"><Input value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="e.g. NPCC" /></Field>
      <Field label="Name"><Input value={name} onChangeText={setName} placeholder="Full producer name" /></Field>
      <Field label="Pricing basis">
        <View style={styles.basisRow}>
          {(["ex_works", "delivered", "ex_depot"] as const).map((b) => (
            <Pressable key={b} onPress={() => setBasis(b)} style={[styles.basisOption, basis === b && styles.basisActive]}>
              <Text style={[styles.basisText, basis === b && styles.basisTextActive]}>{b.replace("_", "-")}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="Reason"><Input value={reason} onChangeText={setReason} placeholder="Why this producer is being added" /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label="Submit for review" onPress={submit} busy={busy} />
    </View>
  );
}

function DraftForm({ producer, onDone }: { producer: ProducerRecord; onDone: () => void }) {
  const styles = useStyles();
  const [name, setName] = useState(producer.name);
  const [active, setActive] = useState(producer.active);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 10) {
      setError("Reason needs at least 10 characters.");
      return;
    }
    const fields: Record<string, unknown> = { reason: reason.trim() };
    if (name.trim() !== producer.name) fields.name = name.trim();
    if (active !== producer.active) fields.active = active;
    if (Object.keys(fields).length === 1) {
      setError("Change something before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.draftProducer(producer.code, fields as never);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Field label="Name"><Input value={name} onChangeText={setName} /></Field>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Active — appears in comparisons</Text>
        <Switch value={active} onValueChange={setActive} />
      </View>
      <Field label="Reason"><Input value={reason} onChangeText={setReason} placeholder="Why this change" /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label="Submit for review" onPress={submit} busy={busy} />
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
  rowActions: { flexDirection: "row", gap: theme.space(4), marginTop: theme.space(2) },
  form: { marginTop: theme.space(3), gap: theme.space(1) },
  basisRow: { flexDirection: "row", gap: theme.space(2) },
  basisOption: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  basisActive: { backgroundColor: c.primary, borderColor: c.primary },
  basisText: { color: c.textMuted, fontSize: 12 },
  basisTextActive: { color: c.onPrimary, fontWeight: "700" },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.space(3),
  },
  switchLabel: { color: c.textMuted, fontSize: 13 },
}));
