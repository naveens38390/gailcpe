import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { api, type GradeDetail, type GradeHit, type GradeImpact, type Revision } from "../../services/api";
import { Field, Input, PrimaryButton, Suggestions, useSuggestions } from "../../components/inputs";
import { PendingRevisionRow, RevisionHistory } from "../../components/masterData";
import { theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";
import type { ThemeColors } from "../../constants/colors";

const COMPETITORS = ["RIL", "IOCL", "HMEL", "OPaL", "HPL"] as const;
const STATUSES = ["active", "deprecated", "retired"] as const;

const statusPill = (c: ThemeColors): Record<string, string> => ({
  active: c.success,
  deprecated: c.warning,
  retired: c.danger,
});

/**
 * Grade Management — replaces CrossReference_Master.xlsx. Unlike Producers
 * and Locations, a grade change is load-bearing across every comparison and
 * deal simulation that resolves it, so impact() is checked before editing,
 * not discovered after — and grades are never deleted, only retired, so a
 * comparison run last quarter stays defensible.
 */
export default function GradesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const canPropose = true;
  const canReview = true;
  const canPublish = true;

  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<GradeDetail | null>(null);
  const [impact, setImpact] = useState<GradeImpact | null>(null);
  const [pending, setPending] = useState<Revision[]>([]);
  const [history, setHistory] = useState<Revision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const hits = useSuggestions(term, "grade");

  const loadPending = useCallback(async () => {
    if (!canReview) return;
    try {
      setPending(await api.gradePending());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load pending changes.");
    }
  }, [canReview]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  async function select(hit: GradeHit) {
    setTerm("");
    setShowHistory(false);
    setEditing(false);
    setLoadingDetail(true);
    try {
      const [detail, impactData] = await Promise.all([
        api.gradeDetail(hit.gailGrade),
        api.gradeImpact(hit.gailGrade),
      ]);
      setSelected(detail);
      setImpact(impactData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that grade.");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function openHistory() {
    if (!selected) return;
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    try {
      setHistory(await api.gradeHistory(selected.gailGrade));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history.");
    }
  }

  async function refreshSelected() {
    if (!selected) return;
    const [detail, impactData] = await Promise.all([
      api.gradeDetail(selected.gailGrade),
      api.gradeImpact(selected.gailGrade),
    ]);
    setSelected(detail);
    setImpact(impactData);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <View style={styles.cardHead}>
          <SectionTitle>Find a grade</SectionTitle>
          {canPropose ? (
            <Pressable onPress={() => setCreating((c) => !c)}>
              <Text style={styles.link}>{creating ? "Cancel" : "+ New grade"}</Text>
            </Pressable>
          ) : null}
        </View>
        <Field label="GAIL grade or competitor code">
          <Input value={term} onChangeText={setTerm} autoCapitalize="characters" placeholder="B52A003" />
          <Suggestions
            items={hits}
            onPick={(value) => {
              const hit = hits.find((h) => ("gailGrade" in h ? h.gailGrade : h.name) === value);
              if (hit && "gailGrade" in hit) select(hit);
            }}
          />
        </Field>
        {creating ? <CreateForm onDone={() => { setCreating(false); loadPending(); }} /> : null}
      </Card>

      {loadingDetail ? <Loading label="Loading grade" /> : null}

      {selected ? (
        <Card>
          <View style={styles.cardHead}>
            <View style={styles.titleRow}>
              <SectionTitle>{selected.gailGrade}</SectionTitle>
              {selected.status ? (
                <Pill label={selected.status.toUpperCase()} color={statusPill(colors)[selected.status]} />
              ) : null}
            </View>
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

          <Text style={styles.rowMeta}>
            {[selected.polymer, selected.application, selected.characteristic].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.rowMeta}>
            Confidence {selected.confidence ?? "—"}
            {selected.process ? ` · ${selected.process}` : ""}
            {selected.mfi ? ` · MFI ${selected.mfi}` : ""}
            {selected.density ? ` · density ${selected.density}` : ""}
          </Text>

          {selected.equivalents.map((row) => (
            <View key={row.producer} style={styles.equivRow}>
              <Text style={styles.equivProducer}>{row.producer}</Text>
              <Text style={styles.equivCodes}>
                {row.codes.length ? row.codes.map((c) => c.code).join(", ") : "no equivalent"}
              </Text>
            </View>
          ))}

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
                  Changing this grade affects live results for these — confirm before publishing.
                </Text>
              ) : null}
            </View>
          ) : null}

          {editing ? (
            <EditForm
              gailGrade={selected.gailGrade}
              currentStatus={selected.status ?? "active"}
              currentConfidence={selected.confidence}
              onDone={() => {
                setEditing(false);
                loadPending();
                refreshSelected();
              }}
            />
          ) : null}

          {showHistory ? (
            <RevisionHistory
              revisions={history}
              canPublish={canPublish}
              onRollback={async (version, reason) => {
                await api.rollbackGrade(selected.gailGrade, version, reason);
                setHistory(await api.gradeHistory(selected.gailGrade));
                await refreshSelected();
              }}
              onDiff={(from, to) => api.gradeDiff(selected.gailGrade, from, to)}
            />
          ) : null}
        </Card>
      ) : null}

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
                submit: (id) => api.submitGradeRevision(id),
                review: (id, approve) => api.reviewGradeRevision(id, approve),
                publish: (id) => api.publishGradeRevision(id),
              }}
              onDone={() => {
                setBusyId(null);
                loadPending();
              }}
              onError={setError}
            />
          ))}
        </Card>
      ) : null}

      {!selected && !pending.length && !creating && !loadingDetail ? (
        <Empty>Search a grade to view or edit its equivalents, confidence, and status.</Empty>
      ) : null}
    </ScrollView>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const styles = useStyles();
  const [gailGrade, setGailGrade] = useState("");
  const [application, setApplication] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!gailGrade.trim() || reason.trim().length < 10) {
      setError("Grade code and a reason of at least 10 characters are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createGrade({
        gailGrade: gailGrade.trim().toUpperCase(),
        application: application.trim() || undefined,
        reason: reason.trim(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not propose that grade.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Field label="GAIL grade code"><Input value={gailGrade} onChangeText={setGailGrade} autoCapitalize="characters" placeholder="e.g. B52A004" /></Field>
      <Field label="Application"><Input value={application} onChangeText={setApplication} placeholder="e.g. Blow Moulding" /></Field>
      <Field label="Reason"><Input value={reason} onChangeText={setReason} placeholder="Why this grade is being added" /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label="Submit for review" onPress={submit} busy={busy} />
    </View>
  );
}

function EditForm({
  gailGrade,
  currentStatus,
  currentConfidence,
  onDone,
}: {
  gailGrade: string;
  currentStatus: string;
  currentConfidence?: string;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [status, setStatus] = useState(currentStatus);
  const [confidence, setConfidence] = useState(currentConfidence ?? "");
  const [producer, setProducer] = useState<(typeof COMPETITORS)[number]>("RIL");
  const [codes, setCodes] = useState("");
  const [patch, setPatch] = useState<Record<string, string[] | null>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stage() {
    const list = codes.split(",").map((c) => c.trim()).filter(Boolean);
    if (!list.length) return;
    setPatch((p) => ({ ...p, [producer]: list }));
    setCodes("");
  }
  function stageRemoval(prod: string) {
    setPatch((p) => ({ ...p, [prod]: null }));
  }

  async function submit() {
    const fields: Record<string, unknown> = {};
    if (status !== currentStatus) fields.status = status;
    if (confidence.trim() && confidence.trim() !== (currentConfidence ?? "")) fields.confidence = confidence.trim();
    if (Object.keys(patch).length) fields.equivalents = patch;
    if (!Object.keys(fields).length) {
      setError("Change something before submitting.");
      return;
    }
    if (reason.trim().length < 10) {
      setError("Reason needs at least 10 characters.");
      return;
    }
    fields.reason = reason.trim();
    setBusy(true);
    setError(null);
    try {
      await api.draftGrade(gailGrade, fields as never);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Field label="Status">
        <View style={styles.basisRow}>
          {STATUSES.map((s) => (
            <Pressable key={s} onPress={() => setStatus(s)} style={[styles.basisOption, status === s && styles.basisActive]}>
              <Text style={[styles.basisText, status === s && styles.basisTextActive]}>{s}</Text>
            </Pressable>
          ))}
        </View>
      </Field>

      <Field label="Confidence (H / M / L)">
        <Input value={confidence} onChangeText={(t) => setConfidence(t.toUpperCase())} placeholder={currentConfidence ?? "H"} />
      </Field>

      <Field label="Equivalent grades" hint="Comma-separated codes for the selected producer">
        <View style={styles.basisRow}>
          {COMPETITORS.map((c) => (
            <Pressable key={c} onPress={() => setProducer(c)} style={[styles.basisOption, producer === c && styles.basisActive]}>
              <Text style={[styles.basisText, producer === c && styles.basisTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.zoneInputRow}>
          <Input value={codes} onChangeText={setCodes} placeholder={`${producer} codes, comma separated`} style={styles.zoneInput} />
          <Pressable onPress={stage} style={styles.stageButton}><Text style={styles.stageButtonText}>Set</Text></Pressable>
        </View>
      </Field>

      {Object.keys(patch).length ? (
        <View style={styles.stagedList}>
          {Object.entries(patch).map(([prod, val]) => (
            <View key={prod} style={styles.equivRow}>
              <Text style={styles.equivProducer}>{prod}</Text>
              <Text style={styles.equivCodes}>{val === null ? "(removed)" : val.join(", ")}</Text>
              <Pressable onPress={() => stageRemoval(prod)}><Text style={styles.removeLink}>remove</Text></Pressable>
            </View>
          ))}
        </View>
      ) : null}

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
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  rowActions: { flexDirection: "row", gap: theme.space(4) },
  rowMeta: { color: c.textMuted, fontSize: 12, marginTop: theme.space(1) },
  equivRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(2),
    paddingVertical: theme.space(1),
    borderTopWidth: 1,
    borderTopColor: c.border,
    marginTop: theme.space(2),
  },
  equivProducer: { color: c.textMuted, fontSize: 12, fontWeight: "700", width: 56 },
  equivCodes: { color: c.textPrimary, fontSize: 12, flex: 1 },
  removeLink: { color: c.danger, fontSize: 11, fontWeight: "700" },
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
  basisRow: { flexDirection: "row", gap: theme.space(2), flexWrap: "wrap" },
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
  zoneInputRow: { flexDirection: "row", gap: theme.space(2), alignItems: "center", marginTop: theme.space(2) },
  zoneInput: { flex: 1 },
  stageButton: {
    backgroundColor: c.primary,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(3),
  },
  stageButtonText: { color: c.onPrimary, fontWeight: "700", fontSize: 12 },
  stagedList: { marginTop: theme.space(2) },
}));
